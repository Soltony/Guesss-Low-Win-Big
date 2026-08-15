import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from './prisma';
import { createAuditLog } from './audit-log';
import {
  parseParticipantText,
  rowsToEntries,
  withoutExisting,
  type ParsedList,
  type ParticipantEntry,
} from './eligibility-list';
import type { EligibilityMode } from './types';

/**
 * Restricted auctions.
 *
 * An auction is normally open to every bidder. An operator can instead upload a
 * list of phone numbers, and from that point the auction admits nobody else —
 * a staff sale, a loyalty draw, a branch promotion.
 *
 * The list is keyed by phone number, not by bidder, for one reason: the people
 * on it usually have no Bidder row yet. They get one the first time they open
 * the mini-app, and the number they arrive with is the number the list was
 * uploaded against, so the match works without anything having to be linked up
 * afterwards.
 *
 * Parsing lives in `eligibility-list.ts`, free of Prisma, so it can be tested
 * on its own.
 */

export {
  parseParticipantText,
  isValidParticipantPhone,
  PARTICIPANT_TEMPLATE_CSV,
  type ParsedList,
  type ParticipantEntry,
  type RejectedRow,
} from './eligibility-list';

/** What a bidder who is not on the list is told. */
export const NOT_ON_LIST_MESSAGE =
  'This auction is open to invited participants only, and your number is not on the list.';

/** What an operator is told when the auction is restricted but nothing is uploaded. */
export const EMPTY_LIST_MESSAGE =
  'This auction is restricted to an invited list, but no participants have been uploaded yet.';

export interface EligibilityCheck {
  eligible: boolean;
  reason?: string;
}

/** The Prisma client, or the transaction client handed to `$transaction`. */
type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

export type RestrictedAuction = { id: string; eligibilityMode: string };

export function isRestricted(auction: RestrictedAuction): boolean {
  return auction.eligibilityMode === ('RESTRICTED' satisfies EligibilityMode);
}

/**
 * Whether one phone number may take part in this auction.
 *
 * An open auction admits everyone without a query. A restricted one with an
 * empty list admits nobody — that is the honest reading of "only these people
 * may bid" when the list is empty, and publishing such an auction is blocked
 * separately so operators never hit it by accident.
 */
export async function participantEligibility(
  auction: RestrictedAuction,
  phoneNumber: string
): Promise<EligibilityCheck> {
  if (!isRestricted(auction)) return { eligible: true };

  const listed = await prisma.auctionParticipant.findUnique({
    where: { auctionId_phoneNumber: { auctionId: auction.id, phoneNumber } },
    select: { id: true },
  });

  return listed ? { eligible: true } : { eligible: false, reason: NOT_ON_LIST_MESSAGE };
}

export async function participantCount(auctionId: string): Promise<number> {
  return prisma.auctionParticipant.count({ where: { auctionId } });
}

/**
 * Restricted auctions this bidder is not invited to, keyed by auction id.
 *
 * The list views render a bid form behind every card, so they need the answer
 * for a whole page in one pass rather than a query per card. Only auctions that
 * are actually restricted can appear here, and only ones a bidder could still
 * bid on — which is a handful at most.
 */
export async function blockedAuctionIds(
  bidderId: string | undefined
): Promise<Record<string, string>> {
  if (!bidderId) return {};

  const bidder = await prisma.bidder.findUnique({
    where: { id: bidderId },
    select: { phoneNumber: true },
  });
  if (!bidder) return {};

  const restricted = await prisma.auction.findMany({
    where: { eligibilityMode: 'RESTRICTED', status: { in: ['SCHEDULED', 'LIVE'] } },
    select: { id: true },
  });
  if (restricted.length === 0) return {};

  const invited = await prisma.auctionParticipant.findMany({
    where: {
      phoneNumber: bidder.phoneNumber,
      auctionId: { in: restricted.map((auction) => auction.id) },
    },
    select: { auctionId: true },
  });
  const allowed = new Set(invited.map((row) => row.auctionId));

  return Object.fromEntries(
    restricted
      .filter((auction) => !allowed.has(auction.id))
      .map((auction) => [auction.id, NOT_ON_LIST_MESSAGE])
  );
}

/** Phone numbers already on the list, for de-duplicating an append import. */
async function existingNumbers(auctionId: string): Promise<Set<string>> {
  const rows = await prisma.auctionParticipant.findMany({
    where: { auctionId },
    select: { phoneNumber: true },
  });
  return new Set(rows.map((row) => row.phoneNumber));
}

export interface ImportSummary {
  added: number;
  /** Already on the list, so nothing was changed for them. */
  skipped: number;
  /** Removed by a replace import. */
  removed: number;
  /** Rows in the file the same number appeared in more than once. */
  duplicatesInFile: number;
  rejected: ParsedList['rejected'];
  total: number;
}

export interface ImportInput {
  auctionId: string;
  entries: ParticipantEntry[];
  /** `replace` clears the list first; `append` adds to it. */
  mode: 'replace' | 'append';
  actor: { id: string; fullName: string };
  source?: string;
  /** Carried through from the parse so the caller sees one summary. */
  parsed?: Pick<ParsedList, 'rejected' | 'duplicates'>;
}

/**
 * Writes an uploaded list to an auction.
 *
 * A replace is done inside a transaction so the auction is never briefly left
 * with a half-applied list — on a restricted auction that window would be one
 * in which live bidders are wrongly turned away.
 */
export async function importParticipants(input: ImportInput): Promise<ImportSummary> {
  const { auctionId, entries, mode, actor } = input;

  const before = await existingNumbers(auctionId);
  const { fresh, skipped } =
    mode === 'replace'
      ? { fresh: entries, skipped: 0 }
      : withoutExisting(entries, before);

  const removed = mode === 'replace' ? before.size : 0;

  await prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.auctionParticipant.deleteMany({ where: { auctionId } });
    }
    if (fresh.length > 0) {
      await tx.auctionParticipant.createMany({
        data: fresh.map((entry) => ({
          auctionId,
          phoneNumber: entry.phoneNumber,
          fullName: entry.fullName,
          note: entry.note,
          source: input.source ?? 'UPLOAD',
          addedById: actor.id,
        })),
      });
    }
  });

  const total = await participantCount(auctionId);

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'AUCTION_PARTICIPANTS_IMPORTED',
    entity: 'Auction',
    entityId: auctionId,
    details: {
      mode,
      added: fresh.length,
      skipped,
      removed,
      rejected: input.parsed?.rejected.length ?? 0,
      duplicatesInFile: input.parsed?.duplicates ?? 0,
      total,
    },
  });

  return {
    added: fresh.length,
    skipped,
    removed,
    duplicatesInFile: input.parsed?.duplicates ?? 0,
    rejected: input.parsed?.rejected ?? [],
    total,
  };
}

/** Removes every participant from an auction. */
export async function clearParticipants(
  auctionId: string,
  actor: { id: string; fullName: string }
): Promise<number> {
  const { count } = await prisma.auctionParticipant.deleteMany({ where: { auctionId } });

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'AUCTION_PARTICIPANTS_CLEARED',
    entity: 'Auction',
    entityId: auctionId,
    details: { removed: count },
  });

  return count;
}

/**
 * Bidders who have already bid on this auction but are not on its list.
 *
 * Restricting an auction that is already running, or editing the list under
 * one, can strand people who have paid for bids. The number is surfaced in the
 * admin so that is a decision rather than an accident.
 */
export async function unlistedBidderCount(auction: RestrictedAuction): Promise<number> {
  if (!isRestricted(auction)) return 0;

  const [bidders, listed] = await Promise.all([
    prisma.bid.findMany({
      where: { auctionId: auction.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      select: { bidder: { select: { phoneNumber: true } } },
      distinct: ['bidderId'],
    }),
    existingNumbers(auction.id),
  ]);

  return bidders.filter((bid) => !listed.has(bid.bidder.phoneNumber)).length;
}

/**
 * Copies a list onto another auction — used when a re-auction round is opened,
 * so a restricted auction stays restricted to the same people across the whole
 * chain instead of quietly reopening to everyone.
 *
 * Takes the client to run on, so the caller can do this inside the transaction
 * that creates the new round: a round that exists without its list would be
 * one that turns away every one of its own invitees.
 */
export async function copyParticipants(
  client: PrismaClientLike,
  fromAuctionId: string,
  toAuctionId: string,
  actorId?: string | null
): Promise<number> {
  const source = await client.auctionParticipant.findMany({
    where: { auctionId: fromAuctionId },
    select: { phoneNumber: true, fullName: true, note: true },
  });
  if (source.length === 0) return 0;

  await client.auctionParticipant.createMany({
    data: source.map((entry) => ({
      auctionId: toAuctionId,
      phoneNumber: entry.phoneNumber,
      fullName: entry.fullName,
      note: entry.note,
      source: 'INHERITED',
      addedById: actorId ?? null,
    })),
  });

  return source.length;
}

/**
 * Reads an uploaded file into entries.
 *
 * CSV and plain text are parsed directly; `.xlsx` goes through ExcelJS, which
 * is loaded on demand so the mini-app bundle never pulls it in. Only the first
 * worksheet is read — a workbook with the list on a second tab is worth an
 * explicit error rather than a silent import of nothing.
 */
export async function readParticipantFile(file: File): Promise<ParsedList> {
  const name = 'name' in file ? String(file.name).toLowerCase() : '';

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { entries: [], rejected: [], duplicates: 0, headerDetected: false };
    }

    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // `row.values` is 1-based with a hole at index 0, and a numeric phone
      // cell arrives as a number — which would have dropped its leading zero
      // back when Excel saved it, so normalisation still has to cope.
      const values = Array.isArray(row.values) ? row.values : [];
      for (let index = 1; index < values.length; index += 1) {
        cells.push(cellText(values[index]));
      }
      rows.push(cells);
    });

    return rowsToEntries(rows);
  }

  return parseParticipantText(await file.text());
}

/** One spreadsheet cell as text, whatever ExcelJS made of it. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  const rich = value as { text?: string; result?: unknown; richText?: { text: string }[] };
  if (typeof rich.text === 'string') return rich.text;
  if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join('');
  if (rich.result !== undefined) return cellText(rich.result);
  return '';
}
