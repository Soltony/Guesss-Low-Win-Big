import { NextRequest, NextResponse } from 'next/server';
import { runMaintenance } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';

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
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const summary = await runMaintenance('cron');
  return NextResponse.json(summary);
}

export async function GET(req: NextRequest) {
  return POST(req);
}
