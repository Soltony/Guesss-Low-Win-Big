/**
 * The one place that decides whether a typed amount is a legal bid.
 *
 * Both halves of the app import this: the mini app rejects the amount before
 * the bidder is walked through terms and a wallet approval, and `bidding.ts`
 * rejects it again on the way in. Sharing the module is what keeps the two
 * answers identical — a bid the field accepts must never be one the server
 * turns away, and the wording the bidder reads is the same either way.
 *
 * Deliberately free of server imports so it can ship in the browser bundle.
 */

/** Money here never runs finer than a cent, so every rule is decided in cents. */
const MINOR = 100;

/**
 * Float multiplication leaves 999.99 as 99998.99999999999; a whole-cent value
 * can miss its integer by roughly 1e-11 at these magnitudes. Anything further
 * out than this was genuinely typed with sub-cent precision.
 */
const MINOR_TOLERANCE = 1e-6;

export type BidAmountCode = 'INVALID_AMOUNT' | 'OUT_OF_RANGE' | 'INVALID_STEP';

export interface BidAmountRules {
  min: number;
  max: number;
  step: number;
  /** Appended to the range message when known; the field omits it. */
  currency?: string;
}

export type BidAmountCheck =
  { ok: true; amount: number } | { ok: false; code: BidAmountCode; message: string };

/** Cents, guarding against a legacy row whose step never made it past zero. */
function stepMinor(step: number) {
  const minor = Math.round(step * MINOR);
  return minor > 0 ? minor : 1;
}

/**
 * How many decimals the step allows: 0.01 permits two, 0.50 one, 5 none. The
 * field uses it to refuse the keystroke that would add a digit too many.
 */
export function bidAmountDecimals(step: number) {
  const minor = stepMinor(step);
  if (minor % MINOR === 0) return 0;
  if (minor % 10 === 0) return 1;
  return 2;
}

/** Matches what may be *typed* so far — a half-finished "1." still passes. */
export function bidAmountPattern(step: number) {
  const decimals = bidAmountDecimals(step);
  return decimals === 0 ? /^\d*$/ : new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`);
}

/**
 * Checks a typed amount against an auction's range and increment.
 *
 * The amount is never rounded into shape. Rounding first would make the
 * increment unenforceable at the only setting that matters — with a step of
 * 0.01, every sub-cent amount rounds onto the grid and nothing is ever
 * rejected — and it would quietly enter a bidder into the auction at an amount
 * they did not type, which in a lowest-unique-bid game is the whole game.
 */
export function checkBidAmount(raw: unknown, rules: BidAmountRules): BidAmountCheck {
  const amount = typeof raw === 'number' ? raw : Number(raw);
  const { min, max } = rules;
  const step = stepMinor(rules.step) / MINOR;

  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'Enter a valid bid amount.' };
  }

  if (amount < min || amount > max) {
    const currency = rules.currency ? ` ${rules.currency}` : '';
    return {
      ok: false,
      code: 'OUT_OF_RANGE',
      message: `Bid amount must be between ${min.toFixed(2)} and ${max.toFixed(2)}${currency}.`,
    };
  }

  const offGrid = () => ({
    ok: false as const,
    code: 'INVALID_STEP' as const,
    message: `Bid amount must be in increments of ${step.toFixed(2)} starting from ${min.toFixed(2)}.`,
  });

  // Sub-cent precision is off the grid by definition — the coarsest step this
  // module recognises is a single cent.
  const exact = amount * MINOR;
  if (Math.abs(exact - Math.round(exact)) > MINOR_TOLERANCE) return offGrid();

  // Compared in whole cents so 0.1 + 0.2 style drift cannot reject a valid bid.
  const offset = Math.round(exact) - Math.round(min * MINOR);
  if (offset % stepMinor(rules.step) !== 0) return offGrid();

  return { ok: true, amount: Math.round(exact) / MINOR };
}

/**
 * The nearest legal amount to `value`, for the −/+ buttons. Stepping from an
 * amount that is already off the grid lands back on it rather than carrying
 * the offset along.
 */
export function snapBidAmount(value: number, rules: BidAmountRules) {
  const grid = stepMinor(rules.step);
  const minMinor = Math.round(rules.min * MINOR);
  const maxMinor = Math.max(minMinor, Math.round(rules.max * MINOR));

  const clamped = Math.min(maxMinor, Math.max(minMinor, Math.round(value * MINOR)));
  const steps = Math.round((clamped - minMinor) / grid);
  // Snapping up could overshoot the ceiling when the range is not a whole
  // number of steps, so the last stop below it is the highest legal amount.
  const ceiling = Math.floor((maxMinor - minMinor) / grid);
  return (minMinor + Math.max(0, Math.min(steps, ceiling)) * grid) / MINOR;
}
