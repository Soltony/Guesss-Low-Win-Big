import prisma from './prisma';
import { getSettings } from './settings';
import { isSmsConfigured, sendSms } from './sms';
import { MASKED_AMOUNT } from './format';
import type { Language } from './types';

/**
 * Outbound messaging. Templates live in the DB so operations can reword a
 * message without a deploy; the transport underneath is `sms.ts`.
 */

export const TEMPLATE_CODES = {
  BID_CONFIRMED: 'BID_CONFIRMED',
  BID_FAILED: 'BID_FAILED',
  AUCTION_ENDING: 'AUCTION_ENDING',
  AUCTION_SETTLED: 'AUCTION_SETTLED',
  AUCTION_REAUCTIONED: 'AUCTION_REAUCTIONED',
  REAUCTION_EXCLUDED: 'REAUCTION_EXCLUDED',
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
  /**
   * Values the recipient is entitled to but the delivery log is not. They are
   * rendered into the message that goes out and masked in the row we keep, so
   * a bidder still reads their own bid amount in the SMS while
   * `NotificationLog` — readable by anyone holding `notifications.logs` — never
   * carries the live bid distribution.
   */
  secretVars?: Record<string, string | number>;
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
    const source = lang === 'am' && template.bodyAm ? template.bodyAm : template.bodyEn;

    const secret = input.secretVars ?? {};
    const body = render(source, { ...(input.vars ?? {}), ...secret });
    const loggedBody = Object.keys(secret).length
      ? render(source, {
          ...(input.vars ?? {}),
          ...Object.fromEntries(Object.keys(secret).map((key) => [key, MASKED_AMOUNT])),
        })
      : body;

    const log = await prisma.notificationLog.create({
      data: {
        templateCode: input.code,
        channel: template.channel,
        recipient: input.recipient,
        body: loggedBody,
        status: 'QUEUED',
        bidderId: input.bidderId,
        auctionId: input.auctionId,
      },
    });

    const result = await dispatch(
      template.channel,
      input.recipient,
      body,
      template.subject,
      loggedBody
    );

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
  subject?: string | null,
  /** The masked rendering, for anything written to a log rather than sent. */
  loggedBody: string = body
): Promise<{ ok: boolean; error?: string }> {
  // Without a configured provider we still record the message so the flow is
  // fully exercised and operations can see exactly what would have been sent —
  // masked, because stdout is a log like any other.
  if (!isSmsConfigured()) {
    console.log(`[notifications] (no provider configured) ${channel} → ${recipient}: ${loggedBody}`);
    return { ok: true };
  }

  return sendSms(recipient, body, subject);
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
    code: 'AUCTION_REAUCTIONED',
    name: 'Auction re-auctioned',
    channel: 'SMS',
    bodyEn:
      'GuessLow: auction {code} ({title}) closed with no winner and is being re-run as {newCode}, open until {deadline}. Your {carriedBids} paid bids carry over — you are only charged {fee} {currency} for bids beyond those.',
    bodyAm:
      'GuessLow: ጨረታ {code} ({title}) ያለ አሸናፊ ተዘግቷል፤ በ{newCode} እንደገና ይካሄዳል፣ እስከ {deadline} ክፍት ነው። የከፈሉት {carriedBids} ጨረታዎች ተላልፈዋል — ከዚያ በላይ ለሚያቀርቡት ብቻ {fee} {currency} ይከፍላሉ።',
  },
  {
    code: 'REAUCTION_EXCLUDED',
    name: 'Re-auction closed to previous bidders',
    channel: 'SMS',
    bodyEn:
      'GuessLow: auction {code} ({title}) closed with no winner and is being re-run as {newCode}. This round is open to new bidders only, so no further fee will be charged to you.',
    bodyAm:
      'GuessLow: ጨረታ {code} ({title}) ያለ አሸናፊ ተዘግቷል፤ በ{newCode} እንደገና ይካሄዳል። ይህ ዙር ለአዲስ ተጫራቾች ብቻ ክፍት ነው፣ ስለዚህ ተጨማሪ ክፍያ አይቀነስብዎትም።',
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
