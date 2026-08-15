// Shared domain types. SQL Server has no Prisma enums, so these unions are the
// single source of truth for what the String status columns may contain.

export const AUCTION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'LIVE',
  'ENDED',
  'SETTLED',
  'CANCELLED',
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const BID_STATUSES = [
  'PENDING_PAYMENT',
  'ACTIVE',
  'FAILED',
  'VOID',
  'REFUNDED',
] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'EXPIRED',
  'REVERSED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WINNER_STATUSES = [
  'PENDING_CLAIM',
  'CLAIMED',
  'VERIFIED',
  'FULFILLED',
  'FORFEITED',
  'CANCELLED',
] as const;
export type WinnerStatus = (typeof WINNER_STATUSES)[number];

export const BIDDER_STATUSES = ['ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
export type BidderStatus = (typeof BIDDER_STATUSES)[number];

// Who an auction admits. RESTRICTED admits only the phone numbers on the
// auction's uploaded participant list — see src/lib/eligibility.ts.
export const ELIGIBILITY_MODES = ['OPEN', 'RESTRICTED'] as const;
export type EligibilityMode = (typeof ELIGIBILITY_MODES)[number];

// What settlement decided about re-running an auction that produced no winner.
export const REAUCTION_STATES = [
  'NONE', // not settled yet, so nothing has been decided
  'NOT_NEEDED', // settled with a valid winner
  'PENDING', // flagged for re-auction, waiting for an operator to open it
  'CREATED', // a re-auction round was opened
  'EXHAUSTED', // no winner, but the configured round limit is used up
  'DISABLED', // no winner, and re-auction is switched off for this auction
  'BLOCKED', // no winner, but the rules leave nobody able to bid in a re-run
] as const;
export type ReauctionState = (typeof REAUCTION_STATES)[number];

/** Who a settlement or re-auction is attributed to. `SYSTEM` is the scheduler. */
export interface SettlementActor {
  id: string;
  name?: string;
}

// --------------------------------------
// ADVERTISEMENTS
// --------------------------------------

/** Where an ad is surfaced in the mini-app. */
export const AD_PLACEMENTS = ['POST_LOGIN'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/** How often one bidder may be shown the same ad. */
export const AD_FREQUENCIES = ['EVERY_LOGIN', 'ONCE_PER_DAY', 'ONCE'] as const;
export type AdFrequency = (typeof AD_FREQUENCIES)[number];

/** Upper bound on a forced view, so a typo cannot trap a bidder in the popup. */
export const MAX_MIN_VIEW_SECONDS = 30;
export const MAX_AUTO_CLOSE_SECONDS = 120;

export const AD_FREQUENCY_LABELS: Record<AdFrequency, string> = {
  EVERY_LOGIN: 'Every time the app is opened',
  ONCE_PER_DAY: 'Once every 24 hours',
  ONCE: 'Once ever',
};

export const PENDING_CHANGE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type PendingChangeStatus = (typeof PENDING_CHANGE_STATUSES)[number];

export const PENDING_CHANGE_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'PUBLISH',
  'CANCEL',
  'SETTLE',
] as const;
export type PendingChangeAction = (typeof PENDING_CHANGE_ACTIONS)[number];

export type Language = 'en' | 'am';

// --------------------------------------
// PERMISSIONS
// --------------------------------------

export const PERMISSION_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'approve',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ModulePermission = Partial<Record<PermissionAction, boolean>>;
export type Permissions = Record<string, ModulePermission>;

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  status: string;
  role: string;
  roleId: string;
  permissions: Permissions;
  passwordChangeRequired: boolean;
}

// --------------------------------------
// VIEW MODELS (Decimal-free, safe to serialize to the client)
// --------------------------------------

export interface AuctionListItem {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  status: AuctionStatus;
  imageUrl: string | null;
  categoryName: string;
  retailPrice: number;
  bidFee: number;
  minBidAmount: number;
  maxBidAmount: number;
  bidStep: number;
  maxBidsPerUser: number;
  maxTotalBids: number;
  startAt: string;
  endAt: string;
  bidCount: number;
  viewCount: number;
  featured: boolean;
  currency: string;
  reauctionRound: number;
  reauctionState: ReauctionState;
}

export interface MyBidView {
  id: string;
  amount: number;
  feeAmount: number;
  /** Paid for in an earlier round of this auction, so no fee was charged again. */
  carriedOver: boolean;
  status: BidStatus;
  createdAt: string;
  sequence: number;
  // Only ever populated once the auction is settled.
  isUnique: boolean | null;
  rank: number | null;
}
