import prisma from './prisma';

const HOUR_MS = 60 * 60 * 1000;

/**
 * When a winner recorded at `start` loses the right to claim.
 *
 * Settlement and runner-up promotion both measure from the moment they record
 * the winner, and that is the moment `Winner.createdAt` holds, so re-applying a
 * changed window from `createdAt` lands where settlement would have put it.
 */
export function claimDeadlineFrom(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * HOUR_MS);
}

/**
 * Moves every unclaimed winner's deadline onto a new claim window.
 *
 * The deadline is stored on the winner so the claim API, the reminders and the
 * admin board all read one date. Without this, changing the window only reached
 * auctions settled afterwards, and an admin who widened it to give a winner more
 * time found the old deadline still enforced. A longer window can reopen a claim
 * that had lapsed and a shorter one can close one early; winners who already
 * claimed, or were forfeited, keep the date they had.
 */
export async function applyClaimWindowToPendingWinners(hours: number): Promise<number> {
  const pending = await prisma.winner.findMany({
    where: { status: 'PENDING_CLAIM' },
    select: { id: true, createdAt: true },
  });
  if (pending.length === 0) return 0;

  // Re-checking the status on each write leaves alone a winner who claimed
  // between the read and the update.
  const results = await prisma.$transaction(
    pending.map((winner) =>
      prisma.winner.updateMany({
        where: { id: winner.id, status: 'PENDING_CLAIM' },
        data: { claimDeadline: claimDeadlineFrom(winner.createdAt, hours) },
      })
    )
  );
  return results.reduce((sum, r) => sum + r.count, 0);
}
