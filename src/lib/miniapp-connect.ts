import prisma from './prisma';
import { createBidderSession } from './session';
import { createAuditLog } from './audit-log';
import { normalizePhone } from './format';
import { PaymentError, validateSuperAppToken } from './payment-gateway';
import { getSettings } from './settings';

export class MiniAppConnectError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ConnectResult {
  bidderId: string;
  phone: string;
  isNew: boolean;
  status: string;
}

/**
 * Exchanges a super-app token for a HowLow bidder session.
 *
 * The super app is the identity provider: it hands us a token, the token
 * service resolves it to a phone number, and that phone number is the bidder.
 * A first-time phone is provisioned automatically — there is no signup form.
 */
export async function connectMiniAppSession(
  superAppToken: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<ConnectResult> {
  const header = superAppToken?.startsWith('Bearer ')
    ? superAppToken
    : `Bearer ${superAppToken ?? ''}`;

  let phone: string;
  try {
    ({ phone } = await validateSuperAppToken(header));
  } catch (error) {
    if (error instanceof PaymentError) throw new MiniAppConnectError(error.status, error.message);
    throw error;
  }

  const rawToken = header.slice(7);
  const phoneNumber = normalizePhone(phone) || phone;
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
          language: String(settings['platform.defaultLanguage'] || 'en'),
          status: 'ACTIVE',
        },
      });

  if (bidder.status === 'BLOCKED') {
    throw new MiniAppConnectError(
      403,
      'Your account is blocked from using HowLow. Please contact support.'
    );
  }

  await createBidderSession({
    bidderId: bidder.id,
    phone: bidder.phoneNumber,
    superAppToken: rawToken,
  });

  await createAuditLog({
    actorId: bidder.phoneNumber,
    actorType: 'BIDDER',
    action: existing ? 'BIDDER_SESSION_STARTED' : 'BIDDER_REGISTERED',
    entity: 'Bidder',
    entityId: bidder.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    bidderId: bidder.id,
    phone: bidder.phoneNumber,
    isNew: !existing,
    status: bidder.status,
  };
}
