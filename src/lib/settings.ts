import prisma from './prisma';

/**
 * Central configuration registry.
 *
 * Everything the business may want to change without a redeploy is declared
 * here once: the admin Settings page renders itself from these definitions,
 * and the rest of the code reads values through `getSetting`.
 */

export type SettingType = 'number' | 'string' | 'boolean' | 'select' | 'textarea';

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  category: SettingCategory;
  type: SettingType;
  default: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** Changing this requires a second approver when maker-checker is on. */
  sensitive?: boolean;
}

export const SETTING_CATEGORIES = [
  'platform',
  'bidding',
  'reveal',
  'winners',
  'payments',
  'notifications',
  'security',
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SettingCategory, string> = {
  platform: 'Platform',
  bidding: 'Bidding Rules',
  reveal: 'Bid Visibility',
  winners: 'Winners & Claims',
  payments: 'Payments',
  notifications: 'Notifications',
  security: 'Security & Governance',
};

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ---- Platform ----
  {
    key: 'platform.name',
    label: 'Platform name',
    description: 'Shown in the mini-app header, SMS messages and page titles.',
    category: 'platform',
    type: 'string',
    default: 'GuessLow',
  },
  {
    key: 'platform.tagline',
    label: 'Tagline',
    description: 'Headline under the hero banner on the mini-app home page.',
    category: 'platform',
    type: 'string',
    default: 'Bid Low! Win Big!',
  },
  {
    key: 'platform.currency',
    label: 'Currency code',
    description: 'Currency all amounts are denominated in.',
    category: 'platform',
    type: 'string',
    default: 'ETB',
  },
  {
    key: 'platform.defaultLanguage',
    label: 'Default language',
    description: 'Language used before a bidder picks one.',
    category: 'platform',
    type: 'select',
    default: 'en',
    options: [
      { value: 'en', label: 'English' },
      { value: 'am', label: 'አማርኛ (Amharic)' },
    ],
  },
  {
    key: 'platform.supportPhone',
    label: 'Support phone',
    description: 'Contact number shown in the mini-app.',
    category: 'platform',
    type: 'string',
    default: '8080',
  },
  {
    key: 'platform.maintenanceMode',
    label: 'Maintenance mode',
    description: 'Blocks all new bids and shows a maintenance notice in the mini-app.',
    category: 'platform',
    type: 'boolean',
    default: false,
    sensitive: true,
  },
  {
    key: 'platform.maintenanceMessage',
    label: 'Maintenance message',
    description: 'Message displayed to bidders while maintenance mode is on.',
    category: 'platform',
    type: 'textarea',
    default: 'GuessLow is briefly unavailable for maintenance. Please try again shortly.',
  },

  // ---- Bidding ----
  {
    key: 'bidding.defaultBidFee',
    label: 'Default bid service fee',
    description: 'Fee charged per bid on a new auction, before it is overridden per auction.',
    category: 'bidding',
    type: 'number',
    default: 30,
    min: 0,
    step: 0.5,
  },
  {
    key: 'bidding.defaultMinBid',
    label: 'Default minimum bid amount',
    description: 'Lowest amount a bidder may guess on a new auction.',
    category: 'bidding',
    type: 'number',
    default: 0.01,
    min: 0.01,
    step: 0.01,
  },
  {
    key: 'bidding.defaultMaxBid',
    label: 'Default maximum bid amount',
    description: 'Highest amount a bidder may guess on a new auction.',
    category: 'bidding',
    type: 'number',
    default: 999.99,
    min: 1,
    step: 0.01,
  },
  {
    key: 'bidding.defaultBidStep',
    label: 'Default bid increment',
    description: 'Step used by the −/+ buttons and enforced on submitted amounts.',
    category: 'bidding',
    type: 'number',
    default: 0.01,
    min: 0.01,
    step: 0.01,
  },
  {
    key: 'bidding.defaultMaxBidsPerUser',
    label: 'Default max bids per bidder',
    description: 'How many different amounts one bidder may submit on a single auction.',
    category: 'bidding',
    type: 'number',
    default: 100,
    min: 1,
    max: 1000,
    step: 1,
  },
  {
    key: 'bidding.allowRepeatOwnAmount',
    label: 'Allow repeating your own amount',
    description:
      'When off, a bidder cannot submit an amount they already bid on the same auction (their own duplicate would destroy their own uniqueness).',
    category: 'bidding',
    type: 'boolean',
    default: false,
  },
  {
    key: 'bidding.cooldownSeconds',
    label: 'Cooldown between bids (seconds)',
    description: 'Minimum gap between two bids from the same bidder. 0 disables the throttle.',
    category: 'bidding',
    type: 'number',
    default: 2,
    min: 0,
    max: 300,
    step: 1,
  },
  {
    key: 'bidding.defaultDurationDays',
    label: 'Default auction duration (days)',
    description: 'Pre-filled duration when creating an auction.',
    category: 'bidding',
    type: 'number',
    default: 10,
    min: 1,
    max: 90,
    step: 1,
  },
  {
    key: 'bidding.defaultAutoExtendMinutes',
    label: 'Default auto-extend window (minutes)',
    description:
      'If a bid lands within this many minutes of the end, the auction extends by the same amount. 0 disables it.',
    category: 'bidding',
    type: 'number',
    default: 0,
    min: 0,
    max: 120,
    step: 1,
  },
  {
    key: 'bidding.endingSoonHours',
    label: '"Ending soon" threshold (hours)',
    description: 'Auctions ending within this window appear in the Ending Soon rail.',
    category: 'bidding',
    type: 'number',
    default: 24,
    min: 1,
    max: 240,
    step: 1,
  },

  // ---- Bid visibility ----
  {
    key: 'reveal.policy',
    label: 'Bid status visibility',
    description:
      'Controls when a bidder can see whether their own bids are unique. Hiding it until the auction ends prevents probing the bid space.',
    category: 'reveal',
    type: 'select',
    default: 'END_ONLY',
    sensitive: true,
    options: [
      { value: 'END_ONLY', label: 'Hidden until the auction ends' },
      { value: 'LAST_WINDOW', label: 'Revealed in the final window only' },
      { value: 'LIVE', label: 'Live status on every bid' },
    ],
  },
  {
    key: 'reveal.windowMinutes',
    label: 'Final reveal window (minutes)',
    description: 'How long before the end status becomes visible, when the policy is "final window".',
    category: 'reveal',
    type: 'number',
    default: 60,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'reveal.showBidCount',
    label: 'Show total bid count',
    description: 'Display the number of bids placed on a live auction.',
    category: 'reveal',
    type: 'boolean',
    default: true,
  },
  {
    key: 'reveal.showViewCount',
    label: 'Show view count',
    description: 'Display how many times an auction has been viewed.',
    category: 'reveal',
    type: 'boolean',
    default: true,
  },

  // ---- Winners ----
  {
    key: 'winners.autoSettle',
    label: 'Auto-settle ended auctions',
    description:
      'Determine the winner automatically once an auction ends. When off, an operator must settle each auction manually.',
    category: 'winners',
    type: 'boolean',
    default: true,
  },
  {
    key: 'winners.settleGraceMinutes',
    label: 'Settlement grace period (minutes)',
    description:
      'Wait this long after the end time before settling, so in-flight payment callbacks can still confirm their bids.',
    category: 'winners',
    type: 'number',
    default: 10,
    min: 0,
    max: 1440,
    step: 1,
  },
  {
    key: 'winners.claimWindowHours',
    label: 'Claim window (hours)',
    description: 'How long a winner has to claim their prize before it can be forfeited.',
    category: 'winners',
    type: 'number',
    default: 72,
    min: 1,
    max: 720,
    step: 1,
  },
  {
    key: 'winners.runnerUpDepth',
    label: 'Runner-ups to record',
    description:
      'How many ranked unique bids to store at settlement, used to promote a replacement if a winner forfeits.',
    category: 'winners',
    type: 'number',
    default: 5,
    min: 0,
    max: 50,
    step: 1,
  },
  {
    key: 'winners.publishWinnerPhone',
    label: 'Show winner phone publicly',
    description: 'When on, the winners board shows a masked phone number instead of nothing.',
    category: 'winners',
    type: 'boolean',
    default: true,
  },

  // ---- Payments ----
  {
    key: 'payments.enabled',
    label: 'Charge bid fees',
    description:
      'When off, bids are accepted without a payment call. Intended for pilots and testing only.',
    category: 'payments',
    type: 'boolean',
    default: true,
    sensitive: true,
  },
  {
    key: 'payments.companyName',
    label: 'Merchant company name',
    description: 'Company name sent to the super-app payment gateway.',
    category: 'payments',
    type: 'string',
    default: 'GuessLow',
  },
  {
    key: 'payments.accountNo',
    label: 'Collection account number',
    description:
      'Merchant account credited with bid fees. Falls back to the ACCOUNT_NO environment variable when blank.',
    category: 'payments',
    type: 'string',
    default: '',
    sensitive: true,
  },
  {
    key: 'payments.pendingTimeoutMinutes',
    label: 'Payment timeout (minutes)',
    description:
      'A bid whose payment has not been confirmed within this window is voided and never counts toward the result.',
    category: 'payments',
    type: 'number',
    default: 15,
    min: 1,
    max: 240,
    step: 1,
  },
  {
    key: 'payments.refundVoidedBids',
    label: 'Flag voided paid bids for refund',
    description:
      'If a payment succeeds after its bid was voided, mark the transaction for refund instead of silently keeping it.',
    category: 'payments',
    type: 'boolean',
    default: true,
  },

  // ---- Notifications ----
  {
    key: 'notifications.enabled',
    label: 'Send notifications',
    description: 'Master switch for all outbound SMS and push messages.',
    category: 'notifications',
    type: 'boolean',
    default: true,
  },
  {
    key: 'notifications.onBidConfirmed',
    label: 'Notify on bid confirmation',
    description: 'Send a message once a bid fee payment succeeds.',
    category: 'notifications',
    type: 'boolean',
    default: true,
  },
  {
    key: 'notifications.onAuctionEnding',
    label: 'Notify before an auction ends',
    description: 'Remind bidders who placed a bid that their auction is about to close.',
    category: 'notifications',
    type: 'boolean',
    default: true,
  },
  {
    key: 'notifications.onWin',
    label: 'Notify the winner',
    description: 'Message the winning bidder as soon as an auction is settled.',
    category: 'notifications',
    type: 'boolean',
    default: true,
  },

  // ---- Security & governance ----
  {
    key: 'security.maxFailedLogins',
    label: 'Max failed admin logins',
    description: 'Failed attempts before an admin account is temporarily locked.',
    category: 'security',
    type: 'number',
    default: 5,
    min: 1,
    max: 20,
    step: 1,
  },
  {
    key: 'security.lockoutMinutes',
    label: 'Lockout duration (minutes)',
    description: 'How long an admin account stays locked after too many failed logins.',
    category: 'security',
    type: 'number',
    default: 15,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'security.requireApprovalForPublish',
    label: 'Maker-checker on publishing auctions',
    description:
      'Publishing an auction creates a pending change that a second admin must approve.',
    category: 'security',
    type: 'boolean',
    default: true,
    sensitive: true,
  },
  {
    key: 'security.requireApprovalForSettings',
    label: 'Maker-checker on sensitive settings',
    description: 'Changes to settings marked sensitive require a second approver.',
    category: 'security',
    type: 'boolean',
    default: true,
    sensitive: true,
  },
  {
    key: 'security.requireApprovalForSettlement',
    label: 'Maker-checker on manual settlement',
    description: 'Manually settling or re-settling an auction requires a second approver.',
    category: 'security',
    type: 'boolean',
    default: true,
    sensitive: true,
  },
];

export const SETTINGS_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export type SettingsMap = Record<string, string | number | boolean>;

export function defaultSettings(): SettingsMap {
  const out: SettingsMap = {};
  for (const def of SETTING_DEFINITIONS) out[def.key] = def.default;
  return out;
}

function coerce(def: SettingDefinition, raw: string): string | number | boolean {
  try {
    const parsed = JSON.parse(raw);
    if (def.type === 'number') {
      const n = Number(parsed);
      return Number.isFinite(n) ? n : (def.default as number);
    }
    if (def.type === 'boolean') return Boolean(parsed);
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    if (def.type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : (def.default as number);
    }
    if (def.type === 'boolean') return raw === 'true';
    return raw;
  }
}

// Short-lived cache: settings are read on nearly every request but change rarely.
let cache: { value: SettingsMap; expiresAt: number } | null = null;
const CACHE_MS = 15_000;

export function invalidateSettingsCache() {
  cache = null;
}

export async function getSettings(force = false): Promise<SettingsMap> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;

  const merged = defaultSettings();
  try {
    const rows = await prisma.systemSetting.findMany();
    for (const row of rows) {
      const def = SETTINGS_BY_KEY.get(row.key);
      if (!def) continue;
      merged[row.key] = coerce(def, row.value);
    }
  } catch (error) {
    // A settings read must never take the site down; fall back to defaults.
    console.error('[settings] failed to load, using defaults', error);
  }

  cache = { value: merged, expiresAt: Date.now() + CACHE_MS };
  return merged;
}

export async function getSetting<T extends string | number | boolean>(
  key: string
): Promise<T> {
  const all = await getSettings();
  return all[key] as T;
}

export async function setSetting(
  key: string,
  value: string | number | boolean,
  updatedById?: string
) {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);

  await prisma.systemSetting.upsert({
    where: { key },
    create: {
      key,
      value: JSON.stringify(value),
      description: def.description,
      category: def.category,
      updatedById,
    },
    update: { value: JSON.stringify(value), updatedById },
  });
  invalidateSettingsCache();
}

export function validateSettingValue(
  def: SettingDefinition,
  value: unknown
): { ok: true; value: string | number | boolean } | { ok: false; error: string } {
  if (def.type === 'boolean') return { ok: true, value: Boolean(value) };

  if (def.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number.` };
    if (def.min !== undefined && n < def.min)
      return { ok: false, error: `${def.label} must be at least ${def.min}.` };
    if (def.max !== undefined && n > def.max)
      return { ok: false, error: `${def.label} must be at most ${def.max}.` };
    return { ok: true, value: n };
  }

  const s = String(value ?? '');
  if (def.type === 'select' && def.options && !def.options.some((o) => o.value === s)) {
    return { ok: false, error: `${def.label} must be one of the listed options.` };
  }
  if (s.length > 4000) return { ok: false, error: `${def.label} is too long.` };
  return { ok: true, value: s };
}
