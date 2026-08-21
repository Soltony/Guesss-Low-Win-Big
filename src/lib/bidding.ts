import prisma from './prisma';
import { getSettings } from './settings';
import { createAuditLog } from './audit-log';
import { round2, toNum } from './format';
import { derivedStatus } from './auction-engine';
import {
  carriedBidsRemaining as remainingCredits,
  claimBidCredit,
  reauctionEligibility,
  releaseBidCredit,
} from './reauction';
import { participantEligibility } from './eligibility';
import { PaymentError, initiateBidFeePayment } from './payment-gateway';
import { BidAmountCipherError, decryptBidAmount, encryptBidAmount } from './bid-crypto';

export class BidRejected extends Error {
  status: number;
  code: string;
  /** Carried up from the gateway; echoed to the client only under SUPERAPP_DEBUG. */
  debug?: unknown;
  constructor(message: string, code = 'BID_REJECTED', status = 400, debug?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.debug = debug;
  }
}

export interface PlaceBidInput {
  auctionId: string;
  bidderId: string;
  amount: number;
  superAppToken: string;
  /** Session came from the authorization bypass — never charge a test bidder. */
  isTest?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PlaceBidResult {
  bidId: string;
  amount: number;
  feeAmount: number;
  status: 'PENDING_PAYMENT' | 'ACTIVE';
  sequence: number;
  transactionId?: string;
  /**
   * Only set on PENDING_PAYMENT. The webview has to post this to the super app
   * over its JS channel to raise the PIN sheet — without that hand-off nothing
   * ever asks the bidder to pay and the callback never comes.
   */
  paymentToken?: string;
  remainingBids: number;
  /** Paid for in an earlier round of this auction's chain, so no fee was raised. */
  carriedOver: boolean;
  /** Prepaid bids left after this one. */
  carriedBidsRemaining: number;
}

/**
 * Validates and records a bid.
 *
 * The bid lands as PENDING_PAYMENT and only becomes ACTIVE once the payment
 * callback confirms the service fee — an unpaid bid must never influence the
 * winner calculation.
 */
export async function placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
  const settings = await getSettings();

  if (settings['platform.maintenanceMode']) {
    throw new BidRejected(
      String(settings['platform.maintenanceMessage'] || 'Bidding is temporarily unavailable.'),
      'MAINTENANCE',
      503
    );
  }

  const [auction, bidder] = await Promise.all([
    prisma.auction.findUnique({ where: { id: input.auctionId } }),
    prisma.bidder.findUnique({ where: { id: input.bidderId } }),
  ]);

  if (!auction) throw new BidRejected('Auction not found.', 'NOT_FOUND', 404);
  if (!bidder) throw new BidRejected('Bidder profile not found.', 'NOT_FOUND', 404);

  if (bidder.status !== 'ACTIVE') {
    throw new BidRejected(
      bidder.status === 'BLOCKED'
        ? 'Your account is blocked from bidding. Please contact support.'
        : 'Your account is suspended from bidding.',
      'BIDDER_BLOCKED',
      403
    );
  }

  const status = derivedStatus(auction);
  if (status !== 'LIVE') {
    const message =
      status === 'SCHEDULED'
        ? 'This auction has not started yet.'
        : status === 'DRAFT' || status === 'PENDING_APPROVAL'
          ? 'This auction is not open for bidding.'
          : status === 'CANCELLED'
            ? 'This auction was cancelled.'
            : 'This auction has already closed.';
    throw new BidRejected(message, 'AUCTION_NOT_LIVE', 409);
  }

  // ---- Invited participants ----
  // A restricted auction admits only the numbers on its uploaded list, however
  // the bidder found the page. Checked before anything about the amount, so an
  // uninvited bidder hears the real reason rather than a complaint about their
  // bid, and well before any money is discussed.
  const invited = await participantEligibility(auction, bidder.phoneNumber);
  if (!invited.eligible) {
    throw new BidRejected(
      invited.reason ?? 'You are not eligible to bid on this auction.',
      'NOT_ON_PARTICIPANT_LIST',
      403
    );
  }

  // ---- Amount validation ----
  const amount = round2(Number(input.amount));
  const min = toNum(auction.minBidAmount);
  const max = toNum(auction.maxBidAmount);
  const step = toNum(auction.bidStep) || 0.01;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BidRejected('Enter a valid bid amount.', 'INVALID_AMOUNT');
  }
  if (amount < min || amount > max) {
    throw new BidRejected(
      `Bid amount must be between ${min.toFixed(2)} and ${max.toFixed(2)} ${auction.currency}.`,
      'OUT_OF_RANGE'
    );
  }
  // Compare in integer minor units so 0.1 + 0.2 style drift cannot reject a valid bid.
  const stepMinor = Math.round(step * 100);
  const offsetMinor = Math.round(amount * 100) - Math.round(min * 100);
  if (stepMinor > 0 && offsetMinor % stepMinor !== 0) {
    throw new BidRejected(
      `Bid amount must be in increments of ${step.toFixed(2)} starting from ${min.toFixed(2)}.`,
      'INVALID_STEP'
    );
  }

  // ---- Re-auction participation ----
  // Who a re-run is open to is fixed when the round is created; a bidder the
  // rules exclude must be turned away before any money is discussed.
  const participation = await reauctionEligibility(auction, bidder.id);
  if (!participation.eligible) {
    throw new BidRejected(
      participation.reason ?? 'You cannot bid in this re-auction.',
      'REAUCTION_NOT_ELIGIBLE',
      403
    );
  }

  // ---- Auction-wide bid cap ----
  // Counts bids still awaiting payment too, so a burst of pending bids cannot
  // oversubscribe the cap and then all confirm.
  if (auction.maxTotalBids > 0) {
    const placed = await prisma.bid.count({
      where: { auctionId: auction.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
    });
    if (placed >= auction.maxTotalBids) {
      throw new BidRejected(
        `This auction has reached its limit of ${auction.maxTotalBids} bids and is no longer accepting new ones.`,
        'AUCTION_LIMIT_REACHED',
        409
      );
    }
  }

  // ---- Per-bidder limits ----
  const myBids = await prisma.bid.findMany({
    where: {
      auctionId: auction.id,
      bidderId: bidder.id,
      status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
    },
    select: { amountCipher: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (myBids.length >= auction.maxBidsPerUser) {
    throw new BidRejected(
      `You have reached the limit of ${auction.maxBidsPerUser} bids on this auction.`,
      'LIMIT_REACHED',
      409
    );
  }

  // The bidder's own amounts, which they are always entitled to read. Sealing
  // and opening both happen against this (auction, bidder) pair, so a failure
  // here means the key is wrong rather than one row being odd — and carrying on
  // under the wrong key would write rows nobody can ever settle. Stop instead.
  const scope = { auctionId: auction.id, bidderId: bidder.id };
  let myAmounts: number[];
  let amountCipher: string;
  try {
    myAmounts = myBids.map((b) => decryptBidAmount(b.amountCipher, scope));
    amountCipher = encryptBidAmount(amount, scope);
  } catch (error) {
    if (error instanceof BidAmountCipherError) {
      console.error('[bidding] bid amount encryption unavailable', error.message);
      throw new BidRejected(
        'Bidding is temporarily unavailable. Please try again shortly.',
        'AMOUNT_CIPHER_UNAVAILABLE',
        503
      );
    }
    throw error;
  }

  if (!settings['bidding.allowRepeatOwnAmount']) {
    const already = myAmounts.some((value) => value.toFixed(2) === amount.toFixed(2));
    if (already) {
      throw new BidRejected(
        'You have already bid this amount. Repeating it would cancel out your own uniqueness — pick a different amount.',
        'DUPLICATE_OWN_AMOUNT',
        409
      );
    }
  }

  const cooldown = Number(settings['bidding.cooldownSeconds']) || 0;
  if (cooldown > 0 && myBids[0]) {
    const elapsed = (Date.now() - myBids[0].createdAt.getTime()) / 1000;
    if (elapsed < cooldown) {
      throw new BidRejected(
        `Please wait ${Math.ceil(cooldown - elapsed)}s before placing another bid.`,
        'COOLDOWN',
        429
      );
    }
  }

  // ---- Record the bid ----
  // No money changes hands in pilot mode or for a bypassed test session, so the
  // bid must record a zero fee — otherwise the bidder's "fees paid" total and
  // the revenue reports would claim income that was never collected.
  const feesEnabled = Boolean(settings['payments.enabled']) && !input.isTest;
  const sequence = myBids.length + 1;

  // A bid the bidder already paid for in an earlier round of this chain costs
  // nothing now. Claiming the credit first is what stops the same bid being
  // charged twice; if the bid then fails to record, the credit goes back.
  const carriedOver = feesEnabled ? await claimBidCredit(bidder.id, auction.id) : false;
  const feeAmount = feesEnabled && !carriedOver ? toNum(auction.bidFee) : 0;

  let bid;
  try {
    bid = await prisma.bid.create({
      data: {
        auctionId: auction.id,
        bidderId: bidder.id,
        amountCipher,
        feeAmount,
        status: 'PENDING_PAYMENT',
        channel: input.isTest ? 'TEST' : 'MINIAPP',
        sequence,
        carriedOver,
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent?.slice(0, 1000) ?? undefined,
      },
    });
  } catch (error) {
    if (carriedOver) await releaseBidCredit(bidder.id, auction.id);
    throw error;
  }

  const carriedBidsRemaining = carriedOver ? await remainingCredits(bidder.id, auction.id) : 0;

  await createAuditLog({
    actorId: bidder.phoneNumber,
    actorName: bidder.fullName,
    actorType: 'BIDDER',
    action: 'BID_PLACED',
    entity: 'Bid',
    entityId: bid.id,
    // The amount is deliberately absent. An audit row is readable by every
    // Auditor and Compliance role while the auction is still running, which
    // would put the live bid distribution one table away from the people who
    // must not have it. The bid itself is the record — `entityId` points at it,
    // and the amount can be opened from there once the auction settles.
    details: {
      auctionId: auction.id,
      auctionCode: auction.code,
      feeAmount,
      sequence,
      carriedOver,
      reauctionRound: auction.reauctionRound,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  const remainingBids = auction.maxBidsPerUser - sequence;

  // Nothing to charge: pilot mode, a test session, or a bid already paid for in
  // an earlier round. Confirm immediately, no gateway round-trip.
  if (!feesEnabled || feeAmount <= 0) {
    await confirmBid(bid.id, {
      source: carriedOver ? 'CARRIED_OVER' : input.isTest ? 'TEST_SESSION' : 'NO_FEE',
    });
    return {
      bidId: bid.id,
      amount,
      feeAmount,
      status: 'ACTIVE',
      sequence,
      remainingBids,
      carriedOver,
      carriedBidsRemaining,
    };
  }

  try {
    const payment = await initiateBidFeePayment({
      bidId: bid.id,
      bidderId: bidder.id,
      auctionId: auction.id,
      amount: feeAmount,
      superAppToken: input.superAppToken,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      bidId: bid.id,
      amount,
      feeAmount,
      status: 'PENDING_PAYMENT',
      sequence,
      transactionId: payment.transactionId,
      paymentToken: payment.paymentToken,
      remainingBids,
      carriedOver,
      carriedBidsRemaining,
    };
  } catch (error) {
    // The payment never started, so the bid must not linger as pending.
    await prisma.bid.update({
      where: { id: bid.id },
      data: {
        status: 'FAILED',
        voidedAt: new Date(),
        voidReason: error instanceof Error ? error.message.slice(0, 400) : 'Payment failed',
      },
    });
    if (error instanceof PaymentError) {
      // A 5xx from the gateway layer is our fault, and its message says why —
      // which environment variable is unset, which internal host would not
      // answer. That belongs in the log, not in a reply to a bidder's phone.
      // A 4xx is the gateway declining the charge, and the bidder needs to
      // read that one.
      const serverSide = error.status >= 500;
      if (serverSide) console.error('[bidding] payment gateway failure', error);
      throw new BidRejected(
        serverSide
          ? 'Payments are temporarily unavailable. Please try again shortly.'
          : error.message,
        'PAYMENT_FAILED',
        error.status,
        error.debug
      );
    }
    throw error;
  }
}

/**
 * Whether a confirmation may be applied to a bid, and whether doing so means
 * bringing a voided one back.
 *
 * `revive` is for manual reconciliation only. A bid whose payment never
 * confirmed in time is voided by the timeout sweep, and once it is voided the
 * ordinary path can no longer confirm it — so an operator who later establishes
 * from the gateway statement that the fee *was* collected had no way to make
 * that bid count, and the bidder never saw it again in My Bids. With `revive`
 * the same confirmation is applied to a bid voided for non-payment, which is
 * exactly the situation manual reconciliation exists for. A round that has
 * already been decided is still refused: adding a bid to it after the fact
 * would change a result bidders have been told.
 */
export function confirmDecision(
  bid: { status: string },
  auction: { code: string; status: string },
  revive = false
): { confirm: boolean; reviving: boolean; alreadyActive?: boolean; reason?: string } {
  if (bid.status === 'ACTIVE') {
    return { confirm: true, reviving: false, alreadyActive: true, reason: 'Already confirmed.' };
  }

  // Voided or failed purely because the fee was never confirmed. REFUNDED is
  // deliberately excluded — that fee was handed back, and re-instating the bid
  // would count a bid nobody paid for.
  const reviving = revive && (bid.status === 'VOID' || bid.status === 'FAILED');

  if (bid.status !== 'PENDING_PAYMENT' && !reviving) {
    return {
      confirm: false,
      reviving: false,
      reason: `Bid is ${bid.status} and cannot be confirmed.`,
    };
  }

  if (reviving && (auction.status === 'SETTLED' || auction.status === 'CANCELLED')) {
    return {
      confirm: false,
      reviving: false,
      reason: `Auction #${auction.code} is already ${auction.status.toLowerCase()}, so this bid can no longer be counted. Reverse the payment to refund the fee instead.`,
    };
  }

  return { confirm: true, reviving };
}

/**
 * Marks a bid as paid and counted. Idempotent — payment gateways retry
 * callbacks, and a double-count would corrupt the auction counters.
 */
export async function confirmBid(
  bidId: string,
  meta: { source: string; txnRef?: string; paidByNumber?: string; revive?: boolean }
): Promise<{ confirmed: boolean; reason?: string; revived?: boolean }> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      auction: {
        select: { id: true, code: true, status: true, endAt: true, autoExtendMinutes: true },
      },
    },
  });
  if (!bid) return { confirmed: false, reason: 'Bid not found.' };

  const decision = confirmDecision(bid, bid.auction, meta.revive);
  if (!decision.confirm) return { confirmed: false, reason: decision.reason };
  if (decision.alreadyActive) return { confirmed: true, reason: decision.reason };
  const reviving = decision.reviving;

  const isFirstBidOnAuction =
    (await prisma.bid.count({
      where: { auctionId: bid.auctionId, bidderId: bid.bidderId, status: 'ACTIVE' },
    })) === 0;

  // A revived bid that was funded by a prepaid round has to take its credit
  // back — the void handed it out again when the bid stopped counting.
  if (reviving && bid.carriedOver) await claimBidCredit(bid.bidderId, bid.auctionId);

  await prisma.$transaction(async (tx) => {
    await tx.bid.update({
      where: { id: bidId },
      data: {
        status: 'ACTIVE',
        confirmedAt: new Date(),
        ...(reviving ? { voidedAt: null, voidReason: null } : {}),
      },
    });

    await tx.auction.update({
      where: { id: bid.auctionId },
      data: {
        bidCount: { increment: 1 },
        ...(isFirstBidOnAuction ? { bidderCount: { increment: 1 } } : {}),
      },
    });

    await tx.bidder.update({
      where: { id: bid.bidderId },
      data: {
        totalBids: { increment: 1 },
        totalSpent: { increment: bid.feeAmount },
        lastSeenAt: new Date(),
      },
    });
  });

  // Anti-sniping: a bid in the closing window pushes the end time out. A bid
  // being reconciled long after the fact is not a late bid arriving — it was
  // placed when it was placed — so it must not move the end time again.
  const extendMinutes = reviving ? 0 : bid.auction.autoExtendMinutes;
  if (extendMinutes > 0) {
    const remaining = bid.auction.endAt.getTime() - Date.now();
    if (remaining > 0 && remaining <= extendMinutes * 60 * 1000) {
      await prisma.auction.update({
        where: { id: bid.auctionId },
        data: {
          endAt: new Date(bid.auction.endAt.getTime() + extendMinutes * 60 * 1000),
          extendedCount: { increment: 1 },
        },
      });
      await createAuditLog({
        actorId: 'SYSTEM',
        actorType: 'SYSTEM',
        action: 'AUCTION_AUTO_EXTENDED',
        entity: 'Auction',
        entityId: bid.auctionId,
        details: { extendMinutes, triggeredByBidId: bidId },
      });
    }
  }

  await createAuditLog({
    actorId: 'SYSTEM',
    actorType: 'SYSTEM',
    action: 'BID_CONFIRMED',
    entity: 'Bid',
    entityId: bidId,
    details: {
      source: meta.source,
      txnRef: meta.txnRef,
      paidByNumber: meta.paidByNumber,
      ...(reviving ? { revivedFrom: bid.status, previousVoidReason: bid.voidReason } : {}),
    },
  });

  return { confirmed: true, revived: reviving };
}

/** Marks a bid failed when its payment does not go through. */
export async function failBid(bidId: string, reason: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid || bid.status === 'ACTIVE') return;

  await prisma.bid.update({
    where: { id: bidId },
    data: { status: 'FAILED', voidedAt: new Date(), voidReason: reason.slice(0, 400) },
  });

  // A bid that never counted must not consume the prepaid bid that funded it.
  if (bid.carriedOver) await releaseBidCredit(bid.bidderId, bid.auctionId);

  await createAuditLog({
    actorId: 'SYSTEM',
    actorType: 'SYSTEM',
    action: 'BID_FAILED',
    entity: 'Bid',
    entityId: bidId,
    details: { reason, carriedOver: bid.carriedOver },
  });
}
