import prisma from './prisma';
import { getSettings } from './settings';
import { createAuditLog } from './audit-log';
import { round2, toNum } from './format';
import { derivedStatus } from './auction-engine';
import { PaymentError, initiateBidFeePayment } from './payment-gateway';

export class BidRejected extends Error {
  status: number;
  code: string;
  constructor(message: string, code = 'BID_REJECTED', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface PlaceBidInput {
  auctionId: string;
  bidderId: string;
  amount: number;
  superAppToken: string;
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
  remainingBids: number;
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

  // ---- Per-bidder limits ----
  const myBids = await prisma.bid.findMany({
    where: {
      auctionId: auction.id,
      bidderId: bidder.id,
      status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
    },
    select: { amount: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (myBids.length >= auction.maxBidsPerUser) {
    throw new BidRejected(
      `You have reached the limit of ${auction.maxBidsPerUser} bids on this auction.`,
      'LIMIT_REACHED',
      409
    );
  }

  if (!settings['bidding.allowRepeatOwnAmount']) {
    const already = myBids.some((b) => toNum(b.amount).toFixed(2) === amount.toFixed(2));
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
  // In pilot mode no money changes hands, so the bid must record a zero fee —
  // otherwise the bidder's "fees paid" total and the revenue reports would
  // claim income that was never collected.
  const feesEnabled = Boolean(settings['payments.enabled']);
  const feeAmount = feesEnabled ? toNum(auction.bidFee) : 0;
  const sequence = myBids.length + 1;

  const bid = await prisma.bid.create({
    data: {
      auctionId: auction.id,
      bidderId: bidder.id,
      amount,
      feeAmount,
      status: 'PENDING_PAYMENT',
      channel: 'MINIAPP',
      sequence,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent?.slice(0, 1000) ?? undefined,
    },
  });

  await createAuditLog({
    actorId: bidder.phoneNumber,
    actorName: bidder.fullName,
    actorType: 'BIDDER',
    action: 'BID_PLACED',
    entity: 'Bid',
    entityId: bid.id,
    details: { auctionId: auction.id, auctionCode: auction.code, amount, feeAmount, sequence },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  const remainingBids = auction.maxBidsPerUser - sequence;

  // Fees disabled (pilot mode): confirm immediately, no gateway round-trip.
  if (!feesEnabled || feeAmount <= 0) {
    await confirmBid(bid.id, { source: 'NO_FEE' });
    return {
      bidId: bid.id,
      amount,
      feeAmount,
      status: 'ACTIVE',
      sequence,
      remainingBids,
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
      remainingBids,
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
      throw new BidRejected(error.message, 'PAYMENT_FAILED', error.status);
    }
    throw error;
  }
}

/**
 * Marks a bid as paid and counted. Idempotent — payment gateways retry
 * callbacks, and a double-count would corrupt the auction counters.
 */
export async function confirmBid(
  bidId: string,
  meta: { source: string; txnRef?: string; paidByNumber?: string }
): Promise<{ confirmed: boolean; reason?: string }> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: { auction: { select: { id: true, code: true, endAt: true, autoExtendMinutes: true } } },
  });
  if (!bid) return { confirmed: false, reason: 'Bid not found.' };
  if (bid.status === 'ACTIVE') return { confirmed: true, reason: 'Already confirmed.' };
  if (bid.status !== 'PENDING_PAYMENT') {
    return { confirmed: false, reason: `Bid is ${bid.status} and cannot be confirmed.` };
  }

  const isFirstBidOnAuction =
    (await prisma.bid.count({
      where: { auctionId: bid.auctionId, bidderId: bid.bidderId, status: 'ACTIVE' },
    })) === 0;

  await prisma.$transaction(async (tx) => {
    await tx.bid.update({
      where: { id: bidId },
      data: { status: 'ACTIVE', confirmedAt: new Date() },
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

  // Anti-sniping: a bid in the closing window pushes the end time out.
  const extendMinutes = bid.auction.autoExtendMinutes;
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
    details: { source: meta.source, txnRef: meta.txnRef, paidByNumber: meta.paidByNumber },
  });

  return { confirmed: true };
}

/** Marks a bid failed when its payment does not go through. */
export async function failBid(bidId: string, reason: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid || bid.status === 'ACTIVE') return;

  await prisma.bid.update({
    where: { id: bidId },
    data: { status: 'FAILED', voidedAt: new Date(), voidReason: reason.slice(0, 400) },
  });

  await createAuditLog({
    actorId: 'SYSTEM',
    actorType: 'SYSTEM',
    action: 'BID_FAILED',
    entity: 'Bid',
    entityId: bidId,
    details: { reason },
  });
}
