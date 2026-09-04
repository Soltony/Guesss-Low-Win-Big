import { Prisma } from '@prisma/client';

/**
 * Serialising a read-then-write against SQL Server.
 *
 * Several bidding rules are "look at what is already there, then decide whether
 * to write" — the per-bidder bid cap, the sequence number, the ban on repeating
 * your own amount, whether a confirmation is this bidder's first on an auction.
 * None of them can be expressed as a database constraint: the amount is stored
 * as a random ciphertext so nothing can be indexed on it, and the sequence is
 * reused when a bid fails, so a plain unique index would refuse a legitimate
 * retry. Left unguarded, n simultaneous requests all read the same history and
 * all write, and the rule holds for none of them.
 *
 * `sp_getapplock` is the lock that fits: it is held by the transaction, it is
 * taken on a name we choose rather than on rows, and it lives in the database
 * so it still serialises when the app runs as more than one instance. Every
 * caller takes it exclusively and takes only one, so there is no lock ordering
 * to get wrong and no deadlock to retry.
 *
 * The key is per (auction, bidder). Two bidders on the same auction never wait
 * on each other — which matters, because the burst these rules have to survive
 * is thousands of *different* bidders arriving in the last seconds.
 */

/** A Prisma client bound to an open interactive transaction. */
export type TxClient = Prisma.TransactionClient;

/** How long to wait for the lock before giving up rather than queueing forever. */
const DEFAULT_TIMEOUT_MS = 10_000;

export class AppLockError extends Error {
  resource: string;
  code: number;
  constructor(resource: string, code: number) {
    super(`Could not acquire lock ${resource} (sp_getapplock returned ${code}).`);
    this.name = 'AppLockError';
    this.resource = resource;
    this.code = code;
  }
}

/**
 * The lock name for one bidder's activity on one auction. Everything that reads
 * a bidder's own bid history and then writes to it must take this same key, or
 * it is not serialised against the paths that do.
 */
export function bidderAuctionLock(auctionId: string, bidderId: string): string {
  return `guesslow:bid:${auctionId}:${bidderId}`;
}

/**
 * Takes an exclusive application lock for the life of `tx`. SQL Server releases
 * it when the transaction commits or rolls back, so there is no unlock path to
 * forget and a crashed request cannot strand it.
 *
 * Return codes: 0 granted, 1 granted after waiting, -1 timed out, -2 cancelled,
 * -3 chosen as a deadlock victim, -999 a bad parameter. Anything negative is a
 * refusal to proceed — the caller must fail rather than carry on unserialised,
 * because carrying on is precisely the race this exists to close.
 */
export async function acquireAppLock(
  tx: TxClient,
  resource: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<void> {
  const rows = await tx.$queryRaw<{ rc: number }[]>`
    DECLARE @rc int;
    EXEC @rc = sp_getapplock
      @Resource = ${resource},
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = ${timeoutMs};
    SELECT @rc AS rc;`;

  const code = rows[0]?.rc ?? -999;
  if (code < 0) throw new AppLockError(resource, code);
}
