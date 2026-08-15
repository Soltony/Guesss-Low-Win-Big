import prisma from './prisma';
import { getSettings } from './settings';
import { createAuditLog } from './audit-log';
import { notify } from './notifications';
import { copyParticipants } from './eligibility';
import { toNum } from './format';
import type { SettingsMap } from './settings';
import type { ReauctionConfig } from './reauction-rules';
import type { ReauctionState, SettlementActor } from './types';

/**
 * Re-auction rules.
 *
 * An auction that closes without a winner the platform will stand behind is
 * re-run instead of being written off. Each re-run is a real Auction row linked
 * back to the one it came from, so a chain stays inspectable end to end.
 *
 * The money rule that makes this fair: a bidder is never charged twice for the
 * same bid. Every bid they already paid for anywhere in the chain becomes a
 * credit on the next round. Placing 8 bids on a re-auction after paying for 5
 * costs 3 fees, not 8 — and those 3 join the credit pool for the round after.
 *
 * Written as: credits granted on round N+1 = bids paid for across rounds 1..N.
 * Because carried bids are recorded with a zero fee, that count never
 * double-counts a credit that was already spent.
 */

// The rules themselves live in `reauction-rules.ts`, free of any database
// import, so the mini-app can render the same rule this module enforces.
export {
  decideReauction,
  isWinnerValid,
  splitCarriedBids,
  type ReauctionConfig,
  type ReauctionDecision,
  type RoundOutcome,
} from './reauction-rules';

// --------------------------------------
// CONFIGURATION
// --------------------------------------

/** The per-auction re-auction rules, as the admin API accepts them. */
export interface ReauctionSettings {
  reauctionEnabled: boolean;
  maxReauctionRounds: number;
  reauctionDurationHours: number;
  reauctionStartDelayMinutes: number;
  reauctionAllowNewBidders: boolean;
  reauctionAllowPreviousBidders: boolean;
  reauctionMinBids: number;
}

export const REAUCTION_FIELDS = [
  'reauctionEnabled',
  'maxReauctionRounds',
  'reauctionDurationHours',
  'reauctionStartDelayMinutes',
  'reauctionAllowNewBidders',
  'reauctionAllowPreviousBidders',
  'reauctionMinBids',
] as const satisfies readonly (keyof ReauctionSettings)[];

/** Platform-wide starting point for a brand new auction. */
export function reauctionDefaults(settings: SettingsMap): ReauctionSettings {
  return {
    reauctionEnabled: Boolean(settings['reauction.defaultEnabled']),
    maxReauctionRounds: Number(settings['reauction.defaultMaxRounds']) || 1,
    reauctionDurationHours: Number(settings['reauction.defaultDurationHours']) || 24,
    reauctionStartDelayMinutes: Number(settings['reauction.defaultStartDelayMinutes']) || 0,
    reauctionAllowNewBidders: Boolean(settings['reauction.defaultAllowNewBidders']),
    reauctionAllowPreviousBidders: Boolean(settings['reauction.defaultAllowPreviousBidders']),
    reauctionMinBids: Number(settings['reauction.defaultMinBids']) || 0,
  };
}

/**
 * Reads the re-auction block off a request body, falling back to `current` for
 * anything the caller left out, so the same parser serves create and update.
 */
export function parseReauctionConfig(
  body: Record<string, unknown>,
  current: ReauctionSettings
): { config: ReauctionSettings } | { error: string } {
  const bool = (key: keyof ReauctionSettings) =>
    body[key] === undefined ? (current[key] as boolean) : Boolean(body[key]);
  const int = (key: keyof ReauctionSettings) =>
    body[key] === undefined ? (current[key] as number) : Math.trunc(Number(body[key]));

  const config: ReauctionSettings = {
    reauctionEnabled: bool('reauctionEnabled'),
    maxReauctionRounds: int('maxReauctionRounds'),
    reauctionDurationHours: int('reauctionDurationHours'),
    reauctionStartDelayMinutes: int('reauctionStartDelayMinutes'),
    reauctionAllowNewBidders: bool('reauctionAllowNewBidders'),
    reauctionAllowPreviousBidders: bool('reauctionAllowPreviousBidders'),
    reauctionMinBids: int('reauctionMinBids'),
  };

  if (!Number.isFinite(config.maxReauctionRounds) || config.maxReauctionRounds < 1) {
    return { error: 'Max re-auction rounds must be at least 1.' };
  }
  if (!Number.isFinite(config.reauctionDurationHours) || config.reauctionDurationHours < 1) {
    return { error: 'Re-auction duration must be at least 1 hour.' };
  }
  if (
    !Number.isFinite(config.reauctionStartDelayMinutes) ||
    config.reauctionStartDelayMinutes < 0
  ) {
    return { error: 'Re-auction start delay cannot be negative.' };
  }
  if (!Number.isFinite(config.reauctionMinBids) || config.reauctionMinBids < 0) {
    return { error: 'Minimum bids for a valid result cannot be negative.' };
  }
  if (
    config.reauctionEnabled &&
    !config.reauctionAllowNewBidders &&
    !config.reauctionAllowPreviousBidders
  ) {
    return {
      error:
        'A re-auction must admit new bidders, previous bidders, or both — otherwise nobody could bid in it.',
    };
  }

  return { config };
}

// --------------------------------------
// LINEAGE
// --------------------------------------

export interface LineageRef {
  id: string;
  originalAuctionId: string | null;
}

/** The id every round in a chain is filed under — the original auction. */
export function rootAuctionId(auction: LineageRef): string {
  return auction.originalAuctionId ?? auction.id;
}

/** Every round of the chain this auction belongs to, oldest first. */
export async function lineageRounds(auction: LineageRef) {
  const root = rootAuctionId(auction);
  return prisma.auction.findMany({
    where: { OR: [{ id: root }, { originalAuctionId: root }] },
    orderBy: { reauctionRound: 'asc' },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      reauctionRound: true,
      reauctionState: true,
      reauctionReason: true,
      bidCount: true,
      bidderCount: true,
      startAt: true,
      endAt: true,
      winnerBidId: true,
    },
  });
}

// --------------------------------------
// CARRIED-FORWARD CREDITS
// --------------------------------------

/** Prepaid bids this bidder still holds on this auction. */
export async function carriedBidsRemaining(
  bidderId: string,
  auctionId: string
): Promise<number> {
  const credit = await prisma.bidCredit.findUnique({
    where: { bidderId_auctionId: { bidderId, auctionId } },
    select: { remaining: true },
  });
  return credit?.remaining ?? 0;
}

/** Prepaid bids per auction for one bidder, for list views. */
export async function carriedBidsByAuction(
  bidderId: string | undefined
): Promise<Record<string, number>> {
  if (!bidderId) return {};
  const rows = await prisma.bidCredit.findMany({
    where: { bidderId, remaining: { gt: 0 } },
    select: { auctionId: true, remaining: true },
  });
  return Object.fromEntries(rows.map((row) => [row.auctionId, row.remaining]));
}

/**
 * Spends one prepaid bid, if the bidder has any left.
 *
 * The conditional `remaining > 0` makes this a single atomic UPDATE, so two
 * bids racing each other can never spend the same credit and slip a free bid
 * through — which would be the platform paying the fee, not the bidder.
 */
export async function claimBidCredit(bidderId: string, auctionId: string): Promise<boolean> {
  const claimed = await prisma.bidCredit.updateMany({
    where: { bidderId, auctionId, remaining: { gt: 0 } },
    data: { remaining: { decrement: 1 }, consumed: { increment: 1 } },
  });
  return claimed.count > 0;
}

/** Hands a spent credit back when the bid it funded never counted. */
export async function releaseBidCredit(bidderId: string, auctionId: string): Promise<void> {
  await prisma.bidCredit.updateMany({
    where: { bidderId, auctionId, consumed: { gt: 0 } },
    data: { remaining: { increment: 1 }, consumed: { decrement: 1 } },
  });
}

// --------------------------------------
// PARTICIPATION
// --------------------------------------

export interface Eligibility {
  eligible: boolean;
  /** The bidder already bid in an earlier round of this chain. */
  returning: boolean;
  reason?: string;
}

/** Whether a bidder may bid in this round, given who the round is open to. */
export async function reauctionEligibility(
  auction: LineageRef & Pick<ReauctionConfig, 'reauctionRound' | 'reauctionAllowNewBidders' | 'reauctionAllowPreviousBidders'>,
  bidderId: string
): Promise<Eligibility> {
  if (auction.reauctionRound === 0) return { eligible: true, returning: false };

  const root = rootAuctionId(auction);
  const earlierBids = await prisma.bid.count({
    where: {
      bidderId,
      status: 'ACTIVE',
      auction: {
        OR: [{ id: root }, { originalAuctionId: root }],
        reauctionRound: { lt: auction.reauctionRound },
      },
    },
  });
  const returning = earlierBids > 0;

  if (returning && !auction.reauctionAllowPreviousBidders) {
    return {
      eligible: false,
      returning,
      reason: 'This re-auction is open to new bidders only.',
    };
  }
  if (!returning && !auction.reauctionAllowNewBidders) {
    return {
      eligible: false,
      returning,
      reason: 'This re-auction is open only to bidders from the previous round.',
    };
  }

  return { eligible: true, returning };
}

// --------------------------------------
// CREATING A ROUND
// --------------------------------------

export interface CreateReauctionResult {
  created: boolean;
  reason?: string;
  auctionId?: string;
  code?: string;
  round?: number;
  biddersCarried?: number;
  bidsCarried?: number;
}

/** `195` → `195-R2`, stepping the suffix if an operator already claimed it. */
async function reauctionCode(rootCode: string, round: number): Promise<string> {
  let candidate = `${rootCode}-R${round}`;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const clash = await prisma.auction.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${rootCode}-R${round}.${attempt}`;
  }
  return `${rootCode}-R${round}-${Date.now().toString().slice(-6)}`;
}

/**
 * Opens the next round of an auction and carries every paid bid forward.
 *
 * Idempotent by lineage: a parent that already spawned a round returns that
 * round instead of forking the chain, so a retried settlement or a double
 * click cannot create two competing re-auctions.
 */
export async function createReauction(
  parentAuctionId: string,
  actor: SettlementActor = { id: 'SYSTEM', name: 'System' },
  options: { reason?: string; force?: boolean } = {}
): Promise<CreateReauctionResult> {
  const settings = await getSettings();
  const parent = await prisma.auction.findUnique({ where: { id: parentAuctionId } });
  if (!parent) return { created: false, reason: 'Auction not found.' };

  const existing = await prisma.auction.findFirst({
    where: { parentAuctionId: parent.id },
    select: { id: true, code: true, reauctionRound: true },
  });
  if (existing) {
    return {
      created: false,
      reason: `This auction has already been re-auctioned as ${existing.code}.`,
      auctionId: existing.id,
      code: existing.code,
      round: existing.reauctionRound,
    };
  }

  if (!parent.reauctionEnabled && !options.force) {
    return { created: false, reason: 'Re-auction is switched off for this auction.' };
  }
  if (parent.reauctionRound >= parent.maxReauctionRounds && !options.force) {
    return {
      created: false,
      reason: `All ${parent.maxReauctionRounds} re-auction round(s) have already been used.`,
    };
  }
  if (!parent.reauctionAllowNewBidders && !parent.reauctionAllowPreviousBidders) {
    return {
      created: false,
      reason: 'The rules admit neither new nor previous bidders, so the round would have nobody to bid in it.',
    };
  }

  const round = parent.reauctionRound + 1;
  const root = rootAuctionId(parent);
  const rootAuction =
    root === parent.id
      ? parent
      : await prisma.auction.findUnique({ where: { id: root }, select: { code: true } });
  const code = await reauctionCode(rootAuction?.code ?? parent.code, round);

  const startAt = new Date(Date.now() + Math.max(0, parent.reauctionStartDelayMinutes) * 60_000);
  const endAt = new Date(
    startAt.getTime() + Math.max(1, parent.reauctionDurationHours) * 3_600_000
  );

  const autoPublish = Boolean(settings['reauction.autoPublish']);
  const status = !autoPublish ? 'DRAFT' : startAt <= new Date() ? 'LIVE' : 'SCHEDULED';

  // Every round the chain has run so far. All of them precede the new one, so
  // all of their paid bids are eligible to carry forward.
  const previousRounds = await prisma.auction.findMany({
    where: { OR: [{ id: root }, { originalAuctionId: root }] },
    select: { id: true },
  });
  const previousRoundIds = previousRounds.map((a) => a.id);

  const [paidPerBidder, participants] = await Promise.all([
    // Carried bids record a zero fee, so counting fee-bearing bids counts each
    // paid bid exactly once no matter how deep the chain runs.
    prisma.bid.groupBy({
      by: ['bidderId'],
      where: {
        auctionId: { in: previousRoundIds },
        status: 'ACTIVE',
        feeAmount: { gt: 0 },
      },
      _count: { _all: true },
    }),
    prisma.bid.findMany({
      where: { auctionId: { in: previousRoundIds }, status: 'ACTIVE' },
      select: { bidderId: true },
      distinct: ['bidderId'],
    }),
  ]);

  const carryForward = parent.reauctionAllowPreviousBidders;
  const paidByBidder = new Map(paidPerBidder.map((row) => [row.bidderId, row._count._all]));
  const unitFee = toNum(parent.bidFee);

  const child = await prisma.$transaction(async (tx) => {
    const created = await tx.auction.create({
      data: {
        code,
        title: parent.title,
        titleAm: parent.titleAm,
        subtitle: parent.subtitle,
        itemId: parent.itemId,
        categoryId: parent.categoryId,

        bidFee: parent.bidFee,
        minBidAmount: parent.minBidAmount,
        maxBidAmount: parent.maxBidAmount,
        bidStep: parent.bidStep,
        maxBidsPerUser: parent.maxBidsPerUser,
        maxTotalBids: parent.maxTotalBids,
        currency: parent.currency,

        startAt,
        endAt,
        autoExtendMinutes: parent.autoExtendMinutes,
        status,
        publishedAt: status === 'DRAFT' ? null : new Date(),

        featured: parent.featured,
        displayOrder: parent.displayOrder,
        termsId: parent.termsId,

        // A restricted round must not quietly reopen to everyone when it is
        // re-run; the list itself is copied over below.
        eligibilityMode: parent.eligibilityMode,

        // The rules travel with the chain, so round 3 plays by the same terms
        // bidders accepted in round 1.
        reauctionEnabled: parent.reauctionEnabled,
        maxReauctionRounds: parent.maxReauctionRounds,
        reauctionDurationHours: parent.reauctionDurationHours,
        reauctionStartDelayMinutes: parent.reauctionStartDelayMinutes,
        reauctionAllowNewBidders: parent.reauctionAllowNewBidders,
        reauctionAllowPreviousBidders: parent.reauctionAllowPreviousBidders,
        reauctionMinBids: parent.reauctionMinBids,

        reauctionRound: round,
        parentAuctionId: parent.id,
        originalAuctionId: root,
        createdById: actor.id === 'SYSTEM' ? null : actor.id,
      },
    });

    // The invite list defines who the round is for, so it travels with the
    // round itself — before any credit is granted against it.
    if (created.eligibilityMode === 'RESTRICTED') {
      await copyParticipants(tx, parent.id, created.id, created.createdById);
    }

    if (carryForward) {
      const grants = Array.from(paidByBidder.entries())
        .filter(([, granted]) => granted > 0)
        .map(([bidderId, granted]) => ({
          bidderId,
          auctionId: created.id,
          sourceAuctionId: parent.id,
          rootAuctionId: root,
          granted,
          consumed: 0,
          remaining: granted,
          unitFee,
        }));
      if (grants.length > 0) await tx.bidCredit.createMany({ data: grants });
    }

    await tx.auction.update({
      where: { id: parent.id },
      data: {
        reauctionState: 'CREATED' satisfies ReauctionState,
        reauctionReason: options.reason ?? 'No valid winner.',
        reauctionedAt: new Date(),
      },
    });

    return created;
  });

  const bidsCarried = carryForward
    ? Array.from(paidByBidder.values()).reduce((sum, n) => sum + n, 0)
    : 0;
  const biddersCarried = carryForward
    ? Array.from(paidByBidder.values()).filter((n) => n > 0).length
    : 0;

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    actorType: actor.id === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
    action: 'AUCTION_REAUCTIONED',
    entity: 'Auction',
    entityId: parent.id,
    details: {
      reason: options.reason ?? 'No valid winner.',
      round,
      newAuctionId: child.id,
      newCode: code,
      status,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allowNewBidders: parent.reauctionAllowNewBidders,
      allowPreviousBidders: parent.reauctionAllowPreviousBidders,
      biddersCarried,
      bidsCarried,
      carriedValue: Number((bidsCarried * unitFee).toFixed(2)),
    },
  });

  await notifyReauction({
    parent,
    child: { id: child.id, code, endAt },
    participantIds: participants.map((p) => p.bidderId),
    paidByBidder,
    carryForward,
    unitFee,
  });

  return {
    created: true,
    auctionId: child.id,
    code,
    round,
    biddersCarried,
    bidsCarried,
  };
}

/**
 * Tells the previous round's bidders what happened: that the auction is being
 * re-run, whether they may take part, how many paid bids came with them and
 * from which bid a new fee starts. Never throws — a messaging outage must not
 * roll back a round that already exists.
 */
async function notifyReauction(input: {
  parent: {
    id: string;
    code: string;
    title: string;
    currency: string;
    reauctionAllowPreviousBidders: boolean;
  };
  child: { id: string; code: string; endAt: Date };
  participantIds: string[];
  paidByBidder: Map<string, number>;
  carryForward: boolean;
  unitFee: number;
}): Promise<number> {
  try {
    const settings = await getSettings();
    if (!settings['notifications.onReauction']) return 0;
    if (input.participantIds.length === 0) return 0;

    const bidders = await prisma.bidder.findMany({
      where: { id: { in: input.participantIds }, status: 'ACTIVE' },
      select: { id: true, phoneNumber: true, language: true },
    });

    const fee = input.unitFee.toFixed(2);
    const deadline = input.child.endAt.toLocaleString('en-GB');
    let sent = 0;

    for (const bidder of bidders) {
      const carried = input.carryForward ? (input.paidByBidder.get(bidder.id) ?? 0) : 0;
      const result = await notify({
        code: input.parent.reauctionAllowPreviousBidders
          ? 'AUCTION_REAUCTIONED'
          : 'REAUCTION_EXCLUDED',
        recipient: bidder.phoneNumber,
        language: bidder.language === 'am' ? 'am' : 'en',
        bidderId: bidder.id,
        auctionId: input.child.id,
        vars: {
          code: input.parent.code,
          title: input.parent.title,
          newCode: input.child.code,
          deadline,
          carriedBids: carried,
          fee,
          currency: input.parent.currency,
        },
      });
      if (result.sent) sent += 1;
    }

    return sent;
  } catch (error) {
    console.error('[reauction] notification pass failed', error);
    return 0;
  }
}
