import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { requestChange, requiresApproval } from '@/lib/approvals';
import { settleAuction } from '@/lib/auction-engine';
import { notify } from '@/lib/notifications';
import { getSettings } from '@/lib/settings';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Lifecycle actions for one auction: publish, cancel, settle, re-settle.
 *
 * When maker-checker is enabled for an action, this records a PendingChange
 * and returns `pending: true` instead of applying it — the approver in
 * /admin/approvals is what actually executes it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  const { id } = await params;

  const auction = await prisma.auction.findUnique({ where: { id } });
  if (!auction) return jsonError('Auction not found', 404);

  switch (action) {
    case 'publish': {
      const guard = await requirePermission('auctions', 'update');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      if (auction.status !== 'DRAFT' && auction.status !== 'PENDING_APPROVAL') {
        return jsonError('Only a draft auction can be published.', 409);
      }
      if (auction.endAt <= new Date()) {
        return jsonError('The end time is in the past — update it before publishing.', 400);
      }

      if (await requiresApproval('publish')) {
        await prisma.auction.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
        const change = await requestChange({
          entityType: 'Auction',
          entityId: id,
          action: 'PUBLISH',
          payload: { status: 'PUBLISH' },
          previousData: { status: auction.status },
          summary: `Publish auction #${auction.code} — ${auction.title}`,
          user,
        });
        return NextResponse.json({
          pending: true,
          changeId: change.id,
          message: 'Publication sent for approval.',
        });
      }

      const status = auction.startAt <= new Date() ? 'LIVE' : 'SCHEDULED';
      await prisma.auction.update({
        where: { id },
        data: { status, publishedAt: new Date() },
      });

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'AUCTION_PUBLISHED',
        entity: 'Auction',
        entityId: id,
        details: { code: auction.code, status },
      });

      return NextResponse.json({ ok: true, status });
    }

    case 'cancel': {
      const guard = await requirePermission('auctions', 'update');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      const reason = String(body?.reason || '').trim();
      if (!reason) return jsonError('A cancellation reason is required.', 400);
      if (auction.status === 'SETTLED') {
        return jsonError('A settled auction cannot be cancelled.', 409);
      }
      if (auction.status === 'CANCELLED') {
        return jsonError('This auction is already cancelled.', 409);
      }

      if (await requiresApproval('publish')) {
        const change = await requestChange({
          entityType: 'Auction',
          entityId: id,
          action: 'CANCEL',
          payload: { reason },
          previousData: { status: auction.status },
          summary: `Cancel auction #${auction.code} — ${reason}`,
          user,
        });
        return NextResponse.json({
          pending: true,
          changeId: change.id,
          message: 'Cancellation sent for approval.',
        });
      }

      await prisma.auction.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledReason: reason },
      });

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'AUCTION_CANCELLED',
        entity: 'Auction',
        entityId: id,
        details: { code: auction.code, reason, bidCount: auction.bidCount },
      });

      return NextResponse.json({ ok: true });
    }

    case 'settle':
    case 'resettle': {
      const guard = await requirePermission('auctions', 'approve');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      const force = action === 'resettle';
      if (force && auction.status !== 'SETTLED') {
        return jsonError('Only a settled auction can be re-settled.', 409);
      }
      if (!force && auction.status !== 'ENDED') {
        return jsonError('Only an ended auction can be settled.', 409);
      }

      if (await requiresApproval('settlement')) {
        const change = await requestChange({
          entityType: 'Auction',
          entityId: id,
          action: 'SETTLE',
          payload: { force },
          previousData: { status: auction.status, winnerBidId: auction.winnerBidId },
          summary: `${force ? 'Re-settle' : 'Settle'} auction #${auction.code} — ${auction.title}`,
          user,
        });
        return NextResponse.json({
          pending: true,
          changeId: change.id,
          message: `${force ? 'Re-settlement' : 'Settlement'} sent for approval.`,
        });
      }

      const result = await settleAuction(id, { id: user.id, name: user.fullName }, { force });
      if (!result.settled) return jsonError(result.reason || 'Settlement failed.', 409);

      await notifyWinner(id);
      return NextResponse.json({ ok: true, result });
    }

    case 'feature': {
      const guard = await requirePermission('auctions', 'update');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      const featured = Boolean(body?.featured);
      await prisma.auction.update({ where: { id }, data: { featured } });

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: featured ? 'AUCTION_FEATURED' : 'AUCTION_UNFEATURED',
        entity: 'Auction',
        entityId: id,
      });

      return NextResponse.json({ ok: true, featured });
    }

    default:
      return jsonError(`Unsupported action: ${action || '(none)'}`, 400);
  }
}

/** Best-effort winner SMS; a messaging failure must not fail the settlement. */
async function notifyWinner(auctionId: string) {
  try {
    const settings = await getSettings();
    if (!settings['notifications.onWin']) return;

    const winner = await prisma.winner.findUnique({
      where: { auctionId },
      include: {
        bidder: { select: { phoneNumber: true, language: true } },
        auction: { select: { code: true, title: true, currency: true } },
      },
    });
    if (!winner) return;

    await notify({
      code: 'WINNER_ANNOUNCED',
      recipient: winner.bidder.phoneNumber,
      language: winner.bidder.language === 'am' ? 'am' : 'en',
      bidderId: winner.bidderId,
      auctionId,
      vars: {
        title: winner.auction.title,
        code: winner.auction.code,
        amount: toNum(winner.amount).toFixed(2),
        currency: winner.auction.currency,
        deadline: winner.claimDeadline?.toLocaleString('en-GB') ?? '',
      },
    });
  } catch (error) {
    console.error('[auctions] winner notification failed', error);
  }
}
