/**
 * Phase 2 of retiring the plaintext bid amount.
 *
 *   npm run bids:drop-plaintext
 *
 * Drops `Bid.amount`. This is the irreversible half, so it re-verifies the
 * whole table first and refuses to touch anything unless every single row's
 * ciphertext opens back to exactly the plaintext it is about to delete.
 *
 * Run it only after `npm run bids:encrypt` has completed and the new build has
 * been serving traffic long enough that you trust it. Take a database backup
 * first — once this finishes, the ciphertext and the key are the only copies of
 * your bid amounts.
 *
 * Pass --dry-run to verify without dropping anything.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { decryptBidAmount, describeBidAmountKeys, isBidAmountKeyConfigured } from '../src/lib/bid-crypto';

const BATCH = 500;
const dryRun = process.argv.includes('--dry-run');

const prisma = new PrismaClient();

interface Row {
  id: string;
  auctionId: string;
  bidderId: string;
  amount: string;
  amountCipher: string | null;
}

async function columnExists(column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*) AS n
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Bid' AND COLUMN_NAME = ${column}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Index names that mention the column, so the drop is not blocked by one. */
async function indexesOnAmount(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT DISTINCT i.name AS name
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID('Bid') AND c.name = 'amount' AND i.name IS NOT NULL`;
  return rows.map((r) => r.name);
}

async function main() {
  if (!isBidAmountKeyConfigured()) {
    throw new Error('BID_ENCRYPTION_KEY is not set — refusing to drop plaintext that nothing can replace.');
  }
  console.log(`[drop] active key ${describeBidAmountKeys().active}`);

  if (!(await columnExists('amount'))) {
    console.log('[drop] Bid.amount is already gone — nothing to do.');
    return;
  }
  if (!(await columnExists('amountCipher'))) {
    throw new Error('Bid.amountCipher does not exist. Run `npm run bids:encrypt` first.');
  }

  // ---- Full verification, no sampling ----
  console.log('[drop] verifying every bid opens back to its plaintext amount…');
  let checked = 0;
  let cursor = '';
  for (;;) {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT TOP (${BATCH})
        [id], [auctionId], [bidderId], [amountCipher],
        CONVERT(VARCHAR(40), [amount]) AS [amount]
      FROM [Bid]
      WHERE [id] > ${cursor}
      ORDER BY [id] ASC`;

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.amountCipher) {
        throw new Error(`Bid ${row.id} has no ciphertext. Re-run \`npm run bids:encrypt\`.`);
      }
      const opened = decryptBidAmount(row.amountCipher, {
        auctionId: row.auctionId,
        bidderId: row.bidderId,
      });
      const original = Number(row.amount);
      if (opened.toFixed(2) !== original.toFixed(2)) {
        throw new Error(
          `Bid ${row.id} does not round-trip: stored ${original.toFixed(2)}, opened ${opened.toFixed(2)}. ` +
            `Nothing has been dropped.`
        );
      }
    }

    checked += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`[drop] verified ${checked} bid(s)…`);
  }

  if (dryRun) {
    console.log(`\n[drop] --dry-run: ${checked} bid(s) verified. Nothing was changed.`);
    return;
  }

  // ---- Drop ----
  for (const index of await indexesOnAmount()) {
    console.log(`[drop] dropping index ${index}…`);
    await prisma.$executeRawUnsafe(`DROP INDEX [${index}] ON [Bid]`);
  }

  console.log('[drop] dropping column Bid.amount…');
  await prisma.$executeRawUnsafe(`ALTER TABLE [Bid] DROP COLUMN [amount]`);

  console.log(
    `\n[drop] done — ${checked} bid(s) verified, plaintext column removed.\n` +
      `Bid amounts now exist only as ciphertext. Guard BID_ENCRYPTION_KEY accordingly:\n` +
      `losing it means losing every amount, including settled results.`
  );
}

main()
  .catch((error) => {
    console.error('\n[drop] FAILED —', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
