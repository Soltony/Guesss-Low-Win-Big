/**
 * GuessLow maintenance worker.
 *
 *   npm run run:worker
 *
 * Runs the same pass as `POST /api/cron/tick` on an interval, in its own
 * process. Use it where there is no platform scheduler to point at the endpoint
 * — a plain `next start` box, a Windows service, a docker sidecar.
 *
 * `WORKER_INTERVAL_SECONDS` overrides the cadence (default 60). Running this
 * alongside an external cron is safe: every step of the pass is idempotent.
 */

import 'dotenv/config';
import { runMaintenance, type MaintenanceSummary } from '@/lib/maintenance';

const intervalMs = Math.max(10, Number(process.env.WORKER_INTERVAL_SECONDS) || 60) * 1000;

let running = false;
let stopping = false;
let timer: NodeJS.Timeout | undefined;

function stamp() {
  return new Date().toISOString();
}

function report(summary: MaintenanceSummary) {
  const changed =
    summary.startedLive ||
    summary.ended ||
    summary.expiredBids ||
    summary.settled ||
    summary.winnersNotified ||
    summary.endingSoonNotified;

  // A quiet pass is the normal case; logging every one would drown the ones
  // that mattered.
  if (!changed) return;

  console.log(
    `[worker] ${stamp()} live=${summary.startedLive} ended=${summary.ended} ` +
      `voided=${summary.expiredBids} settled=${summary.settled} ` +
      `reauctions=${summary.reauctionsCreated} pending=${summary.reauctionsPending} ` +
      `winnerSms=${summary.winnersNotified} endingSms=${summary.endingSoonNotified} ` +
      `(${summary.durationMs}ms)`
  );
}

async function tick() {
  // A pass that overruns the interval must not overlap the next one.
  if (running || stopping) return;
  running = true;
  try {
    report(await runMaintenance('worker'));
  } catch (error) {
    // Never exit on a failed pass — a transient database blip must not take
    // settlement offline until someone notices the process died.
    console.error(`[worker] ${stamp()} pass failed`, error);
  } finally {
    running = false;
  }
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${stamp()} ${signal} received, stopping.`);
  if (timer) clearInterval(timer);
  // Let an in-flight pass finish its transaction rather than cutting it off.
  const wait = setInterval(() => {
    if (!running) {
      clearInterval(wait);
      process.exit(0);
    }
  }, 200);
  wait.unref();
}

console.log(`[worker] ${stamp()} started, every ${intervalMs / 1000}s.`);
void tick();
timer = setInterval(() => void tick(), intervalMs);

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
