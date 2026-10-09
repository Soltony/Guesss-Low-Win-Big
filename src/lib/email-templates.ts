/**
 * The emails this application sends.
 *
 * Each is rendered twice — plain text and HTML — from the same parts, so the
 * two versions can never say different things. Every value is escaped on its
 * way into the HTML: names, the brand and addresses are all text somebody
 * typed, and an email client is one more place markup would otherwise run.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** The console's primary colour (`--primary` in globals.css), with the same black text on it. */
const BRAND_COLOUR = '#e7b008';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

interface Layout {
  brand: string;
  subject: string;
  fullName: string;
  paragraphs: string[];
  button?: { text: string; url: string };
  footer?: string;
}

function render(layout: Layout): RenderedEmail {
  const name = layout.fullName.trim();
  const greeting = name ? `Hello ${name},` : 'Hello,';
  // Only a web address becomes a link: anything else stays out of the href.
  const button = layout.button && /^https?:\/\//i.test(layout.button.url) ? layout.button : undefined;

  const text =
    [
      greeting,
      ...layout.paragraphs,
      ...(button ? [`${button.text}: ${button.url}`] : []),
      ...(layout.footer ? [layout.footer] : []),
    ].join('\n\n') + '\n';

  const e = escapeHtml;
  const muted = 'font-size:12px;color:#64748b';
  const html = [
    '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;line-height:1.5">',
    `<div style="font-size:20px;font-weight:700;margin:24px 0">${e(layout.brand)}</div>`,
    `<p>${e(greeting)}</p>`,
    ...layout.paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`),
    button
      ? `<p style="margin:28px 0"><a href="${e(button.url)}" style="background:${BRAND_COLOUR};color:#000;` +
        `padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">${e(button.text)}</a></p>` +
        `<p style="${muted}">If the button doesn't work, copy this address into your browser:<br>${e(button.url)}</p>`
      : '',
    layout.footer ? `<p style="${muted}">${e(layout.footer)}</p>` : '',
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: layout.subject, text, html };
}

/** Sent from Users → Email to prove the settings work. */
export function testEmail(input: { brand: string; fullName: string }): RenderedEmail {
  return render({
    brand: input.brand,
    subject: `${input.brand} test email`,
    fullName: input.fullName,
    paragraphs: [`This is a test message. Email delivery from ${input.brand} is working.`],
  });
}

/** A link lifetime as a person would say it: "30 minutes", "1 hour", "3 days". */
export function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

interface LinkEmail {
  brand: string;
  fullName: string;
  /** The address the account signs in with — the one this email goes to. */
  email: string;
  link: string;
  /** How long the link stays usable. */
  minutes: number;
}

/**
 * The invitation for a new admin account. Nobody chooses the password for its
 * holder: they set it themselves through the link.
 */
export function activationEmail(input: LinkEmail): RenderedEmail {
  return render({
    brand: input.brand,
    subject: `Activate your ${input.brand} admin account`,
    fullName: input.fullName,
    paragraphs: [
      `An admin account has been created for you on ${input.brand}. You sign in with this email address, ${input.email}.`,
      'To activate it, open the link below and choose your password. The link works once and expires in ' +
        `${describeMinutes(input.minutes)}.`,
    ],
    button: { text: 'Activate account', url: input.link },
    footer:
      "If you weren't expecting this, you can ignore it and the account stays inactive. Never forward this " +
      'email: whoever opens the link chooses the password.',
  });
}

/**
 * A link to choose a new password — after an administrator's reset, which has
 * already stopped the old one working, or at the holder's own request from the
 * sign-in page, which has not.
 */
export function passwordResetEmail(input: LinkEmail & { initiatedByAdmin: boolean }): RenderedEmail {
  return render({
    brand: input.brand,
    subject: `Reset your ${input.brand} password`,
    fullName: input.fullName,
    paragraphs: [
      input.initiatedByAdmin
        ? `An administrator has reset your ${input.brand} password. Your previous password no longer works, ` +
          'and you have been signed out everywhere.'
        : `We received a request to reset the ${input.brand} password for ${input.email}.`,
      'Open the link below to choose a new password. The link works once and expires in ' +
        `${describeMinutes(input.minutes)}.`,
    ],
    button: { text: 'Choose a new password', url: input.link },
    footer: input.initiatedByAdmin
      ? 'If you have questions, contact your administrator. Never forward this email: whoever opens the link ' +
        'chooses the password.'
      : "If you didn't ask for this, ignore this email; your password stays as it is.",
  });
}
