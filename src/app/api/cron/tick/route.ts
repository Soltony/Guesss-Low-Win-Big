import { NextRequest, NextResponse } from 'next/server';
import { runMaintenance } from '@/lib/maintenance';
import { optionalSecret, secretsMatch } from '@/lib/secrets';
import { RATE_LIMITS, consumeRateLimit } from '@/lib/rate-limit';
import { addressKey } from '@/lib/request-context';
import { tooManyRequests } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Scheduled maintenance tick. Point a cron job (or the platform scheduler) at
 * this every minute with the shared secret:
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://host/api/cron/tick
 *
 * The work itself lives in `src/lib/maintenance.ts`, shared with the worker
 * (`npm run run:worker`) and the read paths, so settlement does not depend on
 * this endpoint being scheduled. Every step is idempotent, so a missed or
 * duplicated tick is harmless.
 */
export async function POST(req: NextRequest) {
  // One scheduler calls this. Anything beyond a handful a minute is someone
  // working through candidate secrets, and the limiter is what makes that
  // expensive regardless of how the comparison behaves.
  const limit = consumeRateLimit('cronTick', addressKey(req.headers));
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let secret: string | null;
  try {
    // Rejects an unset value and the `.env.example` placeholder alike: a
    // maintenance endpoint whose secret is a publicly known string is an open
    // endpoint that merely looks guarded.
    secret = optionalSecret('CRON_SECRET', { minLength: 16 });
  } catch (error) {
    console.error('[cron] CRON_SECRET is misconfigured', error);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const provided = req.headers.get('x-cron-secret');

  // Constant time: `!==` returns at the first differing character, so the time
  // taken reveals how many leading characters of a guess were right, and a
  // secret can be recovered one character at a time.
  if (!secretsMatch(secret, provided)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const summary = await runMaintenance('cron');
  return NextResponse.json(summary);
}

export async function GET(req: NextRequest) {
  return POST(req);
}
