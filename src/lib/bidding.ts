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
import { AppLockError, acquireAppLock, bidderAuctionLock, type TxClient } from './db-lock';

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

/**
 * Whether a client-supplied idempotency key is one we are willing to store.
 *
 * The key is written to the bid row and read back to match a retry, so it is
 * constrained rather than trusted: it must fit `NVarChar(64)`, and it is held
 * to an opaque token alphabet so nothing that arrives here can carry meaning of
 * its own into a column that is later compared and rendered. Eight characters
 * is the floor because a key short enough to collide between two of a bidder's
 * own attempts would replay the wrong bid.
 *
 * Exported for its tests: this is the whole of what the server accepts, and it
 * is the kind of rule that quietly loosens.
 */
export function isValidRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export interface PlaceBidInput {
  auctionId: string;
  bidderId: string;
  amount: number;
  superAppToken: string;
  /** Session came from the authorization bypass — never charge a test bidder. */
  isTest?: boolean;
  /**
   * Idempotency key for this attempt. When the same bidder sends the same key
   * twice on one auction and the first attempt is still standing, the original
   * bid is returned instead of a second one being placed.
   */
  requestId?: string;
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
  /**
   * This request had already been recorded — the bid returned is the one the
   * earlier attempt placed, not a new one. The client uses it to skip straight
   * to watching the existing bid rather than trying to raise a payment sheet
   * for a fee that was already asked for.
   */
  replayed?: boolean;
}

/**
 * Whether the auction is still open, decided by the database rather than by
 * the application clock. Called inside the transaction that inserts the bid,
 * as the last thing before it commits, so a bid can only exist if the auction
 * was open at that moment; `SYSUTCDATETIME()` keeps that judgement on the one
 * clock every app instance shares. The conditions mirror `derivedStatus`
 * returning LIVE — pre-publication and terminal states are never live, a
 * window that has not opened yet is SCHEDULED, one that has passed is ENDED.
 */
async function auctionStillOpen(tx: TxClient, auctionId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM [Auction]
    WHERE [id] = ${auctionId}
      AND [startAt] <= SYSUTCDATETIME()
      AND [endAt] > SYSUTCDATETIME()
      AND [status] NOT IN ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'SETTLED')`;
  return rows.length > 0;
}

/**
 * Turns a failure to *reach* the database into something the bidder can act
 * on. A lock that could not be taken, or a connection that never came free, is
 * a busy platform rather than a bad bid: a 500 tells the bidder nothing and
 * invites the retry that made it busy, where a 503 saying "try again" does not.
 *
 * Exported for its tests: the line it draws — between a platform that is busy
 * and a bug — is the difference between a bidder who retries and one who is
 * told to give up, and it must not drift.
 */
export function asBidRejection(error: unknown): never {
  if (error instanceof BidRejected) throw error;

  // P2028 covers both halves of Prisma's transaction budget: no pooled
  // connection within `maxWait`, and an open transaction past its `timeout`.
  const code = (error as { code?: string } | null)?.code;
  if (error instanceof AppLockError || code === 'P2028') {
    console.error('[bidding] bid could not be recorded', error);
    throw new BidRejected(
      'We could not record your bid just now. Please try again.',
      'BID_BUSY',
      503
    );
  }
  throw error;
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

  // ---- Per-bidder limits, and the write ----
  //
  // Everything from here reads this bidder's own history and then decides what
  // to write from it: the per-bidder cap, the sequence number, the ban on
  // repeating your own amount, the prepaid-bid credit. None of those rules can
  // be handed to the database as a constraint — the amount is stored as a
  // random ciphertext, so there is nothing to index it on, and a failed bid's
  // sequence is deliberately reused, so a plain unique index would refuse a
  // legitimate retry. Read and write apart, n simultaneous requests all read
  // the same history and all pass, and in a lowest-unique-bid auction that is
  // not cosmetic: two identical amounts from one bidder cancel each other out,
  // so the bidder pays twice over to destroy the entry they were paying for.
  //
  // So the whole decision runs in one transaction, behind one lock named for
  // (auction, bidder). One bidder's own requests queue behind each other;
  // different bidders — which is what a closing burst actually is — never wait
  // on one another at all.
  const scope = { auctionId: auction.id, bidderId: bidder.id };
  const feesEnabled = Boolean(settings['payments.enabled']) && !input.isTest;
  const cooldown = Number(settings['bidding.cooldownSeconds']) || 0;

  const recorded = await prisma
    .$transaction(async (tx) => {
      await acquireAppLock(tx, bidderAuctionLock(auction.id, bidder.id));

      // Has this exact attempt already been recorded?
      //
      // Checked first, and inside the lock, because that is what makes it a
      // decision rather than a guess: the lock already serialises one bidder's
      // requests on one auction, so between this read and the insert below no
      // other request of theirs can slip a bid in.
      //
      // Only a bid that is still standing counts. If the earlier attempt ended
      // VOID or FAILED the bidder is entitled to try again, and replaying a
      // dead bid would tell them their live attempt had failed.
      if (input.requestId) {
        const previous = await tx.bid.findFirst({
          where: {
            auctionId: auction.id,
            bidderId: bidder.id,
            requestId: input.requestId,
            status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
          },
          select: {
            id: true,
            amountCipher: true,
            feeAmount: true,
            status: true,
            sequence: true,
            carriedOver: true,
          },
        });
        if (previous) return { replayed: true as const, previous };
      }

      const myBids = await tx.bid.findMany({
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

      // The bidder's own amounts, which they are always entitled to read.
      // Sealing and opening both happen against this (auction, bidder) pair, so
      // a failure here means the key is wrong rather than one row being odd —
      // and carrying on under the wrong key would write rows nobody can ever
      // settle. Stop instead.
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
      // No money changes hands in pilot mode or for a bypassed test session, so
      // the bid must record a zero fee — otherwise the bidder's "fees paid"
      // total and the revenue reports would claim income that was never
      // collected.
      //
      // A bid the bidder already paid for in an earlier round of this chain
      // costs nothing now. Claiming the credit here, on the transaction, is
      // what stops the same bid being charged twice: if the bid does not
      // survive to commit, the credit is handed back by the same rollback that
      // discards it, with no compensating write to get wrong.
      const sequence = myBids.length + 1;
      const carriedOver = feesEnabled ? await claimBidCredit(bidder.id, auction.id, tx) : false;
      const feeAmount = feesEnabled && !carriedOver ? toNum(auction.bidFee) : 0;

      const bid = await tx.bid.create({
        data: {
          auctionId: auction.id,
          bidderId: bidder.id,
          amountCipher,
          feeAmount,
          status: 'PENDING_PAYMENT',
          channel: input.isTest ? 'TEST' : 'MINIAPP',
          sequence,
          carriedOver,
          requestId: input.requestId ?? undefined,
          ipAddress: input.ipAddress ?? undefined,
          userAgent: input.userAgent?.slice(0, 1000) ?? undefined,
        },
      });

      // ---- The closing deadline ----
      // The status check at the top of this function is ten round trips behind
      // us by now. Under load that gap ran to over a second, and a bid that
      // passed the check at T-0.2s could land at T+1.2s and be counted by
      // settlement — the worse the contention, the wider the window, which is
      // exactly when it matters. Asking again here, of the database clock and
      // in the same transaction as the insert, leaves a window no wider than
      // the commit; a bid that loses it is rolled back rather than recorded
      // late.
      if (!(await auctionStillOpen(tx, auction.id))) {
        throw new BidRejected('This auction has already closed.', 'AUCTION_NOT_LIVE', 409);
      }

      return { replayed: false as const, bid, sequence, feeAmount, carriedOver };
    })
    .catch(asBidRejection);

  // A replay returns the bid the first attempt placed and stops here: no audit
  // row for work that was already recorded, no second confirmation, and above
  // all no second trip to the payment gateway. The bidder is being told what
  // happened, not doing something new.
  if (recorded.replayed) {
    const { previous } = recorded;
    return {
      bidId: previous.id,
      // Opened from the stored ciphertext rather than echoed from the request:
      // what the bidder needs to see is the amount that is actually recorded.
      amount: decryptBidAmount(previous.amountCipher, scope),
      feeAmount: toNum(previous.feeAmount),
      status: previous.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_PAYMENT',
      sequence: previous.sequence,
      remainingBids: Math.max(0, auction.maxBidsPerUser - previous.sequence),
      carriedOver: previous.carriedOver,
      carriedBidsRemaining: previous.carriedOver
        ? await remainingCredits(bidder.id, auction.id)
        : 0,
      replayed: true,
    };
  }

  const { bid, sequence, feeAmount, carriedOver } = recorded;
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

  // A cheap first look, so a retried callback for a bid that already counted
  // costs one read rather than a transaction and a lock.
  const glance = confirmDecision(bid, bid.auction, meta.revive);
  if (!glance.confirm) return { confirmed: false, reason: glance.reason };
  if (glance.alreadyActive) return { confirmed: true, reason: glance.reason };

  // Applying it takes the same (auction, bidder) lock `placeBid` takes, and the
  // status it decides from is re-read inside it. Gateways retry their
  // callbacks, and two retries that both passed the cheap glance above would
  // otherwise both count the same bid — against the bidder's totals, and
  // against their prepaid credit.
  type Applied =
    | { applied: true; reviving: boolean; previousStatus: string }
    | { applied: false; alreadyActive?: boolean; reason?: string };

  const outcome: Applied = await prisma
    .$transaction(async (tx): Promise<Applied> => {
      await acquireAppLock(tx, bidderAuctionLock(bid.auctionId, bid.bidderId));

      const fresh = await tx.bid.findUnique({ where: { id: bidId }, select: { status: true } });
      if (!fresh) return { applied: false, reason: 'Bid not found.' };

      const decision = confirmDecision(fresh, bid.auction, meta.revive);
      if (!decision.confirm) return { applied: false, reason: decision.reason };
      if (decision.alreadyActive) {
        return { applied: false, alreadyActive: true, reason: decision.reason };
      }
      const reviving = decision.reviving;

      // A revived bid that was funded by a prepaid round has to take its credit
      // back — the void handed it out again when the bid stopped counting.
      if (reviving && bid.carriedOver) await claimBidCredit(bid.bidderId, bid.auctionId, tx);

      await tx.bid.update({
        where: { id: bidId },
        data: {
          status: 'ACTIVE',
          confirmedAt: new Date(),
          ...(reviving ? { voidedAt: null, voidReason: null } : {}),
        },
      });

      // The auction's `bidCount` and `bidderCount` are deliberately NOT touched
      // here.
      //
      // They used to be incremented on this transaction, and that single write
      // was the platform's throughput ceiling. Every bidder on an auction takes
      // an exclusive lock on the same Auction row and holds it until this
      // transaction commits, so bidders who share an auction — which is all of
      // them — serialise on one row. Under load that is not a small effect: a
      // fifteen-minute run at 500 bidders spent 25,232,853 ms waiting on locks
      // against 108,689 ms waiting on the transaction log, with 47 sessions
      // blocked at once while the CPU sat at 22%. Nothing was busy; everything
      // was queueing.
      //
      // The counters are display figures, so they are now derived instead:
      // `refreshAuctionCounters` recomputes them once a maintenance pass for
      // every live auction, and settlement writes them exactly from the bids it
      // has already loaded. Where the count has to be *right* rather than
      // recent — deciding whether an auction's economics may still be edited —
      // the caller counts bids directly.
      await tx.bidder.update({
        where: { id: bid.bidderId },
        data: {
          totalBids: { increment: 1 },
          totalSpent: { increment: bid.feeAmount },
          lastSeenAt: new Date(),
        },
      });

      return { applied: true, reviving, previousStatus: fresh.status };
    })
    .catch(asBidRejection);

  // Lost the race to another caller, or the bid moved on under the lock. Either
  // way this call must not go on to extend the auction or write an audit row
  // for work it did not do.
  if (!outcome.applied) {
    return { confirmed: Boolean(outcome.alreadyActive), reason: outcome.reason };
  }
  const reviving = outcome.reviving;

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
      ...(reviving
        ? { revivedFrom: outcome.previousStatus, previousVoidReason: bid.voidReason }
        : {}),
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
