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
  startAt: string;
  endAt: string;
  bidCount: number;
  viewCount: number;
  featured: boolean;
  currency: string;
}

export interface MyBidView {
  id: string;
  amount: number;
  feeAmount: number;
  status: BidStatus;
  createdAt: string;
  sequence: number;
  // Only ever populated once the auction is settled.
  isUnique: boolean | null;
  rank: number | null;
}
