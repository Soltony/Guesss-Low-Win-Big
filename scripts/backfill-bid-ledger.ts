/**
 * Publishes the bid ledger for auctions that settled before it existed.
 *
 *   npm run bids:backfill-ledger
 *
 * Settlement writes the ledger from now on. Anything already SETTLED has a
 * winner and a result but nothing for the mini-app's bid history sheet to
 * show, so this walks those auctions and builds the same snapshot from their
 * stored bids.
 *
 * Safe to re-run: an auction that already has a ledger is skipped unless
 * `--force` is passed, and publishing replaces a ledger rather than adding to
 * one. Nothing else about the auction is touched — the winner, the results and
 * the re-auction lineage are all left exactly as settlement decided them, so
 * this cannot change who won anything.
 *
 * Needs BID_ENCRYPTION_KEY, since it opens every bid amount to group them. An
 * auction holding a bid that will not decrypt is reported and skipped rather
 * than published half-complete.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { decryptBidAmount } from '../src/lib/bid-crypto';
import { buildBidLedger, publishBidLedger } from '../src/lib/bid-ledger';
import { rankUniqueBids } from '../src/lib/auction-engine';

const prisma = new PrismaClient();

async function main() {
  const force = process.argv.includes('--force');

  const settled = await prisma.auction.findMany({
    where: { status: 'SETTLED' },
    select: { id: true, code: true, title: true },
    orderBy: { settledAt: 'asc' },
  });

  console.log(`${settled.length} settled auction(s) to consider.`);

  let published = 0;
  let skipped = 0;
  let failed = 0;

  for (const auction of settled) {
    const existing = await prisma.auctionLedgerEntry.count({ where: { auctionId: auction.id } });
    if (existing > 0 && !force) {
      skipped += 1;
      continue;
    }

    const bids = await prisma.bid.findMany({
      where: { auctionId: auction.id, status: 'ACTIVE' },
      select: { id: true, bidderId: true, amountCipher: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const opened: { id: string; bidderId: string; amount: number; createdAt: Date }[] = [];
    let unreadable = 0;
    for (const bid of bids) {
      try {
        opened.push({
          id: bid.id,
          bidderId: bid.bidderId,
          amount: decryptBidAmount(bid.amountCipher, {
            auctionId: auction.id,
            bidderId: bid.bidderId,
          }),
          createdAt: bid.createdAt,
        });
      } catch {
        unreadable += 1;
      }
    }

    if (unreadable > 0) {
      // A ledger missing bids would misreport which amounts were matched, and
      // that is the one thing it exists to get right.
      console.error(
        `  #${auction.code} SKIPPED — ${unreadable} of ${bids.length} bid amounts failed to decrypt.`
      );
      failed += 1;
      continue;
    }

    const entries = buildBidLedger(opened, rankUniqueBids(opened));
    await publishBidLedger(auction.id, entries);
    published += 1;
    console.log(`  #${auction.code} — ${entries.length} amount(s) from ${bids.length} bid(s).`);
  }

  console.log(
    `\nDone. ${published} published, ${skipped} already had a ledger, ${failed} could not be read.`
  );
  if (skipped > 0 && !force) console.log('Pass --force to rebuild the ones that were skipped.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
