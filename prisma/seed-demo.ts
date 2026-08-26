/**
 * GuessLow demo dataset — every auction configuration, and a real bid space.
 *
 *   npm run db:seed        # roles, settings, templates, catalogue (run first)
 *   npm run db:seed:demo   # this file
 *
 * What it builds, and why it is built this way:
 *
 *   • One auction per configuration the platform supports — each status, both
 *     eligibility modes, fee-bearing and free, capped and uncapped, penny and
 *     whole-unit grids, auto-extending, restricted, re-auctioned — so every
 *     screen and every branch of the engine has something to show.
 *   • ~3,900 bids across them, with the amounts sealed by `encryptBidAmount`
 *     exactly as `placeBid` seals them, and payment rows in every status.
 *   • Results, winners, ranked runner-ups, published ledgers and re-auction
 *     chains are NOT written by hand: the rows are produced by calling the
 *     real `settleAuction` and `createReauction`. Hand-written settlements
 *     drift from the engine the first time its rules change; driving the
 *     engine means the demo data is always what the platform would actually
 *     have produced from these bids.
 *
 * Two of the configurations are transient on purpose, and the platform is
 * right to sweep them: an ENDED auction is settled once it clears
 * `winners.settleGraceMinutes`, and a PENDING_PAYMENT bid is voided after
 * `payments.pendingTimeoutMinutes`. Both are dated to sit inside those windows
 * so they are there to look at when the seed finishes, and both will be swept
 * within about ten minutes if a worker or a dev server is running. Re-run the
 * seed to see them again.
 *
 * Everything it creates is namespaced — auction codes `GL-*`, bidder phones
 * `251970*`, item SKUs `GL-DEMO-*`, participant lists `Demo — *` — so it can
 * be removed again without touching anything else in the database:
 *
 *   npm run db:seed:demo -- --reset      # rebuild from scratch
 *   npm run db:seed:demo -- --reset-only # remove the demo data and stop
 *
 * Needs DATABASE_URL and BID_ENCRYPTION_KEY. Deterministic: the same seed
 * value produces the same bid space every run.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma';
import { encryptBidAmount, isBidAmountKeyConfigured } from '../src/lib/bid-crypto';
import { settleAuction } from '../src/lib/auction-engine';
import { createReauction } from '../src/lib/reauction';
import { normalizePhone, round2, toNum } from '../src/lib/format';
import type { BidStatus, PaymentStatus, WinnerStatus } from '../src/lib/types';

// Notifications are dispatched by settlement and by re-auction creation. The
// demo numbers are not real, and .env may well hold a live SMS provider, so the
// provider is dropped for this process: the NotificationLog rows are still
// written — they are useful demo data — but nothing leaves the machine.
delete process.env.SMS_API_URL;

const CODE_PREFIX = 'GL-';
const PHONE_PREFIX = '251970';
const SKU_PREFIX = 'GL-DEMO-';
const LIST_PREFIX = 'Demo — ';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const args = process.argv.slice(2);
const RESET = args.includes('--reset') || args.includes('--reset-only');
const RESET_ONLY = args.includes('--reset-only');

// --------------------------------------
// Determinism
// --------------------------------------

/** Small, fast, seedable PRNG — the same seed replays the same bid space. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260826);

const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
const intBetween = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --------------------------------------
// Bulk insert
// --------------------------------------

/**
 * SQL Server refuses a statement carrying more than 2100 parameters, and these
 * tables are wide enough that one `createMany` of a few hundred rows crosses
 * it. Same reasoning as `publishBidLedger`'s INSERT_CHUNK, applied per table.
 */
async function insertChunked<T>(
  label: string,
  rows: T[],
  size: number,
  insert: (chunk: T[]) => Promise<unknown>
) {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
  return rows.length;
}

// --------------------------------------
// Reset
// --------------------------------------

/**
 * Removes everything a previous run of this file created, and nothing else.
 *
 * Scoped entirely by the demo namespaces, so an auction, bidder or item that
 * was not seeded from here is never touched. Children are unhooked from their
 * parents before the auctions go, because the lineage relation is
 * `onDelete: NoAction` and would otherwise refuse the delete.
 */
async function resetDemoData() {
  const auctions = await prisma.auction.findMany({
    where: { code: { startsWith: CODE_PREFIX } },
    select: { id: true },
  });
  const bidders = await prisma.bidder.findMany({
    where: { phoneNumber: { startsWith: PHONE_PREFIX } },
    select: { id: true },
  });

  const auctionIds = auctions.map((a) => a.id);
  const bidderIds = bidders.map((b) => b.id);

  if (auctionIds.length === 0 && bidderIds.length === 0) {
    console.log('· nothing to reset');
    return;
  }

  const byAuction = { auctionId: { in: auctionIds } };

  if (auctionIds.length > 0) {
    // Unhook the rows the auction points at, so the auction itself can go.
    await prisma.auction.updateMany({
      where: { id: { in: auctionIds } },
      data: {
        winnerBidId: null,
        parentAuctionId: null,
        originalAuctionId: null,
        sourceListId: null,
        settledById: null,
      },
    });

    await prisma.auctionResult.deleteMany({ where: byAuction });
    await prisma.auctionLedgerEntry.deleteMany({ where: byAuction });
    await prisma.winner.deleteMany({ where: byAuction });
    await prisma.bidCredit.deleteMany({ where: byAuction });
    await prisma.auctionParticipant.deleteMany({ where: byAuction });
    await prisma.bidderFavorite.deleteMany({ where: byAuction });
  }

  await prisma.paymentTransaction.deleteMany({
    where: { OR: [byAuction, { bidderId: { in: bidderIds } }] },
  });
  await prisma.bid.deleteMany({
    where: { OR: [byAuction, { bidderId: { in: bidderIds } }] },
  });
  await prisma.notificationLog.deleteMany({
    where: { OR: [byAuction, { bidderId: { in: bidderIds } }] },
  });
  await prisma.adImpression.deleteMany({ where: { bidderId: { in: bidderIds } } });
  await prisma.bidderFavorite.deleteMany({ where: { bidderId: { in: bidderIds } } });

  if (auctionIds.length > 0) {
    await prisma.pendingChange.deleteMany({
      where: { entityType: 'Auction', entityId: { in: auctionIds } },
    });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: auctionIds } } });
    await prisma.auction.deleteMany({ where: { id: { in: auctionIds } } });
  }

  await prisma.bidder.deleteMany({ where: { id: { in: bidderIds } } });

  const lists = await prisma.participantList.findMany({
    where: { name: { startsWith: LIST_PREFIX } },
    select: { id: true },
  });
  if (lists.length > 0) {
    const listIds = lists.map((l) => l.id);
    await prisma.participantListEntry.deleteMany({ where: { listId: { in: listIds } } });
    await prisma.participantList.deleteMany({ where: { id: { in: listIds } } });
  }

  await prisma.item.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });

  console.log(
    `· reset — ${auctionIds.length} auction(s) and ${bidderIds.length} bidder(s) removed`
  );
}

// --------------------------------------
// Prerequisites
// --------------------------------------

/** The admin the demo attributes its operator actions to. */
async function demoActor() {
  const user =
    (await prisma.user.findFirst({
      where: { role: { name: 'Super Admin' } },
      orderBy: { createdAt: 'asc' },
    })) ?? (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }));

  if (!user) {
    throw new Error(
      'No admin user exists yet. Run `npm run db:seed` first — it creates the roles and the ' +
        'bootstrap Super Admin this dataset attributes its settlements to.'
    );
  }
  return user;
}

const CATEGORIES = [
  { slug: 'mobile-phones', name: 'Mobile Phones', nameAm: 'ሞባይል ስልኮች', icon: 'Smartphone' },
  { slug: 'electronics', name: 'Electronics', nameAm: 'ኤሌክትሮኒክስ', icon: 'Tv' },
  { slug: 'home-appliances', name: 'Home Appliances', nameAm: 'የቤት እቃዎች', icon: 'Refrigerator' },
  { slug: 'accessories', name: 'Accessories', nameAm: 'መለዋወጫዎች', icon: 'Headphones' },
  { slug: 'computers', name: 'Computers', nameAm: 'ኮምፒውተሮች', icon: 'Laptop' },
  { slug: 'travel', name: 'Travel & Leisure', nameAm: 'ጉዞና መዝናኛ', icon: 'Plane' },
];

interface ItemSpec {
  sku: string;
  name: string;
  nameAm: string;
  brand: string;
  model: string | null;
  price: number;
  cat: string;
}

const ITEMS: ItemSpec[] = [
  { sku: '01', name: 'iPhone 15 Pro Max — 256GB', nameAm: 'አይፎን 15 ፕሮ ማክስ — 256 ጂቢ', brand: 'Apple', model: 'A2849', price: 185000, cat: 'mobile-phones' },
  { sku: '02', name: 'Samsung Galaxy S24 Ultra — 512GB', nameAm: 'ሳምሰንግ ጋላክሲ S24 አልትራ', brand: 'Samsung', model: 'SM-S928B', price: 165000, cat: 'mobile-phones' },
  { sku: '03', name: 'Tecno Camon 30 — 256GB', nameAm: 'ቴክኖ ካሞን 30', brand: 'Tecno', model: 'CL6', price: 28500, cat: 'mobile-phones' },
  { sku: '04', name: 'Infinix Hot 40i — 128GB', nameAm: 'ኢንፊኒክስ ሆት 40i', brand: 'Infinix', model: 'X6528', price: 16900, cat: 'mobile-phones' },
  { sku: '05', name: '65-inch QLED 4K Smart Television', nameAm: '65 ኢንች QLED 4K ስማርት ቴሌቪዥን', brand: 'Samsung', model: 'Q60D', price: 96000, cat: 'electronics' },
  { sku: '06', name: 'Sony WH-1000XM5 Noise Cancelling Headphones', nameAm: 'ሶኒ WH-1000XM5 ጆሮ ማዳመጫ', brand: 'Sony', model: 'WH-1000XM5', price: 32000, cat: 'accessories' },
  { sku: '07', name: 'PlayStation 5 Slim — Disc Edition', nameAm: 'ፕሌይስቴሽን 5 ስሊም', brand: 'Sony', model: 'CFI-2016A', price: 78000, cat: 'electronics' },
  { sku: '08', name: 'Hisense 20kg Top-Load Washing Machine', nameAm: 'ሂሴንስ 20 ኪግ ማጠቢያ ማሽን', brand: 'Hisense', model: 'WTY2002', price: 54000, cat: 'home-appliances' },
  { sku: '09', name: 'LG 410L InstaView Refrigerator', nameAm: 'ኤልጂ 410 ሊትር ፍሪጅ', brand: 'LG', model: 'GC-X257', price: 112000, cat: 'home-appliances' },
  { sku: '10', name: 'Elegance 5-Burner Gas Cooker', nameAm: 'ኤሌጋንስ ባለ5 ምድጃ ጋዝ ማብሰያ', brand: 'Elegance', model: 'EG-5B', price: 38500, cat: 'home-appliances' },
  { sku: '11', name: 'MacBook Air 15-inch M3 — 512GB', nameAm: 'ማክቡክ ኤር 15 ኢንች M3', brand: 'Apple', model: 'MRYP3', price: 215000, cat: 'computers' },
  { sku: '12', name: 'Dell XPS 14 — Core Ultra 7', nameAm: 'ዴል XPS 14', brand: 'Dell', model: '9440', price: 178000, cat: 'computers' },
  { sku: '13', name: 'HP LaserJet Pro MFP M283fdw', nameAm: 'ኤችፒ ሌዘርጄት ፕሮ', brand: 'HP', model: 'M283fdw', price: 42000, cat: 'computers' },
  { sku: '14', name: 'Calus TF20 Power Bank and TWS Headset', nameAm: 'ካሉስ TF20 ፓወር ባንክ', brand: 'Calus', model: 'TF20', price: 4500, cat: 'accessories' },
  { sku: '15', name: 'Apple Watch Series 10 — 46mm', nameAm: 'አፕል ዋች ሲሪየስ 10', brand: 'Apple', model: 'A2999', price: 62000, cat: 'accessories' },
  { sku: '16', name: 'Anker 737 PowerCore 24,000mAh', nameAm: 'አንከር 737 ፓወር ኮር', brand: 'Anker', model: 'A1289', price: 9800, cat: 'accessories' },
  { sku: '17', name: 'Two Nights for Two — Kuriftu Resort Bishoftu', nameAm: 'ለሁለት ሰው የሁለት ሌሊት ቆይታ — ኩሪፍቱ ሪዞርት', brand: 'Kuriftu', model: null, price: 45000, cat: 'travel' },
  { sku: '18', name: 'Return Flight for Two — Addis Ababa to Dubai', nameAm: 'ለሁለት ሰው የመመለሻ በረራ — አዲስ አበባ ወደ ዱባይ', brand: 'Ethiopian Airlines', model: null, price: 148000, cat: 'travel' },
];

interface DemoItem {
  id: string;
  categoryId: string;
  name: string;
  nameAm: string;
  price: number;
}

async function seedCatalog(actorId: string) {
  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        slug: category.slug,
        name: category.name,
        nameAm: category.nameAm,
        icon: category.icon,
        displayOrder: index,
        status: 'ACTIVE',
      },
    });
  }

  const categories = new Map(
    (await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [
      c.slug,
      c.id,
    ])
  );

  const items = new Map<string, DemoItem>();
  for (const item of ITEMS) {
    const sku = `${SKU_PREFIX}${item.sku}`;
    const categoryId = categories.get(item.cat);
    if (!categoryId) throw new Error(`Category ${item.cat} was not created.`);

    const row =
      (await prisma.item.findFirst({ where: { sku } })) ??
      (await prisma.item.create({
        data: {
          name: item.name,
          nameAm: item.nameAm,
          description:
            `${item.name}. Brand new and sealed, with the manufacturer's warranty. ` +
            `Collected from the GuessLow prize desk or delivered inside Addis Ababa.`,
          descriptionAm: `${item.nameAm}። አዲስ፣ ያልተከፈተ፣ ከዋስትና ጋር።`,
          brand: item.brand,
          model: item.model,
          sku,
          retailPrice: item.price,
          categoryId,
          images: '[]',
          stockQty: 1,
          status: 'ACTIVE',
          createdById: actorId,
        },
      }));

    items.set(item.sku, {
      id: row.id,
      categoryId: row.categoryId,
      name: item.name,
      nameAm: item.nameAm,
      price: item.price,
    });
  }

  console.log(`✓ ${CATEGORIES.length} categories, ${items.size} demo items`);
  return items;
}

// --------------------------------------
// Bidders
// --------------------------------------

const FIRST_NAMES = [
  'Abebe', 'Almaz', 'Bereket', 'Chaltu', 'Dawit', 'Eden', 'Fikru', 'Genet',
  'Hanna', 'Ibrahim', 'Jemal', 'Kalkidan', 'Lidya', 'Mekdes', 'Nahom', 'Oumer',
  'Rahel', 'Samuel', 'Tigist', 'Yonas', 'Zewditu', 'Betelhem', 'Haile', 'Meron',
  'Selam', 'Tewodros', 'Yeshi', 'Abdi', 'Bruk', 'Hiwot', 'Kidist', 'Solomon',
];

const LAST_NAMES = [
  'Alemu', 'Bekele', 'Chala', 'Desta', 'Fantahun', 'Girma', 'Hailu', 'Kebede',
  'Lemma', 'Mengistu', 'Negash', 'Tadesse', 'Wolde', 'Yimer', 'Zeleke', 'Assefa',
  'Demissie', 'Gebre', 'Haptamu', 'Mulugeta',
];

const BIDDER_COUNT = 150;

/**
 * The pool every auction draws its bidders from.
 *
 * Statuses are mixed on purpose: a SUSPENDED or BLOCKED bidder who already
 * holds live bids is exactly the case the admin's bidder screens and the
 * moderation flow exist for, and it never occurs in a dataset where everyone
 * is ACTIVE.
 */
async function seedBidders(moderatorId: string) {
  const existing = await prisma.bidder.findMany({
    where: { phoneNumber: { startsWith: PHONE_PREFIX } },
    select: { id: true, phoneNumber: true },
    orderBy: { phoneNumber: 'asc' },
  });
  if (existing.length >= BIDDER_COUNT) {
    console.log(`· ${existing.length} demo bidders already present`);
    return existing;
  }

  const now = Date.now();
  const rows = [];
  for (let i = existing.length; i < BIDDER_COUNT; i += 1) {
    const phoneNumber = normalizePhone(`${PHONE_PREFIX}${String(i + 1).padStart(6, '0')}`);
    const fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    // A handful of bidders have never given a name — the mini-app only ever
    // requires a phone number, so the admin has to render that case.
    const anonymous = rng() < 0.08;
    const roll = rng();
    const status = roll < 0.9 ? 'ACTIVE' : roll < 0.96 ? 'SUSPENDED' : 'BLOCKED';
    const firstSeenAt = new Date(now - between(20, 180) * DAY);

    rows.push({
      phoneNumber,
      fullName: anonymous ? null : fullName,
      email: anonymous || rng() < 0.5 ? null : `${fullName.split(' ')[0].toLowerCase()}${i}@example.et`,
      language: rng() < 0.35 ? 'am' : 'en',
      status,
      statusReason:
        status === 'SUSPENDED'
          ? 'Temporarily suspended pending a payment dispute review.'
          : status === 'BLOCKED'
            ? 'Blocked after repeated chargebacks on bid fees.'
            : null,
      moderatedById: status === 'ACTIVE' ? null : moderatorId,
      firstSeenAt,
      lastSeenAt: new Date(firstSeenAt.getTime() + between(1, 19) * DAY),
    });
  }

  await insertChunked('bidders', rows, 100, (chunk) =>
    prisma.bidder.createMany({ data: chunk })
  );

  const all = await prisma.bidder.findMany({
    where: { phoneNumber: { startsWith: PHONE_PREFIX } },
    select: { id: true, phoneNumber: true },
    orderBy: { phoneNumber: 'asc' },
  });
  console.log(`✓ ${all.length} demo bidders`);
  return all;
}

// --------------------------------------
// Participant lists
// --------------------------------------

interface DemoList {
  id: string;
  name: string;
  phones: string[];
}

/**
 * Two saved rosters, as Content → Participant lists would hold them.
 *
 * Both are drawn from the demo bidder pool but deliberately include a few
 * numbers that belong to nobody yet: a list is uploaded before the people on
 * it have ever opened the mini-app, and the admin's "not yet seen" count is
 * only exercised when such rows exist.
 */
async function seedParticipantLists(
  bidders: { id: string; phoneNumber: string }[],
  actorId: string
) {
  const specs = [
    {
      name: `${LIST_PREFIX}Staff pilot`,
      description: 'Head-office staff taking part in the closed pilot round.',
      take: 40,
      from: 0,
      strangers: 4,
    },
    {
      name: `${LIST_PREFIX}VIP customers`,
      description: 'Top-tier super-app customers invited to the premium auctions.',
      take: 25,
      from: 40,
      strangers: 3,
    },
  ];

  const lists = new Map<string, DemoList>();
  for (const spec of specs) {
    const phones = bidders
      .slice(spec.from, spec.from + spec.take)
      .map((b) => b.phoneNumber);
    // Invited numbers that have not connected yet.
    for (let i = 0; i < spec.strangers; i += 1) {
      phones.push(normalizePhone(`251971${String(spec.from + i + 1).padStart(6, '0')}`));
    }

    const existing = await prisma.participantList.findFirst({ where: { name: spec.name } });
    const list =
      existing ??
      (await prisma.participantList.create({
        data: {
          name: spec.name,
          description: spec.description,
          active: true,
          createdById: actorId,
        },
      }));

    const already = await prisma.participantListEntry.count({ where: { listId: list.id } });
    if (already === 0) {
      await prisma.participantListEntry.createMany({
        data: phones.map((phoneNumber, index) => ({
          listId: list.id,
          phoneNumber,
          fullName: null,
          note: index >= spec.take ? 'Invited — has not opened the mini-app yet' : null,
        })),
      });
    }

    lists.set(spec.name, { id: list.id, name: spec.name, phones });
  }

  console.log(`✓ ${lists.size} participant lists`);
  return lists;
}

// --------------------------------------
// The auction matrix
// --------------------------------------

/**
 * How an auction's confirmed bids should come out.
 *
 *   winner    — the cheap amounts are all matched and one higher amount is
 *               left standing, which is the ordinary result.
 *   no-unique — every amount was bid at least twice, so the round has no
 *               winner at all and the re-auction rules take over.
 */
type Outcome = 'winner' | 'no-unique';

interface BidPlan {
  /** Confirmed bids. These are the ones that decide the result. */
  active: number;
  outcome: Outcome;
  /** Bids in each of the states that do not count toward the result. */
  pending?: number;
  failed?: number;
  voided?: number;
  refunded?: number;
}

interface ReauctionPlan {
  enabled?: boolean;
  maxRounds?: number;
  durationHours?: number;
  startDelayMinutes?: number;
  allowNew?: boolean;
  allowPrevious?: boolean;
  minBids?: number;
}

/** One further round of a chain, played out through the real engine. */
interface RoundPlan {
  bids: BidPlan;
  /** Move the round into the past and settle it, rather than leaving it open. */
  settle: boolean;
}

interface AuctionPlan {
  code: string;
  item: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  /** What this row is here to demonstrate. Shown as the auction's subtitle. */
  subtitle: string;
  fee: number;
  min: number;
  max: number;
  step: number;
  maxBidsPerUser: number;
  maxTotalBids?: number;
  currency?: string;
  featured?: boolean;
  autoExtendMinutes?: number;
  extendedCount?: number;
  restricted?: string;
  noTerms?: boolean;
  startsAt: number;
  endsAt: number;
  reauction?: ReauctionPlan;
  bids?: BidPlan;
  /** Settle once the bids are in. `pending` holds the next round back. */
  settle?: 'auto' | 'pending';
  winner?: WinnerStatus;
  cancelledReason?: string;
  approval?: boolean;
  rounds?: RoundPlan[];
}

const PLANS: AuctionPlan[] = [
  // ---- Not yet open ----
  {
    code: '01',
    item: '13',
    status: 'DRAFT',
    subtitle: 'Draft — never published, no bids, still editable',
    fee: 25,
    min: 0.01,
    max: 999.99,
    step: 0.01,
    maxBidsPerUser: 100,
    startsAt: 2 * DAY,
    endsAt: 9 * DAY,
  },
  {
    code: '02',
    item: '07',
    status: 'PENDING_APPROVAL',
    subtitle: 'Waiting on a second pair of eyes before it goes live',
    fee: 40,
    min: 1,
    max: 500,
    step: 1,
    maxBidsPerUser: 50,
    featured: true,
    startsAt: DAY,
    endsAt: 8 * DAY,
    approval: true,
  },
  {
    code: '03',
    item: '05',
    status: 'SCHEDULED',
    subtitle: 'Scheduled — opens in two days, auto-extends by 15 minutes',
    fee: 35,
    min: 0.01,
    max: 999.99,
    step: 0.01,
    maxBidsPerUser: 100,
    autoExtendMinutes: 15,
    startsAt: 2 * DAY,
    endsAt: 12 * DAY,
  },
  {
    code: '04',
    item: '17',
    status: 'SCHEDULED',
    subtitle: 'Invite-only pilot — restricted to the staff list, 5 bids each',
    fee: 20,
    min: 1,
    max: 200,
    step: 1,
    maxBidsPerUser: 5,
    restricted: 'Staff pilot',
    startsAt: 12 * HOUR,
    endsAt: 5 * DAY,
  },

  // ---- Running now ----
  {
    code: '05',
    item: '01',
    status: 'LIVE',
    subtitle: 'Flagship penny auction — 0.01 to 999.99 in 1 cent steps',
    fee: 30,
    min: 0.01,
    max: 999.99,
    step: 0.01,
    maxBidsPerUser: 100,
    featured: true,
    autoExtendMinutes: 10,
    startsAt: -6 * DAY,
    endsAt: 4 * DAY,
    bids: { active: 380, outcome: 'winner', pending: 14, failed: 6, voided: 8 },
  },
  {
    code: '06',
    item: '09',
    status: 'LIVE',
    subtitle: 'Whole-birr grid, 10 bids per bidder, capped at 500 bids overall',
    fee: 50,
    min: 1,
    max: 100,
    step: 1,
    maxBidsPerUser: 10,
    maxTotalBids: 500,
    startsAt: -3 * DAY,
    endsAt: 2 * DAY,
    bids: { active: 280, outcome: 'winner', pending: 10, voided: 6 },
  },
  {
    code: '07',
    item: '16',
    status: 'LIVE',
    subtitle: 'Free to enter — no bid fee, no terms attached, 250 bids per bidder',
    fee: 0,
    min: 5,
    max: 5000,
    step: 5,
    maxBidsPerUser: 250,
    startsAt: -2 * DAY,
    noTerms: true,
    endsAt: 5 * DAY,
    bids: { active: 250, outcome: 'winner' },
  },
  {
    code: '08',
    item: '11',
    status: 'LIVE',
    subtitle: 'VIP-only, priced in USD, half-dollar steps',
    fee: 100,
    min: 0.5,
    max: 250,
    step: 0.5,
    maxBidsPerUser: 40,
    currency: 'USD',
    restricted: 'VIP customers',
    startsAt: -4 * DAY,
    endsAt: 3 * DAY,
    bids: { active: 170, outcome: 'winner', pending: 8, failed: 4 },
  },
  {
    code: '09',
    item: '15',
    status: 'LIVE',
    subtitle: 'Closing in minutes — already auto-extended three times',
    fee: 45,
    min: 0.01,
    max: 499.99,
    step: 0.01,
    maxBidsPerUser: 60,
    featured: true,
    autoExtendMinutes: 5,
    extendedCount: 3,
    startsAt: -8 * DAY,
    endsAt: 25 * 60_000,
    bids: { active: 230, outcome: 'winner', pending: 12 },
  },
  {
    code: '10',
    item: '04',
    status: 'LIVE',
    subtitle: 'One bid per person — every bidder gets a single guess',
    fee: 20,
    min: 1,
    max: 999,
    step: 1,
    maxBidsPerUser: 1,
    startsAt: -36 * HOUR,
    endsAt: 36 * HOUR,
    bids: { active: 120, outcome: 'winner' },
  },

  // ---- Closed, awaiting settlement ----
  {
    code: '11',
    item: '08',
    status: 'ENDED',
    subtitle: 'Just closed — inside the settlement grace window, 50-bid floor for a valid result',
    fee: 35,
    min: 0.01,
    max: 799.99,
    step: 0.01,
    maxBidsPerUser: 80,
    startsAt: -9 * DAY,
    endsAt: -4 * 60_000,
    reauction: { enabled: true, maxRounds: 2, minBids: 50 },
    bids: { active: 270, outcome: 'winner', voided: 14 },
  },
  {
    code: '12',
    item: '10',
    status: 'ENDED',
    subtitle: 'Closed a minute ago — the settlement sweep has not reached it yet',
    fee: 25,
    min: 1,
    max: 300,
    step: 1,
    maxBidsPerUser: 25,
    startsAt: -5 * DAY,
    endsAt: -60_000,
    bids: { active: 140, outcome: 'winner' },
  },

  // ---- Settled, one per winner state ----
  {
    code: '13',
    item: '02',
    status: 'ENDED',
    subtitle: 'Settled — the winner has not claimed the prize yet',
    fee: 30,
    min: 0.01,
    max: 999.99,
    step: 0.01,
    maxBidsPerUser: 100,
    startsAt: -12 * DAY,
    endsAt: -2 * DAY,
    bids: { active: 300, outcome: 'winner', voided: 6, refunded: 4 },
    settle: 'auto',
    winner: 'PENDING_CLAIM',
  },
  {
    code: '14',
    item: '06',
    status: 'ENDED',
    subtitle: 'Settled — the winner has claimed and is awaiting verification',
    fee: 30,
    min: 0.01,
    max: 599.99,
    step: 0.01,
    maxBidsPerUser: 60,
    startsAt: -14 * DAY,
    endsAt: -4 * DAY,
    bids: { active: 190, outcome: 'winner' },
    settle: 'auto',
    winner: 'CLAIMED',
  },
  {
    code: '15',
    item: '03',
    status: 'ENDED',
    subtitle: 'Settled — identity verified, prize not handed over yet',
    fee: 25,
    min: 1,
    max: 400,
    step: 1,
    maxBidsPerUser: 40,
    startsAt: -16 * DAY,
    endsAt: -6 * DAY,
    bids: { active: 175, outcome: 'winner' },
    settle: 'auto',
    winner: 'VERIFIED',
  },
  {
    code: '16',
    item: '18',
    status: 'ENDED',
    subtitle: 'Settled and fulfilled — delivered, with a fulfilment reference',
    fee: 60,
    min: 0.01,
    max: 999.99,
    step: 0.01,
    maxBidsPerUser: 100,
    featured: true,
    startsAt: -21 * DAY,
    endsAt: -9 * DAY,
    bids: { active: 160, outcome: 'winner' },
    settle: 'auto',
    winner: 'FULFILLED',
  },
  {
    code: '17',
    item: '12',
    status: 'ENDED',
    subtitle: 'Settled — winner let the claim window lapse, runner-ups on record',
    fee: 40,
    min: 0.01,
    max: 899.99,
    step: 0.01,
    maxBidsPerUser: 75,
    startsAt: -25 * DAY,
    endsAt: -11 * DAY,
    bids: { active: 185, outcome: 'winner' },
    settle: 'auto',
    winner: 'FORFEITED',
  },
  {
    code: '18',
    item: '14',
    status: 'ENDED',
    subtitle: 'Settled, then the award was cancelled during a dispute',
    fee: 20,
    min: 1,
    max: 250,
    step: 1,
    maxBidsPerUser: 30,
    startsAt: -28 * DAY,
    endsAt: -13 * DAY,
    bids: { active: 135, outcome: 'winner' },
    settle: 'auto',
    winner: 'CANCELLED',
  },

  // ---- Settled with no winner: one auction per re-auction state ----
  {
    code: '19',
    item: '16',
    status: 'ENDED',
    subtitle: 'No unique amount, re-auction switched off — closed for good',
    fee: 15,
    min: 1,
    max: 60,
    step: 1,
    maxBidsPerUser: 20,
    startsAt: -18 * DAY,
    endsAt: -7 * DAY,
    reauction: { enabled: false },
    bids: { active: 120, outcome: 'no-unique' },
    settle: 'auto',
  },
  {
    code: '20',
    item: '10',
    status: 'ENDED',
    subtitle: 'No unique amount — flagged for re-auction, waiting on an operator',
    fee: 25,
    min: 1,
    max: 45,
    step: 1,
    maxBidsPerUser: 15,
    startsAt: -15 * DAY,
    endsAt: -5 * DAY,
    reauction: { enabled: true, maxRounds: 3, durationHours: 48 },
    bids: { active: 90, outcome: 'no-unique' },
    settle: 'pending',
  },
  {
    code: '21',
    item: '13',
    status: 'ENDED',
    subtitle: 'Invite-only chain that ran out of rounds — round 1 of 1 used',
    fee: 20,
    min: 1,
    max: 40,
    step: 1,
    maxBidsPerUser: 12,
    restricted: 'Staff pilot',
    startsAt: -20 * DAY,
    endsAt: -10 * DAY,
    reauction: { enabled: true, maxRounds: 1, durationHours: 24 },
    bids: { active: 80, outcome: 'no-unique' },
    settle: 'auto',
    rounds: [{ bids: { active: 65, outcome: 'no-unique' }, settle: true }],
  },
  {
    code: '22',
    item: '14',
    status: 'ENDED',
    subtitle: 'No unique amount and the rules admit nobody — re-auction blocked',
    fee: 15,
    min: 1,
    max: 35,
    step: 1,
    maxBidsPerUser: 10,
    startsAt: -17 * DAY,
    endsAt: -8 * DAY,
    reauction: { enabled: true, maxRounds: 2, allowNew: false, allowPrevious: false },
    bids: { active: 70, outcome: 'no-unique' },
    settle: 'auto',
  },
  {
    code: '23',
    item: '05',
    status: 'ENDED',
    subtitle: 'Three-round chain — paid bids carried forward at every round',
    fee: 50,
    min: 1,
    max: 80,
    step: 1,
    maxBidsPerUser: 20,
    featured: true,
    startsAt: -30 * DAY,
    endsAt: -12 * DAY,
    reauction: { enabled: true, maxRounds: 2, durationHours: 48 },
    bids: { active: 110, outcome: 'no-unique' },
    settle: 'auto',
    rounds: [
      { bids: { active: 95, outcome: 'no-unique' }, settle: true },
      { bids: { active: 60, outcome: 'winner' }, settle: false },
    ],
  },
  {
    code: '24',
    item: '03',
    status: 'CANCELLED',
    subtitle: 'Cancelled mid-flight — every fee refunded, no result',
    fee: 30,
    min: 0.01,
    max: 499.99,
    step: 0.01,
    maxBidsPerUser: 50,
    startsAt: -6 * DAY,
    endsAt: 2 * DAY,
    cancelledReason:
      'Suspected coordinated bidding from a single device pool. Cancelled and every service fee refunded.',
    bids: { active: 0, outcome: 'winner', refunded: 85 },
  },
  {
    code: '25',
    item: '17',
    status: 'ENDED',
    subtitle: 'Unique amount found, but turnout fell below the 500-bid floor',
    fee: 40,
    min: 1,
    max: 900,
    step: 1,
    maxBidsPerUser: 25,
    startsAt: -11 * DAY,
    endsAt: -3 * DAY,
    reauction: { enabled: true, maxRounds: 2, minBids: 500, durationHours: 72 },
    bids: { active: 60, outcome: 'winner' },
    settle: 'pending',
  },
];

// --------------------------------------
// Building a bid space
// --------------------------------------

/**
 * How many bids land on each amount of the grid.
 *
 * The shape is the one a real lowest-unique auction produces: bidders crowd
 * the cheap end, so those amounts collide and cancel out, and the result is
 * decided a little further up. Slots are grid positions — index 0 is the
 * minimum amount, index k is `min + k * step`.
 *
 * For a `winner` outcome one slot just above the crowd is reserved and handed
 * to exactly one bid, and every draw below it adds at least two bids. That is
 * what makes the winning amount the lowest unmatched one by construction
 * rather than by luck, which in turn means the settlement engine's answer is
 * predictable enough to assert on. For `no-unique`, nothing is reserved and
 * every draw adds at least two, so no amount is left standing at all.
 */
function buildSlotCounts(n: number, slots: number, outcome: Outcome): Map<number, number> {
  const counts = new Map<number, number>();
  const add = (slot: number, times: number) => counts.set(slot, (counts.get(slot) ?? 0) + times);

  // A plan can ask for zero confirmed bids — a cancelled round where every fee
  // was handed back has none — and must not be handed a winning amount.
  if (n <= 0) return counts;

  const band = Math.max(4, Math.min(slots, Math.round(n * 0.8)));
  const winnerSlot =
    outcome === 'winner' ? Math.min(slots - 1, Math.max(1, Math.floor(band * 0.45))) : -1;

  const matchedTarget = outcome === 'no-unique' ? n : Math.floor(n * 0.6);

  let placed = 0;
  let guard = n * 40;
  while (placed + 1 < matchedTarget && guard > 0) {
    guard -= 1;
    const slot = Math.floor(Math.pow(rng(), 1.7) * band);
    if (slot === winnerSlot) continue;
    const times = Math.min(rng() < 0.22 ? 3 : 2, matchedTarget - placed);
    if (times < 2) break;
    add(slot, times);
    placed += times;
  }

  // Anything left of the matched budget joins an amount that is already
  // matched, so it cannot leave a stray unique amount below the winner.
  while (placed < matchedTarget && counts.size > 0) {
    const slot = Array.from(counts.keys())[Math.floor(rng() * counts.size)];
    add(slot, 1);
    placed += 1;
  }

  if (outcome === 'no-unique') return counts;

  add(winnerSlot, 1);
  placed += 1;

  // The rest sit above the winning amount. They may well collide with each
  // other — that is realistic, and harmless: nothing up here can undercut a
  // winner that is already the lowest unmatched amount.
  const above = Math.max(1, slots - winnerSlot - 1);
  while (placed < n) {
    const slot = winnerSlot + 1 + Math.floor(Math.pow(rng(), 1.3) * above);
    add(Math.min(slot, slots - 1), 1);
    placed += 1;
  }

  return counts;
}

/** Grid position → the amount itself, in minor units so nothing drifts. */
function amountAt(slot: number, min: number, step: number) {
  const minor = Math.round(min * 100) + slot * Math.round(step * 100);
  return round2(minor / 100);
}

function slotCount(min: number, max: number, step: number) {
  const stepMinor = Math.max(1, Math.round(step * 100));
  return Math.floor((Math.round(max * 100) - Math.round(min * 100)) / stepMinor) + 1;
}

/**
 * Cuid-shaped ids, generated here rather than by the database.
 *
 * `createMany` does not return the rows it wrote, and every fee-bearing bid
 * needs a payment row pointing back at it. Knowing the ids up front is what
 * lets both tables go in as bulk inserts instead of thousands of round-trips.
 */
function demoId() {
  let out = 'c';
  while (out.length < 25) out += Math.floor(rng() * 36).toString(36);
  return out.slice(0, 25);
}

const CHANNELS = ['MINIAPP', 'MINIAPP', 'MINIAPP', 'MINIAPP', 'MINIAPP', 'USSD', 'ADMIN'] as const;

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 SuperApp/4.2',
  'Mozilla/5.0 (Linux; Android 14; TECNO CL6) AppleWebKit/537.36 Chrome/124.0 SuperApp/4.2',
  'Mozilla/5.0 (Linux; Android 13; Infinix X6528) AppleWebKit/537.36 Chrome/120.0 SuperApp/4.1',
  'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 Chrome/118.0 SuperApp/4.0',
];

const VOID_REASONS = [
  'Payment not confirmed within 15 minutes',
  'Bidder cancelled before paying the service fee',
];

const FAILURE_REASONS = [
  'Insufficient balance in the linked wallet',
  'Gateway declined the charge (limit exceeded)',
  'Customer dismissed the payment prompt',
];

interface DraftBid {
  id: string;
  bidderId: string;
  amount: number;
  status: BidStatus;
  createdAt: Date;
  carriedOver: boolean;
  sequence: number;
}

interface BidContext {
  auctionId: string;
  pool: { id: string; phoneNumber: string }[];
  fee: number;
  min: number;
  step: number;
  slots: number;
  maxBidsPerUser: number;
  windowStart: number;
  windowEnd: number;
  /** Prepaid bids per bidder, carried in from an earlier round of a chain. */
  credits?: Map<string, number>;
}

/**
 * Hands each amount to a bidder who may legitimately hold it.
 *
 * Two rules from `placeBid` are enforced here, because a dataset that breaks
 * them would show the admin states the platform itself cannot produce: nobody
 * exceeds the auction's per-bidder cap, and nobody bids their own amount twice
 * (repeating your own amount only cancels out your own uniqueness, so the
 * mini-app refuses it).
 */
function assignBidders(
  slotList: number[],
  pool: { id: string }[],
  maxBidsPerUser: number
): { bidderId: string; slot: number }[] {
  const used = new Map<string, Set<number>>();
  const count = new Map<string, number>();
  const order = shuffle(pool.map((b) => b.id));
  const assigned: { bidderId: string; slot: number }[] = [];

  let cursor = 0;
  for (const slot of slotList) {
    let chosen: string | null = null;
    for (let attempt = 0; attempt < order.length; attempt += 1) {
      const candidate = order[(cursor + attempt) % order.length];
      const taken = used.get(candidate);
      if ((count.get(candidate) ?? 0) >= maxBidsPerUser) continue;
      if (taken?.has(slot)) continue;
      chosen = candidate;
      cursor = (cursor + attempt + 1) % order.length;
      break;
    }

    if (!chosen) {
      throw new Error(
        `Ran out of eligible bidders: ${slotList.length} bids need more than ` +
          `${pool.length} bidders can hold at ${maxBidsPerUser} bids each.`
      );
    }

    assigned.push({ bidderId: chosen, slot });
    count.set(chosen, (count.get(chosen) ?? 0) + 1);
    const taken = used.get(chosen) ?? new Set<number>();
    taken.add(slot);
    used.set(chosen, taken);
  }

  return assigned;
}

/**
 * Writes one auction's whole bid space: the bids, and the payment row each
 * fee-bearing bid raised.
 *
 * Amounts are sealed with `encryptBidAmount` against this exact (auction,
 * bidder) pair — the same envelope `placeBid` writes and the same one
 * settlement opens — so nothing here is readable in the database and every row
 * decrypts under the configured key.
 */
async function seedBids(context: BidContext, plan: BidPlan) {
  const entries: { slot: number; status: BidStatus }[] = [];

  const counts = buildSlotCounts(plan.active, context.slots, plan.outcome);
  for (const [slot, times] of counts) {
    for (let i = 0; i < times; i += 1) entries.push({ slot, status: 'ACTIVE' });
  }

  const extras: [BidStatus, number][] = [
    ['PENDING_PAYMENT', plan.pending ?? 0],
    ['FAILED', plan.failed ?? 0],
    ['VOID', plan.voided ?? 0],
    ['REFUNDED', plan.refunded ?? 0],
  ];
  for (const [status, howMany] of extras) {
    for (let i = 0; i < howMany; i += 1) {
      entries.push({ slot: Math.floor(Math.pow(rng(), 1.5) * context.slots), status });
    }
  }

  const shuffled = shuffle(entries);
  const assigned = assignBidders(
    shuffled.map((entry) => entry.slot),
    context.pool,
    context.maxBidsPerUser
  );

  // Bidding gets busier as the deadline approaches, which is what makes the
  // "placed in the last hour" strip on the admin dashboard worth looking at.
  const span = Math.max(1, context.windowEnd - context.windowStart);
  const times = shuffled
    .map(() => context.windowStart + Math.pow(rng(), 0.55) * span)
    .sort((a, b) => a - b);

  const drafts: DraftBid[] = shuffled.map((entry, index) => ({
    id: demoId(),
    bidderId: assigned[index].bidderId,
    amount: amountAt(entry.slot, context.min, context.step),
    status: entry.status,
    createdAt: new Date(times[index]),
    carriedOver: false,
    sequence: 0,
  }));

  // A bid awaiting payment is a bid placed moments ago: the maintenance sweep
  // voids anything still unpaid after `payments.pendingTimeoutMinutes`, so one
  // dated days back would not survive the first pass after this file runs.
  // Only auctions still open get them — a closed round has nothing pending.
  const now = Date.now();
  if (context.windowEnd >= now - 60_000) {
    for (const draft of drafts) {
      if (draft.status !== 'PENDING_PAYMENT') continue;
      draft.createdAt = new Date(
        Math.max(context.windowStart, now - intBetween(30, 8 * 60) * 1000)
      );
    }
  }

  drafts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // `sequence` is the nth bid this bidder placed on this auction, counted the
  // way `placeBid` counts it — bids that never got past payment do not take a
  // number from the ones that did.
  const sequences = new Map<string, number>();
  for (const draft of drafts) {
    const counted = draft.status === 'ACTIVE' || draft.status === 'PENDING_PAYMENT';
    draft.sequence = (sequences.get(draft.bidderId) ?? 0) + 1;
    if (counted) sequences.set(draft.bidderId, draft.sequence);
  }

  // Prepaid bids from an earlier round are spent oldest-first, exactly as
  // `claimBidCredit` spends them, so the fee-free bids are the first ones the
  // bidder placed in this round rather than an arbitrary handful.
  const spent = new Map<string, number>();
  if (context.credits) {
    for (const draft of drafts) {
      const left = context.credits.get(draft.bidderId) ?? 0;
      if (left <= 0) continue;
      draft.carriedOver = true;
      context.credits.set(draft.bidderId, left - 1);
      spent.set(draft.bidderId, (spent.get(draft.bidderId) ?? 0) + 1);
    }
  }

  return { drafts, spent };
}

const PAYMENT_FOR: Record<BidStatus, PaymentStatus> = {
  ACTIVE: 'SUCCESS',
  PENDING_PAYMENT: 'PENDING',
  FAILED: 'FAILED',
  VOID: 'EXPIRED',
  REFUNDED: 'REVERSED',
};

/** Persists the drafted bids and the payment each fee-bearing one raised. */
async function writeBids(
  auctionId: string,
  drafts: DraftBid[],
  fee: number,
  phoneById: Map<string, string>
) {
  const bidRows = drafts.map((draft) => {
    const confirmed = draft.status === 'ACTIVE';
    const closed =
      draft.status === 'VOID' || draft.status === 'FAILED' || draft.status === 'REFUNDED';

    return {
      id: draft.id,
      auctionId,
      bidderId: draft.bidderId,
      amountCipher: encryptBidAmount(draft.amount, { auctionId, bidderId: draft.bidderId }),
      feeAmount: draft.carriedOver ? 0 : fee,
      status: draft.status,
      channel: pick(CHANNELS),
      sequence: draft.sequence,
      carriedOver: draft.carriedOver,
      ipAddress: `10.${intBetween(0, 255)}.${intBetween(0, 255)}.${intBetween(1, 254)}`,
      userAgent: pick(USER_AGENTS),
      createdAt: draft.createdAt,
      confirmedAt: confirmed
        ? new Date(draft.createdAt.getTime() + intBetween(3, 90) * 1000)
        : null,
      voidedAt: closed ? new Date(draft.createdAt.getTime() + intBetween(60, 1800) * 1000) : null,
      voidReason:
        draft.status === 'VOID'
          ? pick(VOID_REASONS)
          : draft.status === 'FAILED'
            ? pick(FAILURE_REASONS)
            : draft.status === 'REFUNDED'
              ? 'Auction cancelled — service fee refunded'
              : null,
    };
  });

  // 15 columns per row against SQL Server's 2100-parameter ceiling.
  await insertChunked('bids', bidRows, 120, (chunk) => prisma.bid.createMany({ data: chunk }));

  const payments = drafts
    .filter((draft) => fee > 0 && !draft.carriedOver)
    .map((draft) => {
      const status = PAYMENT_FOR[draft.status];
      const settledAt = new Date(draft.createdAt.getTime() + intBetween(5, 120) * 1000);
      return {
        transactionId: randomUUID(),
        txnRef: status === 'PENDING' ? null : `GW${String(intBetween(1, 999999999)).padStart(9, '0')}`,
        bidderId: draft.bidderId,
        auctionId,
        bidId: draft.id,
        amount: fee,
        purpose: 'BID_FEE',
        status,
        paidByNumber: status === 'SUCCESS' || status === 'REVERSED'
          ? phoneById.get(draft.bidderId) ?? null
          : null,
        accountNo: process.env.ACCOUNT_NO || '1000123456789',
        transactionTime: settledAt.toISOString().slice(0, 19).replace('T', ' '),
        gatewayStatus: status === 'SUCCESS' ? 'COMPLETED' : status,
        failureReason:
          status === 'FAILED'
            ? pick(FAILURE_REASONS)
            : status === 'EXPIRED'
              ? 'Payment window elapsed before confirmation'
              : status === 'REVERSED'
                ? 'Reversed after the auction was cancelled'
                : null,
        createdAt: draft.createdAt,
        updatedAt: settledAt,
      };
    });

  await insertChunked('payments', payments, 100, (chunk) =>
    prisma.paymentTransaction.createMany({ data: chunk })
  );

  return { bids: bidRows.length, payments: payments.length };
}

// --------------------------------------
// Creating the auctions
// --------------------------------------

async function createAuction(
  plan: AuctionPlan,
  index: number,
  items: Map<string, DemoItem>,
  lists: Map<string, DemoList>,
  termsId: string | null,
  actorId: string
) {
  const item = items.get(plan.item);
  if (!item) throw new Error(`Plan ${plan.code} refers to unknown item ${plan.item}.`);

  const now = Date.now();
  const startAt = new Date(now + plan.startsAt);
  const endAt = new Date(now + plan.endsAt);
  const published = plan.status !== 'DRAFT' && plan.status !== 'PENDING_APPROVAL';
  const list = plan.restricted ? lists.get(`${LIST_PREFIX}${plan.restricted}`) : undefined;
  if (plan.restricted && !list) throw new Error(`Plan ${plan.code} wants missing list ${plan.restricted}.`);

  const reauction = plan.reauction ?? {};

  const auction = await prisma.auction.create({
    data: {
      code: `${CODE_PREFIX}${plan.code}`,
      title: item.name,
      titleAm: item.nameAm,
      subtitle: plan.subtitle,
      itemId: item.id,
      categoryId: item.categoryId,

      bidFee: plan.fee,
      minBidAmount: plan.min,
      maxBidAmount: plan.max,
      bidStep: plan.step,
      maxBidsPerUser: plan.maxBidsPerUser,
      maxTotalBids: plan.maxTotalBids ?? 0,
      currency: plan.currency ?? 'ETB',

      startAt,
      endAt,
      autoExtendMinutes: plan.autoExtendMinutes ?? 0,
      extendedCount: plan.extendedCount ?? 0,

      status: plan.status,
      eligibilityMode: list ? 'RESTRICTED' : 'OPEN',
      featured: plan.featured ?? false,
      displayOrder: index,
      viewCount: plan.bids ? intBetween(plan.bids.active * 3, plan.bids.active * 9) : intBetween(0, 60),

      termsId: plan.noTerms ? null : termsId,
      sourceListId: list?.id ?? null,
      participantsSyncedAt: list ? new Date(now + plan.startsAt - HOUR) : null,

      reauctionEnabled: reauction.enabled ?? false,
      maxReauctionRounds: reauction.maxRounds ?? 1,
      reauctionDurationHours: reauction.durationHours ?? 24,
      reauctionStartDelayMinutes: reauction.startDelayMinutes ?? 0,
      reauctionAllowNewBidders: reauction.allowNew ?? true,
      reauctionAllowPreviousBidders: reauction.allowPrevious ?? true,
      reauctionMinBids: reauction.minBids ?? 0,

      cancelledReason: plan.cancelledReason ?? null,
      createdById: actorId,
      publishedAt: published ? new Date(now + plan.startsAt - 2 * HOUR) : null,
    },
  });

  if (list) {
    // A snapshot of the roster, as `applyListToAuction` copies it — the saved
    // list can be edited afterwards without changing who may bid here.
    await prisma.auctionParticipant.createMany({
      data: list.phones.map((phoneNumber, position) => ({
        auctionId: auction.id,
        phoneNumber,
        source: position % 11 === 0 ? 'MANUAL' : 'LIST',
        note: position % 11 === 0 ? 'Added by hand after the list was applied' : null,
        addedById: actorId,
      })),
    });
  }

  if (plan.approval) {
    await prisma.pendingChange.create({
      data: {
        entityType: 'Auction',
        entityId: auction.id,
        action: 'PUBLISH',
        payload: JSON.stringify({ code: auction.code, status: 'SCHEDULED', startAt, endAt }),
        summary: `Publish auction ${auction.code} — ${item.name}`,
        status: 'PENDING',
        createdById: actorId,
      },
    });
  }

  return auction;
}

// --------------------------------------
// Winners
// --------------------------------------

const ADDRESSES = [
  'Bole, Woreda 03, Sunshine Apartments, Addis Ababa',
  'Kirkos, Woreda 08, behind Global Hotel, Addis Ababa',
  'Yeka, Woreda 12, Megenagna, Addis Ababa',
  'Lideta, Woreda 06, Mexico Square, Addis Ababa',
  'Nifas Silk-Lafto, Woreda 05, Gofa Sefer, Addis Ababa',
];

/**
 * Moves a settled auction's winner into one of the claim states.
 *
 * `winsCount` is adjusted by hand for the two states that do not count as a
 * win: settlement incremented it when it created the row, and `settleAuction`
 * only reverses that on a re-settle, so a forfeited or cancelled award would
 * otherwise keep inflating the bidder's win total.
 */
async function applyWinnerStatus(auctionId: string, status: WinnerStatus, actorId: string) {
  const winner = await prisma.winner.findUnique({
    where: { auctionId },
    include: { bidder: { select: { fullName: true, phoneNumber: true } } },
  });
  if (!winner) return false;
  if (status === 'PENDING_CLAIM') return true;

  const claimedAt = new Date(winner.createdAt.getTime() + intBetween(1, 40) * HOUR);
  const verifiedAt = new Date(claimedAt.getTime() + intBetween(2, 30) * HOUR);
  const fulfilledAt = new Date(verifiedAt.getTime() + intBetween(4, 72) * HOUR);
  const delivery = {
    deliveryName: winner.bidder.fullName ?? 'Collected in person',
    deliveryPhone: winner.bidder.phoneNumber,
    deliveryAddress: pick(ADDRESSES),
    deliveryNote: rng() < 0.4 ? 'Please call on arrival — the gate is unmarked.' : null,
  };

  const data: Record<string, unknown> = { status };

  if (status === 'CLAIMED') Object.assign(data, { claimedAt, ...delivery });
  if (status === 'VERIFIED') {
    Object.assign(data, { claimedAt, verifiedAt, verifiedById: actorId, ...delivery });
  }
  if (status === 'FULFILLED') {
    Object.assign(data, {
      claimedAt,
      verifiedAt,
      verifiedById: actorId,
      fulfilledAt,
      fulfilledById: actorId,
      fulfillmentRef: `DLV-${String(intBetween(10000, 99999))}`,
      ...delivery,
    });
  }
  if (status === 'FORFEITED') {
    Object.assign(data, {
      claimDeadline: new Date(Date.now() - 2 * DAY),
      forfeitedReason:
        'The claim window closed without the winner coming forward. The next ranked unique bid may be promoted.',
    });
  }
  if (status === 'CANCELLED') {
    Object.assign(data, {
      claimedAt,
      forfeitedReason: 'Award cancelled: the bidder could not present identification matching the registered number.',
    });
  }

  await prisma.winner.update({ where: { auctionId }, data });

  if (status === 'FORFEITED' || status === 'CANCELLED') {
    await prisma.bidder.update({
      where: { id: winner.bidderId },
      data: { winsCount: { decrement: 1 } },
    });
  }

  return true;
}

// --------------------------------------
// Orchestration
// --------------------------------------

interface SeedContext {
  bidders: { id: string; phoneNumber: string }[];
  phoneById: Map<string, string>;
  byPhone: Map<string, string>;
  items: Map<string, DemoItem>;
  lists: Map<string, DemoList>;
  termsId: string | null;
  actor: { id: string; name: string };
}

/** Who may bid on this auction — the whole pool, or just the invited list. */
function poolFor(plan: AuctionPlan, context: SeedContext) {
  if (!plan.restricted) return context.bidders;

  const list = context.lists.get(`${LIST_PREFIX}${plan.restricted}`);
  if (!list) return context.bidders;

  // Numbers on the list that have actually connected. The rest are invitations
  // to people who have never opened the mini-app, and cannot have bid.
  return list.phones
    .map((phone) => context.byPhone.get(phone))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id, phoneNumber: context.phoneById.get(id) ?? '' }));
}

async function seedPlan(plan: AuctionPlan, index: number, context: SeedContext) {
  const auction = await createAuction(
    plan,
    index,
    context.items,
    context.lists,
    context.termsId,
    context.actor.id
  );

  let written = 0;
  if (plan.bids) {
    const pool = poolFor(plan, context);
    const total =
      plan.bids.active +
      (plan.bids.pending ?? 0) +
      (plan.bids.failed ?? 0) +
      (plan.bids.voided ?? 0) +
      (plan.bids.refunded ?? 0);

    if (plan.maxTotalBids && total > plan.maxTotalBids) {
      throw new Error(`Plan ${plan.code} drafts ${total} bids over its own ${plan.maxTotalBids} cap.`);
    }

    const { drafts } = await seedBids(
      {
        auctionId: auction.id,
        pool,
        fee: plan.fee,
        min: plan.min,
        step: plan.step,
        slots: slotCount(plan.min, plan.max, plan.step),
        maxBidsPerUser: plan.maxBidsPerUser,
        windowStart: auction.startAt.getTime(),
        windowEnd: Math.min(auction.endAt.getTime(), Date.now()),
      },
      plan.bids
    );

    const result = await writeBids(auction.id, drafts, plan.fee, context.phoneById);
    written = result.bids;
  }

  let settledNote = '';
  if (plan.settle) {
    const outcome = await settleAuction(auction.id, context.actor, {
      force: true,
      // `pending` is the state an auction lands in when automatic creation is
      // off and an operator has to open the next round themselves.
      skipReauction: plan.settle === 'pending',
    });
    settledNote = outcome.winnerBidId
      ? `winner at ${outcome.winningAmount?.toFixed(2)}`
      : `no winner → ${outcome.reauctionState}`;

    if (plan.winner) await applyWinnerStatus(auction.id, plan.winner, context.actor.id);
  }

  // Logged before the chain runs, so each round reports itself on its own line
  // underneath the round it followed.
  console.log(
    `  ${auction.code.padEnd(8)} ${plan.status.padEnd(17)} ${String(written).padStart(4)} bids  ${settledNote}`
  );

  if (plan.rounds) {
    written += await seedRounds(auction.id, plan, context);
  }

  return written;
}

/**
 * Plays out the rest of a re-auction chain through the real engine.
 *
 * Each round was opened by `createReauction` when the previous one settled, so
 * its rules, its participant list and its carried-forward credits are already
 * in place. All this adds is the bidding: the credits are spent the way
 * `claimBidCredit` spends them, and the round is then handed back to
 * `settleAuction`, which decides whether the chain continues or ends.
 */
async function seedRounds(rootId: string, plan: AuctionPlan, context: SeedContext) {
  let parentId = rootId;
  let written = 0;

  for (const round of plan.rounds ?? []) {
    const child = await prisma.auction.findFirst({ where: { parentAuctionId: parentId } });
    if (!child) {
      console.warn(`  ! ${plan.code}: expected a further round after ${parentId}, none was created`);
      break;
    }

    const parent = await prisma.auction.findUniqueOrThrow({
      where: { id: parentId },
      select: { endAt: true },
    });

    // A round that is going to be settled has to have run in the past. The
    // engine dates a new round from the moment it is created, so the window is
    // moved back to sit just after the round it followed.
    if (round.settle) {
      const startAt = new Date(parent.endAt.getTime() + child.reauctionStartDelayMinutes * 60_000);
      const endAt = new Date(startAt.getTime() + child.reauctionDurationHours * HOUR);
      await prisma.auction.update({
        where: { id: child.id },
        data: { startAt, endAt, status: 'ENDED', publishedAt: startAt },
      });
      child.startAt = startAt;
      child.endAt = endAt;
    }

    const credits = await prisma.bidCredit.findMany({
      where: { auctionId: child.id },
      select: { bidderId: true, remaining: true },
    });
    const creditMap = new Map(credits.map((c) => [c.bidderId, c.remaining]));

    // Who may bid in this round is the round's own rule, not a choice made
    // here: previous bidders hold the credits, newcomers join only if the
    // chain admits them — and on a restricted chain, only if they are on the
    // invite list the round inherited from the one before it.
    const returning = child.reauctionAllowPreviousBidders
      ? credits.map((c) => ({ id: c.bidderId, phoneNumber: context.phoneById.get(c.bidderId) ?? '' }))
      : [];

    let eligible = context.bidders.filter((b) => !creditMap.has(b.id));
    if (child.eligibilityMode === 'RESTRICTED') {
      const invited = new Set(
        (
          await prisma.auctionParticipant.findMany({
            where: { auctionId: child.id },
            select: { phoneNumber: true },
          })
        ).map((p) => p.phoneNumber)
      );
      eligible = eligible.filter((b) => invited.has(b.phoneNumber));
    }

    const newcomers = child.reauctionAllowNewBidders ? shuffle(eligible).slice(0, 35) : [];
    const pool = [...returning, ...newcomers];

    const { drafts, spent } = await seedBids(
      {
        auctionId: child.id,
        pool,
        fee: toNum(child.bidFee),
        min: toNum(child.minBidAmount),
        step: toNum(child.bidStep),
        slots: slotCount(toNum(child.minBidAmount), toNum(child.maxBidAmount), toNum(child.bidStep)),
        maxBidsPerUser: child.maxBidsPerUser,
        windowStart: child.startAt.getTime(),
        windowEnd: Math.min(child.endAt.getTime(), Date.now()),
        credits: creditMap,
      },
      round.bids
    );

    await writeBids(child.id, drafts, toNum(child.bidFee), context.phoneById);
    written += drafts.length;

    for (const [bidderId, used] of spent) {
      await prisma.bidCredit.update({
        where: { bidderId_auctionId: { bidderId, auctionId: child.id } },
        data: { consumed: { increment: used }, remaining: { decrement: used } },
      });
    }

    let note = 'left open';
    if (round.settle) {
      const outcome = await settleAuction(child.id, context.actor, { force: true });
      note = outcome.winnerBidId
        ? `winner at ${outcome.winningAmount?.toFixed(2)}`
        : `no winner → ${outcome.reauctionState}`;
    }

    console.log(
      `  ${child.code.padEnd(8)} round ${child.reauctionRound}          ${String(drafts.length).padStart(4)} bids  ${note}` +
        (spent.size > 0 ? `, ${Array.from(spent.values()).reduce((a, b) => a + b, 0)} carried` : '')
    );

    parentId = child.id;
  }

  return written;
}

// --------------------------------------
// Denormalised counters
// --------------------------------------

/**
 * Brings the cached totals in line with the bids that were just written.
 *
 * `confirmBid` maintains these one bid at a time; a bulk insert bypasses it,
 * so they are recomputed here from the rows themselves. `bidCount` counts
 * confirmed bids only, which is the same rule the rest of the platform reads
 * it by.
 */
async function recountTotals(auctionIds: string[], bidderIds: string[]) {
  const pairs = await prisma.bid.groupBy({
    by: ['auctionId', 'bidderId'],
    where: { auctionId: { in: auctionIds }, status: 'ACTIVE' },
    _count: { _all: true },
  });

  const bids = new Map<string, number>();
  const bidders = new Map<string, number>();
  for (const row of pairs) {
    bids.set(row.auctionId, (bids.get(row.auctionId) ?? 0) + row._count._all);
    bidders.set(row.auctionId, (bidders.get(row.auctionId) ?? 0) + 1);
  }

  for (const auctionId of auctionIds) {
    await prisma.auction.update({
      where: { id: auctionId },
      data: { bidCount: bids.get(auctionId) ?? 0, bidderCount: bidders.get(auctionId) ?? 0 },
    });
  }

  const perBidder = await prisma.bid.groupBy({
    by: ['bidderId'],
    where: { bidderId: { in: bidderIds }, status: 'ACTIVE' },
    _count: { _all: true },
    _sum: { feeAmount: true },
  });
  const totals = new Map(perBidder.map((row) => [row.bidderId, row]));

  for (const bidderId of bidderIds) {
    const row = totals.get(bidderId);
    await prisma.bidder.update({
      where: { id: bidderId },
      data: {
        totalBids: row?._count._all ?? 0,
        totalSpent: row?._sum.feeAmount ?? 0,
      },
    });
  }
}

/** A few saved auctions per bidder, as the mini-app's heart button records them. */
async function seedFavorites(bidderIds: string[], auctionIds: string[]) {
  const rows: { bidderId: string; auctionId: string; createdAt: Date }[] = [];
  const seen = new Set<string>();

  for (const bidderId of bidderIds) {
    const howMany = rng() < 0.55 ? intBetween(1, 3) : 0;
    for (let i = 0; i < howMany; i += 1) {
      const auctionId = pick(auctionIds);
      const key = `${bidderId}:${auctionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ bidderId, auctionId, createdAt: new Date(Date.now() - between(1, 30) * DAY) });
    }
  }

  await insertChunked('favorites', rows, 200, (chunk) =>
    prisma.bidderFavorite.createMany({ data: chunk })
  );
  return rows.length;
}

// --------------------------------------
// Summary
// --------------------------------------

async function summarise() {
  const auctions = await prisma.auction.findMany({
    where: { code: { startsWith: CODE_PREFIX } },
    select: { id: true, status: true, reauctionState: true },
  });
  const auctionIds = auctions.map((a) => a.id);

  const [byBidStatus, byPaymentStatus, winners, ledger, credits, participants] = await Promise.all([
    prisma.bid.groupBy({
      by: ['status'],
      where: { auctionId: { in: auctionIds } },
      _count: { _all: true },
    }),
    prisma.paymentTransaction.groupBy({
      by: ['status'],
      where: { auctionId: { in: auctionIds } },
      _count: { _all: true },
    }),
    prisma.winner.groupBy({
      by: ['status'],
      where: { auctionId: { in: auctionIds } },
      _count: { _all: true },
    }),
    prisma.auctionLedgerEntry.count({ where: { auctionId: { in: auctionIds } } }),
    prisma.bidCredit.count({ where: { auctionId: { in: auctionIds } } }),
    prisma.auctionParticipant.count({ where: { auctionId: { in: auctionIds } } }),
  ]);

  const tally = (rows: { status: string; _count: { _all: number } }[]) =>
    rows
      .sort((a, b) => b._count._all - a._count._all)
      .map((row) => `${row.status} ${row._count._all}`)
      .join(', ');

  const statuses = new Map<string, number>();
  for (const auction of auctions) {
    statuses.set(auction.status, (statuses.get(auction.status) ?? 0) + 1);
  }
  const states = new Map<string, number>();
  for (const auction of auctions) {
    states.set(auction.reauctionState, (states.get(auction.reauctionState) ?? 0) + 1);
  }

  const total = byBidStatus.reduce((sum, row) => sum + row._count._all, 0);

  console.log('\n────────────────────────────────────────────');
  console.log(`Auctions        ${auctions.length}`);
  console.log(`  by status     ${Array.from(statuses).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  re-auction    ${Array.from(states).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`Bids            ${total}`);
  console.log(`  by status     ${tally(byBidStatus)}`);
  console.log(`Payments        ${byPaymentStatus.reduce((s, r) => s + r._count._all, 0)}`);
  console.log(`  by status     ${tally(byPaymentStatus)}`);
  console.log(`Winners         ${winners.reduce((s, r) => s + r._count._all, 0)}`);
  console.log(`  by status     ${tally(winners)}`);
  console.log(`Ledger rows     ${ledger}`);
  console.log(`Bid credits     ${credits}`);
  console.log(`Participants    ${participants}`);
  console.log('────────────────────────────────────────────');

  return total;
}

// --------------------------------------
// Entry point
// --------------------------------------

async function main() {
  if (!isBidAmountKeyConfigured()) {
    throw new Error(
      'BID_ENCRYPTION_KEY is not set. Every bid amount is sealed with it, so the dataset ' +
        'cannot be written — and would not be readable by the app if it were. See .env.example.'
    );
  }

  console.log('Seeding the GuessLow demo dataset…\n');

  if (RESET) await resetDemoData();
  if (RESET_ONLY) {
    console.log('\nDemo data removed.');
    return;
  }

  const existing = await prisma.auction.count({ where: { code: { startsWith: CODE_PREFIX } } });
  if (existing > 0) {
    console.log(
      `${existing} demo auction(s) are already in the database.\n` +
        'Re-run with `-- --reset` to rebuild them, or `-- --reset-only` to remove them.'
    );
    return;
  }

  const actorUser = await demoActor();
  const actor = { id: actorUser.id, name: actorUser.fullName };

  const items = await seedCatalog(actor.id);
  const bidders = await seedBidders(actor.id);
  const lists = await seedParticipantLists(bidders, actor.id);
  const terms = await prisma.termsAndConditions.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!terms) console.warn('· no active terms version — auctions will be created without one');

  const context: SeedContext = {
    bidders,
    phoneById: new Map(bidders.map((b) => [b.id, b.phoneNumber])),
    byPhone: new Map(bidders.map((b) => [b.phoneNumber, b.id])),
    items,
    lists,
    termsId: terms?.id ?? null,
    actor,
  };

  console.log(`\n${PLANS.length} auction configurations:`);
  for (const [index, plan] of PLANS.entries()) {
    await seedPlan(plan, index, context);
  }

  const auctionIds = (
    await prisma.auction.findMany({
      where: { code: { startsWith: CODE_PREFIX } },
      select: { id: true },
    })
  ).map((a) => a.id);
  const bidderIds = bidders.map((b) => b.id);

  const favorites = await seedFavorites(bidderIds, auctionIds);
  await recountTotals(auctionIds, bidderIds);
  console.log(`\n✓ counters recomputed, ${favorites} favourites`);

  const total = await summarise();
  if (total < 3000) {
    console.warn(`! only ${total} bids were written — the dataset targets more than 3,000.`);
  }
}

main()
  .catch((error) => {
    console.error('\nDemo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
