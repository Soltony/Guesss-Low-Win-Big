/**
 * The SMS transport: one adapter around the provider endpoint configured in the
 * environment, with no templates, no database and no logging of its own.
 *
 * `notifications.ts` layers templating and the delivery log on top of this for
 * ordinary bidder messaging. Anything whose body must not be written down —
 * one-time passwords above all — calls `sendSms` directly instead.
 */
export interface SmsResult {
  ok: boolean;
  error?: string;
}

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMS_API_URL);
}

/**
 * Posts one message to the provider. Unlike the notification pipeline this
 * reports a missing provider as a failure rather than quietly succeeding: a
 * caller that is delivering a credential has to know the message did not go
 * out, so it can fall back to something a human can act on.
 */
export async function sendSms(
  recipient: string,
  body: string,
  subject?: string | null
): Promise<SmsResult> {
  const url = process.env.SMS_API_URL;
  if (!url) return { ok: false, error: 'No SMS provider is configured (SMS_API_URL is unset).' };

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
