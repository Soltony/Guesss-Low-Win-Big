/**
 * Phase 1 of retiring the plaintext bid amount.
 *
 *   npm run bids:encrypt
 *
 * Adds `Bid.amountCipher`, seals every existing amount into it, and verifies
 * that each one opens back to exactly the number it came from. Nothing is
 * destroyed: `Bid.amount` is still there and still correct when this finishes,
 * so a rollback is "point the app at the old build" and nothing more.
 *
 * Safe to re-run — it only touches rows that have no ciphertext yet, so an
 * interrupted pass resumes where it stopped.
 *
 * Run this BEFORE deploying the code that reads `amountCipher`, and before
 * `prisma db push` (the schema no longer declares `amount`, so a push would
 * drop the very column this reads from). Phase 2 is a separate script:
 *
 *   npm run bids:drop-plaintext
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  decryptBidAmount,
  describeBidAmountKeys,
  encryptBidAmount,
  isBidAmountKeyConfigured,
} from '../src/lib/bid-crypto';

const BATCH = 500;

const prisma = new PrismaClient();

interface PlaintextRow {
  id: string;
  auctionId: string;
  bidderId: string;
  /** Read as text so a decimal never round-trips through a JS float. */
  amount: string;
}

async function columnExists(column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*) AS n
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Bid' AND COLUMN_NAME = ${column}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function main() {
  if (!isBidAmountKeyConfigured()) {
    throw new Error(
      'BID_ENCRYPTION_KEY is not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
        'and put it in .env before running this.'
    );
  }
  console.log(`[encrypt] active key ${describeBidAmountKeys().active}`);

  const hasPlaintext = await columnExists('amount');
  const hasCipher = await columnExists('amountCipher');

  if (!hasPlaintext && hasCipher) {
    console.log('[encrypt] Bid.amount is already gone — nothing to migrate.');
    return;
  }
  if (!hasPlaintext && !hasCipher) {
    throw new Error('Bid has neither `amount` nor `amountCipher`. Check you are on the right database.');
  }

  if (!hasCipher) {
    console.log('[encrypt] adding Bid.amountCipher (nullable for now)…');
    await prisma.$executeRawUnsafe(`ALTER TABLE [Bid] ADD [amountCipher] NVARCHAR(512) NULL`);
  }

  // ---- Seal ----
  let sealed = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<PlaintextRow[]>`
      SELECT TOP (${BATCH})
        [id], [auctionId], [bidderId], CONVERT(VARCHAR(40), [amount]) AS [amount]
      FROM [Bid]
      WHERE [amountCipher] IS NULL`;

    if (rows.length === 0) break;

    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) {
        throw new Error(`Bid ${row.id} has a non-numeric amount (${row.amount}); aborting.`);
      }
      const cipher = encryptBidAmount(amount, {
        auctionId: row.auctionId,
        bidderId: row.bidderId,
      });
      await prisma.$executeRaw`UPDATE [Bid] SET [amountCipher] = ${cipher} WHERE [id] = ${row.id}`;
    }

    sealed += rows.length;
    console.log(`[encrypt] sealed ${sealed} bid(s)…`);
  }

  // ---- Verify ----
  // Every row is re-read and opened. A migration that claims success without
  // this is a migration that silently loses the amounts it was protecting.
  console.log('[encrypt] verifying every row opens back to its original amount…');
  let checked = 0;
  let cursor = '';
  for (;;) {
    const rows = await prisma.$queryRaw<(PlaintextRow & { amountCipher: string })[]>`
      SELECT TOP (${BATCH})
        [id], [auctionId], [bidderId], [amountCipher],
        CONVERT(VARCHAR(40), [amount]) AS [amount]
      FROM [Bid]
      WHERE [id] > ${cursor}
      ORDER BY [id] ASC`;

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.amountCipher) throw new Error(`Bid ${row.id} still has no ciphertext.`);
      const opened = decryptBidAmount(row.amountCipher, {
        auctionId: row.auctionId,
        bidderId: row.bidderId,
      });
      const original = Number(row.amount);
      if (opened.toFixed(2) !== original.toFixed(2)) {
        throw new Error(
          `Bid ${row.id} does not round-trip: stored ${original.toFixed(2)}, opened ${opened.toFixed(2)}.`
        );
      }
    }

    checked += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`[encrypt] verified ${checked} bid(s)…`);
  }

  // ---- Lock the column down ----
  await prisma.$executeRawUnsafe(
    `ALTER TABLE [Bid] ALTER COLUMN [amountCipher] NVARCHAR(512) NOT NULL`
  );

  console.log(
    `\n[encrypt] done — ${checked} bid(s) sealed and verified.\n` +
      `Bid.amount is untouched. Deploy the new build, confirm the app reads bids\n` +
      `correctly, then run: npm run bids:drop-plaintext`
  );
}

main()
  .catch((error) => {
    console.error('\n[encrypt] FAILED —', error instanceof Error ? error.message : error);
    console.error('No plaintext was removed. Fix the cause and re-run; the pass resumes.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
