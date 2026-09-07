import { getSettings, type SettingsMap } from './settings';
import { round2 } from './format';

/**
 * Tax on the bid service fee.
 *
 * The tax is *inclusive*: the fee a bidder is quoted — 30.00 Br — is the whole
 * of what leaves their wallet, and the tax is a share carved out of it rather
 * than added on top. Nothing about the charge changes when tax is switched on,
 * so a rate change never silently raises the price of a bid; it only moves the
 * line between what the platform earned and what it owes the revenue authority.
 *
 *     gross 30.00 = net 26.09 + tax 3.91   (15% inclusive)
 *
 * Only the service fee is taxed. The bid amount itself is not money that moves
 * at bid time — it is a guess — and the winning bid is settled outside the
 * platform, so there is nothing here to tax.
 */

export interface TaxConfig {
  enabled: boolean;
  /** Percentage points, e.g. 15 for 15% VAT. */
  rate: number;
  /** What the bidder sees this called — "VAT", "Sales Tax", … */
  label: string;
  /** Account the collected tax is remitted to. Reporting only; see below. */
  accountNo: string;
  /** The platform's tax registration (TIN/VAT) number, shown with the breakdown. */
  registrationNumber: string;
}

export interface TaxBreakdown {
  /** What the bidder actually pays. Unchanged by the tax setting. */
  gross: number;
  /** The platform's share. */
  net: number;
  /** The revenue authority's share, already inside `gross`. */
  tax: number;
  /** The rate this split was made at, snapshotted so history stays readable. */
  rate: number;
}

export function taxConfigFrom(settings: SettingsMap): TaxConfig {
  const rate = Number(settings['tax.rate']);
  return {
    enabled: Boolean(settings['tax.enabled']),
    rate: Number.isFinite(rate) && rate > 0 ? rate : 0,
    label: String(settings['tax.label'] || 'VAT'),
    accountNo: String(settings['tax.accountNo'] || ''),
    registrationNumber: String(settings['tax.registrationNumber'] || ''),
  };
}

export async function getTaxConfig(): Promise<TaxConfig> {
  return taxConfigFrom(await getSettings());
}

/**
 * Splits a gross amount into net and tax.
 *
 * The tax is rounded first and the net is taken as the remainder, never the
 * other way round: rounding both independently loses or invents a cent on
 * roughly a third of amounts, and the sum has to equal the gross exactly or
 * every reconciliation against the gateway statement is off by the drift.
 *
 *     30.00 @ 15%  →  tax 3.91, net 26.09   (3.91 + 26.09 = 30.00 ✓)
 *
 * A zero or negative rate — and a zero gross, which is what a carried-over or
 * pilot-mode bid records — yields no tax at all rather than a rounded zero, so
 * a free bid never appears in the tax ledger.
 */
export function splitInclusiveTax(gross: number, rate: number): TaxBreakdown {
  const amount = round2(gross);
  if (!(amount > 0) || !(rate > 0)) {
    return { gross: amount, net: amount, tax: 0, rate: 0 };
  }
  const tax = round2((amount * rate) / (100 + rate));
  return { gross: amount, net: round2(amount - tax), tax, rate };
}

/** The split for one fee under the current configuration. */
export function applyTax(gross: number, config: TaxConfig): TaxBreakdown {
  if (!config.enabled) return { gross: round2(gross), net: round2(gross), tax: 0, rate: 0 };
  return splitInclusiveTax(gross, config.rate);
}
