import { describe, expect, it } from 'vitest';
import { applyTax, splitInclusiveTax, taxConfigFrom, type TaxConfig } from './tax';

const config = (over: Partial<TaxConfig> = {}): TaxConfig => ({
  enabled: true,
  rate: 15,
  label: 'VAT',
  accountNo: '1000123456789',
  registrationNumber: '',
  ...over,
});

describe('splitInclusiveTax', () => {
  it('carves the tax out of the fee rather than adding it on top', () => {
    const split = splitInclusiveTax(30, 15);
    expect(split.gross).toBe(30);
    expect(split.tax).toBe(3.91);
    expect(split.net).toBe(26.09);
  });

  it('never changes what the bidder pays', () => {
    for (const rate of [5, 7.5, 15, 20, 33.33]) {
      expect(splitInclusiveTax(30, rate).gross).toBe(30);
    }
  });

  // The whole reason the tax is rounded first and the net taken as the
  // remainder. Rounding both independently drops or invents a cent on a large
  // share of amounts, and every one of those would be a reconciliation break
  // against the gateway statement.
  it('always splits back to exactly the gross', () => {
    for (let cents = 1; cents <= 20_000; cents += 1) {
      const gross = cents / 100;
      for (const rate of [5, 7.5, 15, 18, 20]) {
        const { net, tax } = splitInclusiveTax(gross, rate);
        expect(Math.round((net + tax) * 100)).toBe(cents);
      }
    }
  });

  it('rounds to whole cents on both sides', () => {
    const { net, tax } = splitInclusiveTax(19.99, 15);
    expect(Number.isInteger(Math.round(tax * 100))).toBe(true);
    expect(tax).toBe(2.61);
    expect(net).toBe(17.38);
  });

  it('taxes nothing when there is no fee to tax', () => {
    // A carried-over bid, or one placed in pilot mode: a zero fee must not
    // reach the tax ledger as a rounded zero at a live rate.
    expect(splitInclusiveTax(0, 15)).toEqual({ gross: 0, net: 0, tax: 0, rate: 0 });
  });

  it('taxes nothing at a zero or negative rate', () => {
    expect(splitInclusiveTax(30, 0)).toEqual({ gross: 30, net: 30, tax: 0, rate: 0 });
    expect(splitInclusiveTax(30, -5)).toEqual({ gross: 30, net: 30, tax: 0, rate: 0 });
  });
});

describe('applyTax', () => {
  it('leaves the fee whole while tax is switched off', () => {
    expect(applyTax(30, config({ enabled: false }))).toEqual({
      gross: 30,
      net: 30,
      tax: 0,
      rate: 0,
    });
  });

  it('reports the rate it split at, so the bid can snapshot it', () => {
    expect(applyTax(30, config({ rate: 7.5 })).rate).toBe(7.5);
  });
});

describe('taxConfigFrom', () => {
  it('reads the settings map', () => {
    expect(
      taxConfigFrom({
        'tax.enabled': true,
        'tax.rate': 15,
        'tax.label': 'VAT',
        'tax.accountNo': '1000123456789',
        'tax.registrationNumber': '0012345678',
      })
    ).toEqual({
      enabled: true,
      rate: 15,
      label: 'VAT',
      accountNo: '1000123456789',
      registrationNumber: '0012345678',
    });
  });

  it('falls back to a usable shape when keys are missing or unset', () => {
    const resolved = taxConfigFrom({});
    expect(resolved.enabled).toBe(false);
    expect(resolved.rate).toBe(0);
    expect(resolved.label).toBe('VAT');
    expect(resolved.accountNo).toBe('');
  });

  // A rate that arrives as a string — which is what a hand-edited setting row
  // coerces to — must still split correctly rather than yield NaN cents.
  it('coerces a numeric rate stored as text', () => {
    expect(taxConfigFrom({ 'tax.enabled': true, 'tax.rate': '15' }).rate).toBe(15);
  });
});
