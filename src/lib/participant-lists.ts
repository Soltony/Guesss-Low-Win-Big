import prisma from './prisma';
import { createAuditLog } from './audit-log';
import { importParticipants, type ImportSummary } from './eligibility';
import { withoutExisting, type ParsedList, type ParticipantEntry } from './eligibility-list';

/**
 * Saved participant lists.
 *
 * A restricted auction admits only the phone numbers on its own list, and
 * before this that list had to be uploaded again for every auction — the same
 * staff roster or loyalty tier, re-imported each time. A saved list is uploaded
 * once under Content, alongside the terms versions, and attached to as many
 * auctions as you like.
 *
 * Attaching *copies* the numbers onto the auction rather than leaving it
 * pointing here. That is the whole design decision, and it is deliberate:
 *
 *   - A saved list is a living thing. People join and leave, and an operator
 *     edits it whenever that happens.
 *   - An auction's roster is not. Once bidding is open, changing who may bid
 *     can strand somebody who has already paid for bids, and a shared list
 *     would do exactly that to every auction using it, silently, from an edit
 *     made for an unrelated reason.
 *
 * So the auction keeps a snapshot in `AuctionParticipant`, and `sourceListId`
 * records where the snapshot came from. Every existing eligibility check,
 * per-auction addition and re-auction copy keeps working untouched; the only
 * new thing is that the numbers can arrive from a saved list instead of a file.
 * `participantsSyncedAt` is when the snapshot was taken, which is what lets the
 * admin say "this list has changed since you attached it".
 *
 * Parsing is shared with the per-auction upload path — an operator's CSV is
 * read by exactly the same code wherever they drop it.
 */

/** Guards against an operator pasting an entire customer database by mistake. */
export const MAX_LIST_ENTRIES = 50_000;

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 300;

/** A failure with the status the route should return, so handlers stay thin. */
export class ParticipantListError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'ParticipantListError';
  }
}

export interface ListSummary {
  id: string;
  name: string;
  description: string;
  active: boolean;
  entryCount: number;
  /** Auctions whose roster was last taken from this list. */
  auctionCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every saved list with its counts, for the Content tab and the auction form.
 *
 * The counts come from `_count` rather than a stored column so they cannot
 * drift away from the rows they describe — there are only ever a handful of
 * lists, so the join costs nothing.
 */
export async function listSummaries(options: { activeOnly?: boolean } = {}): Promise<ListSummary[]> {
  const rows = await prisma.participantList.findMany({
    where: options.activeOnly ? { active: true } : undefined,
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      createdBy: { select: { fullName: true } },
      _count: { select: { entries: true, auctions: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    active: row.active,
    entryCount: row._count.entries,
    auctionCount: row._count.auctions,
    createdBy: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new ParticipantListError('Give the list a name.');
  return name;
}

export function cleanDescription(raw: unknown): string | null {
  const description = String(raw ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return description || null;
}

export async function createList(input: {
  name: string;
  description: string | null;
  actor: { id: string; fullName: string };
}): Promise<{ id: string }> {
  const list = await prisma.participantList.create({
    data: {
      name: input.name,
      description: input.description,
      createdById: input.actor.id,
    },
    select: { id: true },
  });

  await createAuditLog({
    actorId: input.actor.id,
    actorName: input.actor.fullName,
    action: 'PARTICIPANT_LIST_CREATED',
    entity: 'ParticipantList',
    entityId: list.id,
    details: { name: input.name },
  });

  return list;
}

export async function updateList(input: {
  id: string;
  name?: string;
  description?: string | null;
  active?: boolean;
  actor: { id: string; fullName: string };
}): Promise<void> {
  const existing = await prisma.participantList.findUnique({
    where: { id: input.id },
    select: { id: true, name: true, active: true },
  });
  if (!existing) throw new ParticipantListError('That list no longer exists.', 404);

  await prisma.participantList.update({
    where: { id: input.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });

  await createAuditLog({
    actorId: input.actor.id,
    actorName: input.actor.fullName,
    action: 'PARTICIPANT_LIST_UPDATED',
    entity: 'ParticipantList',
    entityId: input.id,
    details: { name: input.name ?? existing.name, active: input.active ?? existing.active },
  });
}

/**
 * Deletes a saved list.
 *
 * Auctions that were built from it are left alone — their rosters are their own
 * snapshots, and deleting the source cannot be allowed to empty a live
 * auction's list. `sourceListId` is cleared first so nothing is left pointing at
 * a row that no longer exists; those auctions simply lose the ability to
 * re-sync, which is the honest consequence of throwing the source away.
 */
export async function deleteList(
  id: string,
  actor: { id: string; fullName: string }
): Promise<void> {
  const list = await prisma.participantList.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { entries: true, auctions: true } } },
  });
  if (!list) throw new ParticipantListError('That list no longer exists.', 404);

  await prisma.$transaction(async (tx) => {
    await tx.auction.updateMany({
      where: { sourceListId: id },
      data: { sourceListId: null },
    });
    // Entries go with it through the cascade on ParticipantListEntry.listId.
    await tx.participantList.delete({ where: { id } });
  });

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'PARTICIPANT_LIST_DELETED',
    entity: 'ParticipantList',
    entityId: id,
    details: {
      name: list.name,
      entries: list._count.entries,
      detachedAuctions: list._count.auctions,
    },
  });
}

export interface ListImportSummary {
  added: number;
  /** Already on the list, so nothing changed for them. */
  skipped: number;
  /** Removed by a replace import. */
  removed: number;
  duplicatesInFile: number;
  rejected: ParsedList['rejected'];
  total: number;
}

/**
 * Writes parsed entries into a saved list.
 *
 * Mirrors `importParticipants` for auctions, including the transaction around a
 * replace: a list caught half-empty is one that an operator could attach to an
 * auction in that state.
 */
export async function importIntoList(input: {
  listId: string;
  entries: ParticipantEntry[];
  mode: 'replace' | 'append';
  actor: { id: string; fullName: string };
  parsed?: Pick<ParsedList, 'rejected' | 'duplicates'>;
}): Promise<ListImportSummary> {
  const { listId, entries, mode, actor } = input;

  const list = await prisma.participantList.findUnique({
    where: { id: listId },
    select: { id: true, name: true },
  });
  if (!list) throw new ParticipantListError('That list no longer exists.', 404);

  if (entries.length > MAX_LIST_ENTRIES) {
    throw new ParticipantListError(
      `That list holds ${entries.length.toLocaleString()} numbers. The limit is ${MAX_LIST_ENTRIES.toLocaleString()}.`,
      413
    );
  }

  const before = new Set(
    (
      await prisma.participantListEntry.findMany({
        where: { listId },
        select: { phoneNumber: true },
      })
    ).map((row) => row.phoneNumber)
  );

  const { fresh, skipped } =
    mode === 'replace' ? { fresh: entries, skipped: 0 } : withoutExisting(entries, before);
  const removed = mode === 'replace' ? before.size : 0;

  await prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.participantListEntry.deleteMany({ where: { listId } });
    }
    if (fresh.length > 0) {
      await tx.participantListEntry.createMany({
        data: fresh.map((entry) => ({
          listId,
          phoneNumber: entry.phoneNumber,
          fullName: entry.fullName,
          note: entry.note,
        })),
      });
    }
    // Bumps `updatedAt`, which is what the admin shows as "last edited" and
    // what an attached auction's snapshot date is compared against.
    await tx.participantList.update({ where: { id: listId }, data: { updatedAt: new Date() } });
  });

  const total = await prisma.participantListEntry.count({ where: { listId } });

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'PARTICIPANT_LIST_IMPORTED',
    entity: 'ParticipantList',
    entityId: listId,
    details: {
      name: list.name,
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

/**
 * Copies a saved list onto an auction.
 *
 * The copy is what makes the auction's roster independent of later edits to the
 * list. `sourceListId` records which list was applied last, so the admin can
 * offer to re-apply it; re-applying is always a replace, because a partial
 * re-sync would leave a roster that is neither the old snapshot nor the new
 * list.
 */
export async function applyListToAuction(input: {
  auctionId: string;
  listId: string;
  mode: 'replace' | 'append';
  actor: { id: string; fullName: string };
}): Promise<ImportSummary & { listId: string; listName: string }> {
  const list = await prisma.participantList.findUnique({
    where: { id: input.listId },
    select: { id: true, name: true },
  });
  if (!list) throw new ParticipantListError('That saved list no longer exists.', 404);

  const entries = await prisma.participantListEntry.findMany({
    where: { listId: list.id },
    orderBy: { createdAt: 'asc' },
    select: { phoneNumber: true, fullName: true, note: true },
  });

  if (entries.length === 0) {
    throw new ParticipantListError(
      `"${list.name}" has no phone numbers on it yet. Upload them under Content → Participant lists first.`
    );
  }

  const summary = await importParticipants({
    auctionId: input.auctionId,
    entries,
    mode: input.mode,
    source: 'LIST',
    actor: input.actor,
  });

  await prisma.auction.update({
    where: { id: input.auctionId },
    data: { sourceListId: list.id, participantsSyncedAt: new Date() },
  });

  await createAuditLog({
    actorId: input.actor.id,
    actorName: input.actor.fullName,
    action: 'AUCTION_PARTICIPANT_LIST_APPLIED',
    entity: 'Auction',
    entityId: input.auctionId,
    details: {
      listId: list.id,
      listName: list.name,
      mode: input.mode,
      added: summary.added,
      skipped: summary.skipped,
      removed: summary.removed,
      total: summary.total,
    },
  });

  return { ...summary, listId: list.id, listName: list.name };
}

export interface AttachedList {
  id: string;
  name: string;
  /** Numbers on the saved list right now. */
  entryCount: number;
  syncedAt: string | null;
  /** The saved list has been edited since this auction's snapshot was taken. */
  stale: boolean;
}

/**
 * The saved list an auction's roster came from, if any, and whether it has
 * moved on since. Drives the "re-sync" prompt on the participants page.
 */
export async function attachedList(auction: {
  sourceListId: string | null;
  participantsSyncedAt: Date | null;
}): Promise<AttachedList | null> {
  if (!auction.sourceListId) return null;

  const list = await prisma.participantList.findUnique({
    where: { id: auction.sourceListId },
    select: { id: true, name: true, updatedAt: true, _count: { select: { entries: true } } },
  });
  if (!list) return null;

  return {
    id: list.id,
    name: list.name,
    entryCount: list._count.entries,
    syncedAt: auction.participantsSyncedAt?.toISOString() ?? null,
    stale: auction.participantsSyncedAt
      ? list.updatedAt.getTime() > auction.participantsSyncedAt.getTime()
      : true,
  };
}
