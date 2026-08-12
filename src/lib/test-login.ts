/**
 * Mini-app authorization bypass.
 *
 * Lets QA open the mini-app without a super-app token by nominating a phone
 * number directly. It exists so the bidding flow can be exercised end to end
 * before the super-app integration is wired up.
 *
 * Guard rails, because this skips authentication entirely:
 *   - off unless ALLOW_TEST_LOGIN=true is set in the environment;
 *   - every session is stamped `isTest`, shown as a banner in the mini-app and
 *     a warning on the admin dashboard;
 *   - test bids never touch the payment gateway and record a zero fee, so they
 *     cannot pollute revenue figures;
 *   - the phone number is prefixed so test bidders are obvious in the admin.
 */

export const TEST_PHONE_PREFIX = '2519000';

export function isTestLoginEnabled(): boolean {
  return process.env.ALLOW_TEST_LOGIN === 'true';
}

/** Human-readable reason the bypass is unavailable, or null when it is on. */
export function testLoginUnavailableReason(): string | null {
  if (isTestLoginEnabled()) return null;
  return 'Test sign-in is disabled. Set ALLOW_TEST_LOGIN=true in the environment to enable it.';
}
