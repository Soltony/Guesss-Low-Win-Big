'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PaymentStatusPage, type PaymentStatus } from './payment-status-page';
import {
  clearPendingPayment,
  publishPaymentOutcome,
  readPendingPayment,
  subscribePaymentAborted,
  subscribePaymentStarted,
  type PendingPayment,
} from '@/lib/pending-payment';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

/**
 * How long a reported failure is held behind the waiting screen before it is
 * shown as one.
 *
 * The gateway marks the charge failed the moment its own attempt gives up, but
 * that verdict is not always the last word: the callback for an approval the
 * bidder had already given can land seconds later, and a retry inside the
 * wallet can settle the same charge after the first attempt was written off.
 * Flipping straight to "payment failed" tells a bidder their bid is gone while
 * the fee is still moving — so the poll keeps running through this window, and
 * a late confirmation still wins. Only silence for the whole window is failure.
 */
const FAILURE_GRACE_MS = 15_000;

const GENERIC_FAILURE = 'The payment was not completed, so this bid was not counted.';

/**
 * Watches the fee collection the super app is running, from anywhere in the app.
 *
 * This sits in the shell rather than in the bid form on purpose. The form lives
 * inside a bottom sheet, and the wait has to outlive it: the sheet closes, the
 * bidder is carried off to the host's PIN keypad, and on some builds the
 * webview is reloaded out from under all of it. A watcher mounted once at the
 * top survives every one of those, and picks a wait back up on boot from what
 * `pending-payment` wrote down — so a reload lands on the waiting screen
 * rather than on the home page with the payment apparently forgotten.
 */
export function PaymentWatcher() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('waiting');
  const [message, setMessage] = useState<string | null>(null);
  /** What the ledger stored, which is what the success screen reads back. */
  const [confirmedAmount, setConfirmedAmount] = useState<number | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A failure the gateway has reported, held back for `FAILURE_GRACE_MS`.
   *
   * Set means "failing unless something better arrives": the waiting screen
   * stays up and the poll keeps running until the grace timer resolves it.
   */
  const heldFailure = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  /** Drops a held failure — something better than it has arrived. */
  const dropHeldFailure = useCallback(() => {
    if (graceTimer.current) {
      clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
    heldFailure.current = null;
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    []
  );

  const watch = useCallback(
    (payment: PendingPayment) => {
      stopPolling();
      dropHeldFailure();

      setPending(payment);
      setStatus('waiting');
      setMessage(null);
      setConfirmedAmount(null);

      const settle = (
        next: PaymentStatus,
        outcome: { amount: number | null; message: string | null }
      ) => {
        stopPolling();
        // Settled either way, so nothing is left to resume: a reload from here
        // must land on the app, not back on this screen.
        clearPendingPayment();
        setStatus(next);
        setMessage(outcome.message);
        setConfirmedAmount(outcome.amount);
        publishPaymentOutcome({
          bidId: payment.bidId,
          settled: next === 'success' ? 'confirmed' : 'failed',
          amount: outcome.amount,
          message: outcome.message,
        });
      };

      /**
       * Takes a reported failure and starts the grace window, leaving the
       * waiting screen up. The poll deliberately keeps running underneath: a
       * confirmation arriving before the window closes overrides this.
       */
      const holdFailure = (reason: string) => {
        // The first verdict is the one that gets shown; a second tick
        // reporting the same failure must not restart the window.
        if (heldFailure.current) return;
        heldFailure.current = reason;

        graceTimer.current = setTimeout(() => {
          graceTimer.current = null;
          const held = heldFailure.current;
          heldFailure.current = null;
          settle('failed', { amount: null, message: held });
        }, FAILURE_GRACE_MS);
      };

      pollTimer.current = setInterval(async () => {
        // Measured from when the payment was started, not from when this
        // interval was created, so a wait resumed after a reload gets what is
        // left of the original window rather than a fresh two minutes.
        if (Date.now() - payment.startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          // A held failure is already on its way to the screen with a reason of
          // its own; letting the timeout speak over it would both cut the grace
          // window short and replace the gateway's account with a vaguer one.
          if (heldFailure.current) return;
          settle('failed', {
            amount: null,
            message:
              'Still waiting on the payment confirmation. Check My Bids shortly — if the fee was taken, your bid will be there.',
          });
          return;
        }

        try {
          const response = await fetch(`/api/miniapp/bids/${payment.bidId}/status`, {
            cache: 'no-store',
          });
          if (!response.ok) return;
          const data = await response.json();

          if (data.status === 'ACTIVE') {
            // A late confirmation beats a failure still inside its grace
            // window — this is the case that window exists for.
            dropHeldFailure();
            settle('success', {
              // What the ledger holds, not what was typed — the server rounds
              // to two places before it stores the bid.
              amount: typeof data.amount === 'number' ? data.amount : payment.amount,
              message: null,
            });
            router.refresh();
          } else if (data.status === 'FAILED' || data.status === 'VOID') {
            holdFailure(data.voidReason || data.payment?.failureReason || GENERIC_FAILURE);
          }
        } catch {
          // Transient blip inside the webview; the next tick retries.
        }
      }, POLL_INTERVAL_MS);
    },
    [router, stopPolling, dropHeldFailure]
  );

  // A wait already under way when this mounted — the webview was reloaded
  // while the host had the screen. Picked up where it left off.
  useEffect(() => {
    const resumed = readPendingPayment();
    if (resumed) watch(resumed);
  }, [watch]);

  useEffect(() => subscribePaymentStarted(watch), [watch]);

  // The token never reached the wallet, so no charge exists to wait on and the
  // grace window would only stall a verdict that is already final.
  useEffect(
    () =>
      subscribePaymentAborted((outcome) => {
        stopPolling();
        dropHeldFailure();
        setStatus('failed');
        setMessage(outcome.message);
        setConfirmedAmount(null);
      }),
    [stopPolling, dropHeldFailure]
  );

  if (!pending) return null;

  return (
    <PaymentStatusPage
      open
      status={status}
      amount={status === 'success' ? confirmedAmount : pending.amount}
      fee={pending.fee}
      currency={pending.currency}
      auctionTitle={pending.auctionTitle}
      message={message}
      onDone={() => setPending(null)}
    />
  );
}
