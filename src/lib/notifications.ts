import prisma from './prisma';
import { getSettings } from './settings';
import type { Language } from './types';

/**
 * Outbound messaging. Templates live in the DB so operations can reword a
 * message without a deploy; the SMS transport is a thin adapter around the
 * provider endpoint configured in the environment.
 */

export const TEMPLATE_CODES = {
  BID_CONFIRMED: 'BID_CONFIRMED',
  BID_FAILED: 'BID_FAILED',
  AUCTION_ENDING: 'AUCTION_ENDING',
  AUCTION_SETTLED: 'AUCTION_SETTLED',
  WINNER_ANNOUNCED: 'WINNER_ANNOUNCED',
  WINNER_REMINDER: 'WINNER_REMINDER',
  PRIZE_FULFILLED: 'PRIZE_FULFILLED',
} as const;

export type TemplateCode = (typeof TEMPLATE_CODES)[keyof typeof TEMPLATE_CODES];

function render(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  );
}

export interface NotifyInput {
  code: TemplateCode;
  recipient: string;
  vars?: Record<string, string | number>;
  language?: Language;
  bidderId?: string;
  auctionId?: string;
}

/** Queues and sends one message. Never throws — messaging must not break a flow. */
export async function notify(input: NotifyInput): Promise<{ sent: boolean; reason?: string }> {
  try {
    const settings = await getSettings();
    if (!settings['notifications.enabled']) return { sent: false, reason: 'Notifications disabled' };

    const template = await prisma.notificationTemplate.findUnique({
      where: { code: input.code },
    });
    if (!template || !template.active) {
      return { sent: false, reason: `Template ${input.code} is missing or inactive` };
    }

    const lang = input.language ?? 'en';
    const body = render(
      lang === 'am' && template.bodyAm ? template.bodyAm : template.bodyEn,
      input.vars ?? {}
    );

    const log = await prisma.notificationLog.create({
      data: {
        templateCode: input.code,
        channel: template.channel,
        recipient: input.recipient,
        body,
        status: 'QUEUED',
        bidderId: input.bidderId,
        auctionId: input.auctionId,
      },
    });

    const result = await dispatch(template.channel, input.recipient, body, template.subject);

    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: result.ok ? 'SENT' : 'FAILED',
        error: result.ok ? null : result.error?.slice(0, 2000),
        sentAt: result.ok ? new Date() : null,
      },
    });

    return { sent: result.ok, reason: result.error };
  } catch (error: any) {
    console.error('[notifications] failed', input.code, error);
    return { sent: false, reason: error?.message };
  }
}

async function dispatch(
  channel: string,
  recipient: string,
  body: string,
  subject?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SMS_API_URL;

  // Without a configured provider we still record the message so the flow is
  // fully exercised and operations can see exactly what would have been sent.
  if (!url) {
    console.log(`[notifications] (no provider configured) ${channel} → ${recipient}: ${body}`);
    return { ok: true };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_API_KEY ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        to: recipient,
        message: body,
        subject,
        from: process.env.SMS_SENDER_ID,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, error: `Provider responded ${response.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Unknown transport error' };
  }
}

export const DEFAULT_TEMPLATES: {
  code: TemplateCode;
  name: string;
  channel: string;
  bodyEn: string;
  bodyAm: string;
}[] = [
  {
    code: 'BID_CONFIRMED',
    name: 'Bid confirmed',
    channel: 'SMS',
    bodyEn:
      'GuessLow: your bid of {amount} {currency} on auction {code} ({title}) is confirmed. Service fee {fee} {currency} paid. Good luck!',
    bodyAm:
      'GuessLow: በጨረታ {code} ({title}) ላይ ያቀረቡት {amount} {currency} ጨረታ ተረጋግጧል። የአገልግሎት ክፍያ {fee} {currency} ተከፍሏል። መልካም ዕድል!',
  },
  {
    code: 'BID_FAILED',
    name: 'Bid payment failed',
    channel: 'SMS',
    bodyEn:
      'GuessLow: we could not confirm the payment for your bid on auction {code}. The bid was not counted and no fee was charged.',
    bodyAm:
      'GuessLow: በጨረታ {code} ላይ ላቀረቡት ጨረታ ክፍያ ማረጋገጥ አልቻልንም። ጨረታው አልተቆጠረም እና ክፍያ አልተቀነሰም።',
  },
  {
    code: 'AUCTION_ENDING',
    name: 'Auction ending soon',
    channel: 'SMS',
    bodyEn: 'GuessLow: auction {code} ({title}) closes in {hours} hours. Place your final bids now.',
    bodyAm: 'GuessLow: ጨረታ {code} ({title}) በ{hours} ሰዓት ውስጥ ይዘጋል። የመጨረሻ ጨረታዎን አሁን ያቅርቡ።',
  },
  {
    code: 'AUCTION_SETTLED',
    name: 'Auction result published',
    channel: 'SMS',
    bodyEn:
      'GuessLow: auction {code} ({title}) has closed. The winning bid was {amount} {currency}. Check the app for your results.',
    bodyAm:
      'GuessLow: ጨረታ {code} ({title}) ተዘግቷል። አሸናፊው ጨረታ {amount} {currency} ነበር። ውጤትዎን በመተግበሪያው ይመልከቱ።',
  },
  {
    code: 'WINNER_ANNOUNCED',
    name: 'Winner announcement',
    channel: 'SMS',
    bodyEn:
      'Congratulations! You won {title} on GuessLow with the lowest unique bid of {amount} {currency}. Claim your prize in the app before {deadline}.',
    bodyAm:
      'እንኳን ደስ አለዎት! በGuessLow {title} በዝቅተኛ ልዩ ጨረታ {amount} {currency} አሸንፈዋል። ሽልማትዎን ከ{deadline} በፊት በመተግበሪያው ይጠይቁ።',
  },
  {
    code: 'WINNER_REMINDER',
    name: 'Claim reminder',
    channel: 'SMS',
    bodyEn:
      'GuessLow: reminder — claim your prize for auction {code} before {deadline} or it will be forfeited.',
    bodyAm: 'GuessLow: ማስታወሻ — ለጨረታ {code} ሽልማትዎን ከ{deadline} በፊት ይጠይቁ አለበለዚያ ይሰረዛል።',
  },
  {
    code: 'PRIZE_FULFILLED',
    name: 'Prize delivered',
    channel: 'SMS',
    bodyEn: 'GuessLow: your prize for auction {code} has been marked as delivered. Enjoy!',
    bodyAm: 'GuessLow: ለጨረታ {code} ያሸነፉት ሽልማት ተሰጥቷል ተብሎ ተመዝግቧል። ደስ ይበልዎት!',
  },
];
