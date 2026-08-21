import { describe, expect, it } from 'vitest';
import { confirmDecision } from './bidding';

/**
 * The gate manual reconciliation runs through.
 *
 * The case that matters is the one the ordinary path cannot serve: the gateway
 * took the fee, the callback never arrived, and by the time an operator reads
 * it off the statement the timeout sweep has already voided the bid. Confirming
 * the payment has to bring that bid back, or the platform keeps a fee for a bid
 * the bidder can no longer see. Everything else stays refused.
 */

const LIVE = { code: '195', status: 'LIVE' };

describe('confirmDecision', () => {
  it('confirms a bid that is still awaiting payment', () => {
    const decision = confirmDecision({ status: 'PENDING_PAYMENT' }, LIVE);
    expect(decision).toMatchObject({ confirm: true, reviving: false });
  });

  it('is idempotent for a bid that already counted', () => {
    const decision = confirmDecision({ status: 'ACTIVE' }, LIVE);
    expect(decision.confirm).toBe(true);
    expect(decision.alreadyActive).toBe(true);
  });

  it('refuses a voided bid on the ordinary path', () => {
    const decision = confirmDecision({ status: 'VOID' }, LIVE);
    expect(decision.confirm).toBe(false);
    expect(decision.reason).toContain('VOID');
  });

  it('revives a bid voided by the payment timeout', () => {
    const decision = confirmDecision({ status: 'VOID' }, LIVE, true);
    expect(decision).toMatchObject({ confirm: true, reviving: true });
  });

  it('revives a bid failed for non-payment', () => {
    const decision = confirmDecision({ status: 'FAILED' }, LIVE, true);
    expect(decision).toMatchObject({ confirm: true, reviving: true });
  });

  it('never revives a refunded bid — that fee was handed back', () => {
    const decision = confirmDecision({ status: 'REFUNDED' }, LIVE, true);
    expect(decision.confirm).toBe(false);
    expect(decision.reviving).toBe(false);
  });

  it('refuses to add a bid to a round that has already been decided', () => {
    for (const status of ['SETTLED', 'CANCELLED']) {
      const decision = confirmDecision({ status: 'VOID' }, { code: '195', status }, true);
      expect(decision.confirm).toBe(false);
      expect(decision.reason).toContain('Reverse the payment');
    }
  });

  it('still revives into a round that has ended but not settled', () => {
    // The fee was paid while it was open; settlement has simply not run yet.
    const decision = confirmDecision({ status: 'VOID' }, { code: '195', status: 'ENDED' }, true);
    expect(decision).toMatchObject({ confirm: true, reviving: true });
  });
});
