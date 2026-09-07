import { describe, expect, it } from 'vitest';
import { bidAmountDecimals, bidAmountPattern, checkBidAmount, snapBidAmount } from './bid-amount';

const cents = { min: 1, max: 999.99, step: 0.01 };

describe('checkBidAmount', () => {
  it('takes an amount that sits on the grid', () => {
    expect(checkBidAmount(1, cents)).toEqual({ ok: true, amount: 1 });
    expect(checkBidAmount('1.10', cents)).toEqual({ ok: true, amount: 1.1 });
    expect(checkBidAmount(999.99, cents)).toEqual({ ok: true, amount: 999.99 });
  });

  it('rejects sub-cent precision instead of rounding it onto the grid', () => {
    // The bug this module exists for: 1.099955 used to round to 1.10 and pass,
    // so a 0.01 increment was never actually enforced anywhere.
    const result = checkBidAmount(1.099955, cents);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_STEP');
    expect(checkBidAmount(1.005, cents).ok).toBe(false);
  });

  it('holds a coarser increment to its own grid', () => {
    const quarters = { min: 1, max: 10, step: 0.25 };
    expect(checkBidAmount(1.25, quarters)).toEqual({ ok: true, amount: 1.25 });
    expect(checkBidAmount(1.3, quarters).ok).toBe(false);
    expect(checkBidAmount(2, quarters)).toEqual({ ok: true, amount: 2 });
  });

  it('counts the grid from the minimum, not from zero', () => {
    const offset = { min: 1.03, max: 10, step: 0.5 };
    expect(checkBidAmount(1.53, offset)).toEqual({ ok: true, amount: 1.53 });
    expect(checkBidAmount(1.5, offset).ok).toBe(false);
  });

  it('does not let float drift reject a legal amount', () => {
    const tenths = { min: 0.1, max: 100, step: 0.1 };
    for (const value of [0.3, 0.7, 1.1, 4.2, 8.3, 99.9]) {
      expect(checkBidAmount(value, tenths).ok).toBe(true);
    }
  });

  it('turns away what is not a bid amount at all', () => {
    for (const value of ['', null, undefined, 'abc', NaN, 0, -5, Infinity]) {
      const result = checkBidAmount(value, cents);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.code).toBe('INVALID_AMOUNT');
    }
  });

  it('rejects amounts outside the range before it looks at the step', () => {
    for (const value of [0.5, 1000, 1.005e3]) {
      const result = checkBidAmount(value, cents);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.code).toBe('OUT_OF_RANGE');
    }
  });

  it('names the currency in the range message only when it is given', () => {
    const withCurrency = checkBidAmount(1000, { ...cents, currency: 'ETB' });
    expect(withCurrency.ok === false && withCurrency.message).toBe(
      'Bid amount must be between 1.00 and 999.99 ETB.'
    );
    const without = checkBidAmount(1000, cents);
    expect(without.ok === false && without.message).toBe(
      'Bid amount must be between 1.00 and 999.99.'
    );
  });

  it('falls back to a cent when a stored step is zero', () => {
    expect(checkBidAmount(1.5, { min: 1, max: 10, step: 0 })).toEqual({ ok: true, amount: 1.5 });
    expect(checkBidAmount(1.005, { min: 1, max: 10, step: 0 }).ok).toBe(false);
  });
});

describe('bidAmountDecimals', () => {
  it('reads the precision the increment allows', () => {
    expect(bidAmountDecimals(0.01)).toBe(2);
    expect(bidAmountDecimals(0.25)).toBe(2);
    expect(bidAmountDecimals(0.5)).toBe(1);
    expect(bidAmountDecimals(1)).toBe(0);
    expect(bidAmountDecimals(5)).toBe(0);
  });
});

describe('bidAmountPattern', () => {
  it('accepts a half-typed number but not a digit past the increment', () => {
    const cent = bidAmountPattern(0.01);
    expect(cent.test('1')).toBe(true);
    expect(cent.test('1.')).toBe(true);
    expect(cent.test('1.09')).toBe(true);
    expect(cent.test('1.099')).toBe(false);
    expect(cent.test('1e5')).toBe(false);
    expect(cent.test('-1')).toBe(false);
  });

  it('refuses any decimal at all on a whole-unit increment', () => {
    const whole = bidAmountPattern(1);
    expect(whole.test('12')).toBe(true);
    expect(whole.test('12.')).toBe(false);
    expect(whole.test('12.5')).toBe(false);
  });
});

describe('snapBidAmount', () => {
  it('pulls an off-grid amount back onto the nearest stop', () => {
    expect(snapBidAmount(1.0999, cents)).toBe(1.1);
    expect(snapBidAmount(1.3, { min: 1, max: 10, step: 0.25 })).toBe(1.25);
  });

  it('stays inside the range', () => {
    expect(snapBidAmount(0.2, cents)).toBe(1);
    expect(snapBidAmount(5000, cents)).toBe(999.99);
  });

  it('stops at the last legal stop when the ceiling is not on the grid', () => {
    // 1.00 + k*0.30 never lands on 2.00, so the top stop is 1.90.
    expect(snapBidAmount(2, { min: 1, max: 2, step: 0.3 })).toBe(1.9);
  });

  it('lands somewhere the check accepts', () => {
    const rules = { min: 1.03, max: 50, step: 0.25 };
    for (const value of [0, 1.04, 7.77, 49.99, 120]) {
      expect(checkBidAmount(snapBidAmount(value, rules), rules).ok).toBe(true);
    }
  });
});
