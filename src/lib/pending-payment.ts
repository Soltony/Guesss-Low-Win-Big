'use client';

/**
 * The fee collection currently in flight, held outside React.
 *
 * Handing the payment token to the super app takes the screen away from us:
 * the host raises its own PIN sheet, and on at least some builds it reloads or
 * renavigates the webview underneath while doing it. Anything kept in
 * component state — which sheet was open, which auction was being bid on, that
 * a payment is even happening — is gone by the time the bidder is looking at
 * the keypad, and the mini app boots back to the home page as though nothing
 * had been started.
 *
 * So the wait is written down instead. `localStorage` rather than
 * `sessionStorage`: a host that destroys the webview and builds a new one
 * starts a fresh session, and the whole point is to survive that. The record
 * is small, expires on its own, and is cleared the moment the payment settles.
 */

export interface PendingPayment {
  bidId: string;
  /** The bid the fee is being charged for, so the wait can name it. */
  amount: number;
  fee: number;
  currency: string;
  auctionTitle: string;
  /** Epoch ms. A record older than the poll window is abandoned, not resumed. */
  startedAt: number;
}

export interface PaymentOutcome {
  bidId: string;
  settled: 'confirmed' | 'failed';
  /** What the ledger stored, once there is a confirmed bid. */
  amount: number | null;
  message: string | null;
}

const KEY = 'guesslow.pending-payment';
const STARTED_EVENT = 'guesslow:payment-started';
const ABORTED_EVENT = 'guesslow:payment-aborted';
const OUTCOME_EVENT = 'guesslow:payment-outcome';

/**
 * How long a written-down wait stays resumable.
 *
 * Matched to the poll window: past it the watcher would have given up anyway,
 * so resuming would only raise a failure screen over a bidder who has long
 * since moved on. Stale records are dropped on sight instead.
 */
export const PENDING_MAX_AGE_MS = 120_000;

/** Storage throws outright in some webview privacy modes; never let it bubble. */
function write(value: PendingPayment | null) {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  } catch {
    // The wait degrades to component state, which is what it was before.
  }
}

/**
 * The payment in flight, or null.
 *
 * Anything unparseable, malformed or expired is treated as absent *and*
 * cleared: a record that cannot be acted on must never be left behind to be
 * re-read on the next boot.
 */
export function readPendingPayment(): PendingPayment | null {
  if (typeof window === 'undefined') return null;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingPayment;
    if (!parsed?.bidId || typeof parsed.startedAt !== 'number') {
      write(null);
      return null;
    }
    if (Date.now() - parsed.startedAt > PENDING_MAX_AGE_MS) {
      write(null);
      return null;
    }
    return parsed;
  } catch {
    write(null);
    return null;
  }
}

/**
 * Opens the wait: writes it down and tells this document about it.
 *
 * Called immediately before the token goes over the JS channel, so the waiting
 * screen is already up when the host's PIN sheet appears over it.
 */
export function startPendingPayment(payment: Omit<PendingPayment, 'startedAt'>): PendingPayment {
  const record: PendingPayment = { ...payment, startedAt: Date.now() };
  write(record);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<PendingPayment>(STARTED_EVENT, { detail: record }));
  }
  return record;
}

/**
 * Ends the wait before it began — the token never reached the wallet, so there
 * is nothing in flight and nothing to keep waiting for.
 */
export function abortPendingPayment(bidId: string, message: string) {
  write(null);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PaymentOutcome>(ABORTED_EVENT, {
      detail: { bidId, settled: 'failed', amount: null, message },
    })
  );
}

export function clearPendingPayment() {
  write(null);
}

/** Announces a settled payment to whatever is still mounted to hear it. */
export function publishPaymentOutcome(outcome: PaymentOutcome) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PaymentOutcome>(OUTCOME_EVENT, { detail: outcome }));
}

function listen<T>(event: string, handler: (detail: T) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapped = (raw: Event) => handler((raw as CustomEvent<T>).detail);
  window.addEventListener(event, wrapped);
  return () => window.removeEventListener(event, wrapped);
}

export const subscribePaymentStarted = (handler: (payment: PendingPayment) => void) =>
  listen<PendingPayment>(STARTED_EVENT, handler);

export const subscribePaymentAborted = (handler: (outcome: PaymentOutcome) => void) =>
  listen<PaymentOutcome>(ABORTED_EVENT, handler);

export const subscribePaymentOutcome = (handler: (outcome: PaymentOutcome) => void) =>
  listen<PaymentOutcome>(OUTCOME_EVENT, handler);

/**
 * Waits for the browser to actually draw.
 *
 * A React state update only schedules a render; the commit and the paint come
 * after the current task. Posting the payment token in that same task hands
 * the screen to the host before a single frame of the waiting page exists,
 * which is exactly the bug this guards. Two frames covers React's commit plus
 * the paint that follows it, and the timeout is there because a webview that
 * stops animating must not strand the hand-off entirely.
 */
export function nextPaint(timeoutMs = 250): Promise<void> {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(finish, 0)));
    setTimeout(finish, timeoutMs);
  });
}
