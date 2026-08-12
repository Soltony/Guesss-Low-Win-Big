/**
 * GuessLow database seed.
 *
 * Idempotent: safe to re-run. Creates the role set, a bootstrap Super Admin,
 * the setting rows, notification templates, a starter catalogue and — unless
 * SEED_DEMO=false — a few demo auctions so the mini-app has something to show.
 *
 *   npm run db:push && npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SETTING_DEFINITIONS } from '../src/lib/settings';
import { DEFAULT_TEMPLATES } from '../src/lib/notifications';
import { MODULE_KEYS } from '../src/lib/route-permissions';

const prisma = new PrismaClient();

type Actions = 'read' | 'create' | 'update' | 'delete' | 'approve';

function matrix(spec: Record<string, Actions[] | 'all'>) {
  const out: Record<string, Record<Actions, boolean>> = {};
  for (const key of MODULE_KEYS) {
    const granted = spec[key];
    const all = granted === 'all';
    const list = Array.isArray(granted) ? granted : [];
    out[key] = {
      read: all || list.includes('read'),
      create: all || list.includes('create'),
      update: all || list.includes('update'),
      delete: all || list.includes('delete'),
      approve: all || list.includes('approve'),
    };
  }
  return out;
}

const ROLES = [
  {
    name: 'Super Admin',
    description: 'Unrestricted access to every module and action.',
    isSystem: true,
    permissions: matrix(Object.fromEntries(MODULE_KEYS.map((k) => [k, 'all' as const]))),
  },
  {
    name: 'Auction Manager',
    description: 'Runs the day-to-day auction operation, without user administration.',
    isSystem: true,
    permissions: matrix({
      dashboard: ['read'],
      auctions: ['read', 'create', 'update'],
      bids: ['read'],
      winners: ['read', 'update'],
      payments: ['read'],
      items: ['read', 'create', 'update'],
      categories: ['read', 'create', 'update'],
      content: ['read', 'create', 'update'],
      bidders: ['read', 'update'],
      notifications: ['read', 'update'],
      approvals: ['read'],
      reports: ['read'],
      settings: ['read'],
    }),
  },
  {
    name: 'Approver',
    description: 'Second pair of eyes: approves changes and settles auctions.',
    isSystem: true,
    permissions: matrix({
      dashboard: ['read'],
      auctions: ['read', 'approve'],
      bids: ['read'],
      winners: ['read', 'update', 'approve'],
      payments: ['read', 'update', 'approve'],
      approvals: ['read', 'update', 'approve'],
      reports: ['read'],
      settings: ['read'],
      'audit-logs': ['read'],
    }),
  },
  {
    name: 'Finance',
    description: 'Payment reconciliation, refunds and revenue reporting.',
    isSystem: true,
    permissions: matrix({
      dashboard: ['read'],
      auctions: ['read'],
      bids: ['read'],
      winners: ['read'],
      payments: ['read', 'update', 'approve'],
      bidders: ['read'],
      reports: ['read'],
      'audit-logs': ['read'],
    }),
  },
  {
    name: 'Support',
    description: 'Customer support: looks up bidders, bids and prize claims.',
    isSystem: true,
    permissions: matrix({
      dashboard: ['read'],
      auctions: ['read'],
      bids: ['read'],
      winners: ['read', 'update'],
      bidders: ['read', 'update'],
      notifications: ['read'],
    }),
  },
  {
    name: 'Auditor',
    description: 'Read-only oversight across the platform, including audit logs.',
    isSystem: true,
    permissions: matrix({
      dashboard: ['read'],
      auctions: ['read'],
      bids: ['read'],
      winners: ['read'],
      payments: ['read'],
      items: ['read'],
      categories: ['read'],
      bidders: ['read'],
      approvals: ['read'],
      reports: ['read'],
      settings: ['read'],
      'audit-logs': ['read'],
    }),
  },
];

const CATEGORIES = [
  { name: 'Mobile Phones', nameAm: 'ሞባይል ስልኮች', slug: 'mobile-phones', displayOrder: 0 },
  { name: 'Electronics', nameAm: 'ኤሌክትሮኒክስ', slug: 'electronics', displayOrder: 1 },
  { name: 'Home Appliances', nameAm: 'የቤት እቃዎች', slug: 'home-appliances', displayOrder: 2 },
  { name: 'Accessories', nameAm: 'መለዋወጫዎች', slug: 'accessories', displayOrder: 3 },
];

const ITEMS = [
  {
    name: 'Calus TF20 Multi-Functional Power Bank & Wireless Headset',
    nameAm: 'ካሉስ TF20 ባለብዙ ተግባር ፓወር ባንክ እና ገመድ አልባ ጆሮ ማዳመጫ',
    description:
      'A 10,000 mAh power bank with a built-in colour display and detachable TWS earbuds. Fast charging over USB-C, dual output, and an integrated digital clock.',
    brand: 'Calus',
    model: 'TF20',
    retailPrice: 4500,
    categorySlug: 'accessories',
  },
  {
    name: 'Elegance Freestanding Water Dispenser | Hot & Cold Taps',
    nameAm: 'ኤሌጋንስ የውሃ ማከፋፈያ | ሙቅና ቀዝቃዛ',
    description:
      'Freestanding hot and cold water dispenser with a lockable hot tap, a lower storage cabinet and a stainless steel tank.',
    brand: 'Elegance',
    retailPrice: 12500,
    categorySlug: 'home-appliances',
  },
  {
    name: 'Infinix Smart 8 — 128GB',
    nameAm: 'ኢንፊኒክስ ስማርት 8 — 128 ጂቢ',
    description:
      '6.6" HD+ 90Hz display, 50MP AI dual camera, 5000mAh battery and 128GB storage. Dual SIM, unlocked.',
    brand: 'Infinix',
    model: 'Smart 8',
    retailPrice: 15900,
    categorySlug: 'mobile-phones',
  },
  {
    name: '55" 4K Smart LED Television',
    nameAm: '55 ኢንች 4K ስማርት ቴሌቪዥን',
    description:
      '55-inch 4K UHD smart television with HDR10, built-in Wi-Fi, three HDMI ports and screen mirroring.',
    retailPrice: 42000,
    categorySlug: 'electronics',
  },
];

async function seedRoles() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        isSystem: role.isSystem,
        // System role matrices stay in sync with the module registry on re-run.
        permissions: JSON.stringify(role.permissions),
      },
      create: {
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: JSON.stringify(role.permissions),
      },
    });
  }
  console.log(`✓ ${ROLES.length} roles`);
}

async function seedSuperAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@guesslow.et').toLowerCase();
  const phone = process.env.SEED_ADMIN_PHONE || '251900000001';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026';

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'Super Admin' } });
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`✓ Super Admin already exists (${email}) — password left untouched`);
    return;
  }

  await prisma.user.create({
    data: {
      fullName: process.env.SEED_ADMIN_NAME || 'GuessLow Administrator',
      email,
      phoneNumber: phone,
      password: await bcrypt.hash(password, 12),
      // Forces a real password on first sign-in.
      passwordChangeRequired: true,
      status: 'ACTIVE',
      roleId: role.id,
    },
  });

  console.log(`✓ Super Admin created`);
  console.log(`    email:    ${email}`);
  console.log(`    password: ${password}   (must be changed at first sign-in)`);
}

async function seedSettings() {
  for (const definition of SETTING_DEFINITIONS) {
    await prisma.systemSetting.upsert({
      where: { key: definition.key },
      update: { description: definition.description, category: definition.category },
      create: {
        key: definition.key,
        value: JSON.stringify(definition.default),
        description: definition.description,
        category: definition.category,
      },
    });
  }
  console.log(`✓ ${SETTING_DEFINITIONS.length} settings`);
}

async function seedTemplates() {
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { code: template.code },
      update: {},
      create: {
        code: template.code,
        name: template.name,
        channel: template.channel,
        bodyEn: template.bodyEn,
        bodyAm: template.bodyAm,
        active: true,
      },
    });
  }
  console.log(`✓ ${DEFAULT_TEMPLATES.length} notification templates`);
}

async function seedTerms() {
  const existing = await prisma.termsAndConditions.findFirst({ where: { active: true } });
  if (existing) return;

  await prisma.termsAndConditions.create({
    data: {
      version: '1.0',
      title: 'GuessLow Auction Terms & Conditions',
      active: true,
      contentEn: [
        '1. GuessLow is a Lowest Unique Bid Auction. The winner is the participant holding the lowest bid amount that no other participant has submitted.',
        '2. A non-refundable service fee is charged for every bid placed. The fee is displayed on each auction before you bid.',
        '3. A bid is only counted once its service fee has been confirmed. Unpaid bids are void and do not affect the result.',
        '4. Bid amounts and their uniqueness status remain hidden until the auction closes.',
        '5. A participant may submit multiple different amounts on the same auction, up to the per-auction limit shown.',
        '6. If no bid amount is unique when an auction closes, the auction has no winner and no prize is awarded.',
        '7. Winners must claim their prize within the claim window shown in the app. Unclaimed prizes may be forfeited and offered to the next-ranked unique bid.',
        '8. Winners must pay their winning bid amount and present valid identification matching the registered phone number to collect the prize.',
        '9. GuessLow may cancel an auction where technical failure, fraud or manipulation is detected. Service fees for cancelled auctions are refunded.',
        '10. Employees of the operator and their immediate families may not participate.',
      ].join('\n\n'),
      contentAm: [
        '1. GuessLow ዝቅተኛ ልዩ ጨረታ መድረክ ነው። አሸናፊው ሌላ ማንም ያላቀረበውን ዝቅተኛ የጨረታ መጠን ያቀረበ ተሳታፊ ነው።',
        '2. ለእያንዳንዱ ጨረታ ተመላሽ የማይደረግ የአገልግሎት ክፍያ ይከፈላል። ክፍያው ከመጫረትዎ በፊት በእያንዳንዱ ጨረታ ላይ ይታያል።',
        '3. ጨረታ የሚቆጠረው የአገልግሎት ክፍያው ሲረጋገጥ ብቻ ነው። ያልተከፈለ ጨረታ ዋጋ የለውም።',
        '4. የጨረታ መጠኖችና የልዩነት ሁኔታቸው ጨረታው እስኪዘጋ ድረስ ተደብቀው ይቆያሉ።',
        '5. አንድ ተሳታፊ በአንድ ጨረታ ላይ እስከተገለጸው ገደብ ድረስ የተለያዩ መጠኖችን ማቅረብ ይችላል።',
        '6. ጨረታው ሲዘጋ ልዩ የሆነ መጠን ከሌለ አሸናፊ አይኖርም።',
        '7. አሸናፊዎች በመተግበሪያው በተገለጸው ጊዜ ውስጥ ሽልማታቸውን መጠየቅ አለባቸው።',
        '8. አሸናፊዎች ያሸነፉበትን መጠን መክፈልና ከተመዘገበው ስልክ ቁጥር ጋር የሚዛመድ ትክክለኛ መታወቂያ ማቅረብ አለባቸው።',
        '9. GuessLow የቴክኒክ ብልሽት፣ ማጭበርበር ወይም ተጽዕኖ ሲያጋጥም ጨረታን መሰረዝ ይችላል።',
        '10. የአስተዳዳሪው ሰራተኞችና ቤተሰቦቻቸው መሳተፍ አይችሉም።',
      ].join('\n\n'),
    },
  });
  console.log('✓ terms & conditions v1.0');
}

async function seedCatalog() {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, nameAm: category.nameAm },
      create: { ...category, status: 'ACTIVE' },
    });
  }

  for (const item of ITEMS) {
    const category = await prisma.category.findUniqueOrThrow({
      where: { slug: item.categorySlug },
    });
    const existing = await prisma.item.findFirst({ where: { name: item.name } });
    if (existing) continue;

    await prisma.item.create({
      data: {
        name: item.name,
        nameAm: item.nameAm,
        description: item.description,
        brand: item.brand,
        model: item.model,
        retailPrice: item.retailPrice,
        categoryId: category.id,
        images: '[]',
        stockQty: 1,
        status: 'ACTIVE',
      },
    });
  }

  console.log(`✓ ${CATEGORIES.length} categories, ${ITEMS.length} items`);
}

async function seedDemoAuctions() {
  if (process.env.SEED_DEMO === 'false') return;

  const existing = await prisma.auction.count();
  if (existing > 0) {
    console.log('· demo auctions skipped (auctions already exist)');
    return;
  }

  const terms = await prisma.termsAndConditions.findFirst({ where: { active: true } });
  const items = await prisma.item.findMany({ take: 4, orderBy: { createdAt: 'asc' } });
  const now = Date.now();

  const plans = [
    { code: '185', days: 1, fee: 50, featured: false, status: 'LIVE' },
    { code: '195', days: 10, fee: 30, featured: true, status: 'LIVE' },
    { code: '196', days: 14, fee: 40, featured: true, status: 'LIVE' },
    { code: '197', days: 21, fee: 25, featured: false, status: 'SCHEDULED' },
  ];

  for (const [index, plan] of plans.entries()) {
    const item = items[index % items.length];
    if (!item) break;

    const startAt = plan.status === 'SCHEDULED' ? new Date(now + 2 * 86_400_000) : new Date(now - 86_400_000);

    await prisma.auction.create({
      data: {
        code: plan.code,
        title: item.name,
        titleAm: item.nameAm,
        itemId: item.id,
        categoryId: item.categoryId,
        bidFee: plan.fee,
        minBidAmount: 0.01,
        maxBidAmount: 999.99,
        bidStep: 0.01,
        maxBidsPerUser: 100,
        currency: 'ETB',
        startAt,
        endAt: new Date(now + plan.days * 86_400_000),
        status: plan.status,
        featured: plan.featured,
        displayOrder: index,
        publishedAt: new Date(),
        termsId: terms?.id,
      },
    });
  }

  console.log(`✓ ${plans.length} demo auctions`);
}

async function main() {
  console.log('Seeding GuessLow…\n');
  await seedRoles();
  await seedSuperAdmin();
  await seedSettings();
  await seedTemplates();
  await seedTerms();
  await seedCatalog();
  await seedDemoAuctions();
  console.log('\nSeed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
