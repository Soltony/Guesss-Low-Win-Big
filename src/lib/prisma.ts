import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
    // Prisma's defaults are sized for a quiet request, not for the last ten
    // seconds of an auction. `maxWait` is how long a transaction may queue for
    // a pooled connection before it is abandoned: the default 2s is shorter
    // than the closing burst lasts, so confirmations failed with "Unable to
    // start a transaction in the given time" while the pool was merely busy.
    // `timeout` is how long an open transaction may run: the default 5s is
    // less than settling a few hundred bids takes, and a settlement that
    // overruns it dies mid-flight with "Transaction already closed".
    //
    // Both are ceilings, not reservations — a fast transaction still commits
    // as fast as it ever did. They only decide when to give up.
    transactionOptions: {
      maxWait: 10_000,
      timeout: 30_000,
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
