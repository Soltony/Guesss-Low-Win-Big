import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createBidderSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import { clientMeta, jsonError } from '@/lib/api';
import { normalizePhone } from '@/lib/format';
import { getSettings } from '@/lib/settings';
import { TEST_PHONE_PREFIX, isTestLoginEnabled } from '@/lib/test-login';

export const dynamic = 'force-dynamic';

/**
 * Opens a mini-app session without a super-app token, for testing.
 * Refuses outright unless ALLOW_TEST_LOGIN=true.
 */
export async function POST(req: NextRequest) {
  if (!isTestLoginEnabled()) {
    return jsonError('Test sign-in is not enabled on this environment.', 403);
  }

  const meta = clientMeta(req);
  const body = await req.json().catch(() => ({}));

  const rawPhone = String(body?.phone || '').trim();
  const requestedName = String(body?.fullName || '').trim();

  // A blank phone number gets a generated test identity, so QA can open a
  // fresh bidder in one click.
  const phoneNumber = rawPhone
    ? normalizePhone(rawPhone)
    : `${TEST_PHONE_PREFIX}${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;

  if (phoneNumber.length < 9) {
    return jsonError('Enter a valid phone number, or leave it blank for a random one.', 400);
  }

  const settings = await getSettings();
  const existing = await prisma.bidder.findUnique({ where: { phoneNumber } });

  const bidder = existing
    ? await prisma.bidder.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      })
    : await prisma.bidder.create({
        data: {
          phoneNumber,
          fullName: requestedName || `Test bidder ${phoneNumber.slice(-4)}`,
          language: String(settings['platform.defaultLanguage'] || 'en'),
          status: 'ACTIVE',
        },
      });

  if (bidder.status === 'BLOCKED') {
    return jsonError('This account is blocked and cannot be used for testing.', 403);
  }

  await createBidderSession({
    bidderId: bidder.id,
    phone: bidder.phoneNumber,
    // No wallet token exists for a bypassed session; bidding detects this and
    // never calls the payment gateway.
    superAppToken: '',
    isTest: true,
  });

  await createAuditLog({
    actorId: bidder.phoneNumber,
    actorType: 'BIDDER',
    action: 'BIDDER_TEST_SESSION_STARTED',
    entity: 'Bidder',
    entityId: bidder.id,
    details: { bypass: true, isNew: !existing },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({
    bidderId: bidder.id,
    phone: bidder.phoneNumber,
    isNew: !existing,
    isTest: true,
  });
}

/** Lets the connect screen decide whether to offer the bypass at all. */
export async function GET() {
  return NextResponse.json({ enabled: isTestLoginEnabled() });
}
