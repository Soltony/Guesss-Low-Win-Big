import { tryDecryptBidAmount } from './bid-crypto';
import { MASKED_AMOUNT } from './format';

/**
 * The single rule for who may see a bid amount, and the only place a stored
 * ciphertext is turned back into a number for display.
 *
 * There are exactly two grounds for disclosure:
 *
 *   1. You placed the bid. A bidder can always read their own amounts, live or
 *      not — they typed them in.
 *   2. The auction has SETTLED. From that moment the amounts are history and
 *      the ordinary authorization rules take over: admin pages still gate on
 *      `bids.read` / `auctions.read`, the mini-app still shows a bidder only
 *      their own rows.
 *
 * Everything else — another bidder mid-auction, an operator watching a live
 * auction, an export, an audit entry — gets `null`. Callers hand `null` to the
 * UI as a mask; the number never reaches the response at all, so there is
 * nothing to find in a payload, a log, or the browser.
 *
 * ENDED-but-unsettled deliberately does not reveal. An ended auction can still
 * be re-settled, extended by a late payment callback, or rolled into a
 * re-auction, so its bid space is still live information.
 */

export { MASKED_AMOUNT };

export interface AmountViewer {
  /** Set when the viewer is a signed-in bidder; absent for admin and public views. */
  bidderId?: string | null;
}

/** Admin staff have no ownership claim on a bid, so they are never the bidder. */
export const ADMIN_VIEWER: AmountViewer = {};

/** Amounts on this auction are past the settlement boundary. */
export function auctionAmountsRevealed(auction: { status: string }): boolean {
  return auction.status === 'SETTLED';
}

export function canRevealBidAmount(
  bid: { bidderId: string },
  auction: { status: string },
  viewer: AmountViewer
): boolean {
  if (viewer.bidderId && viewer.bidderId === bid.bidderId) return true;
  return auctionAmountsRevealed(auction);
}

export interface SealedBid {
  bidderId: string;
  auctionId: string;
  amountCipher: string;
}

/**
 * The amount this viewer is allowed to see, or `null` when it is withheld or
 * unreadable. Decryption is skipped entirely when the policy says no, so a
 * masked row costs nothing and cannot leak through a stack trace.
 */
export function revealBidAmount(
  bid: SealedBid,
  auction: { status: string },
  viewer: AmountViewer
): number | null {
  if (!canRevealBidAmount(bid, auction, viewer)) return null;
  return tryDecryptBidAmount(bid.amountCipher, {
    auctionId: bid.auctionId,
    bidderId: bid.bidderId,
  });
}

/** Table-cell rendering for a possibly-withheld amount. */
export function formatRevealedAmount(amount: number | null, currency?: string): string {
  if (amount === null) return MASKED_AMOUNT;
  return currency ? `${amount.toFixed(2)} ${currency}` : amount.toFixed(2);
}
