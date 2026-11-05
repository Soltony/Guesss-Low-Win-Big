import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createTransport, type SendMailOptions } from 'nodemailer';
import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { normalizeOrigin } from './request-context';
import { requireSecret } from './secrets';

/**
 * Outgoing email: the mail-server settings kept under Users → Email, and the
 * one transport that sends with them.
 *
 * The settings live in the database rather than the environment, so a mail
 * server can be set up, tested and corrected from the console without a
 * redeploy. Until somebody saves them, the `SMTP_*` and `EMAIL_*` variables
 * supply the starting values. They are two `SystemSetting` rows kept outside
 * the registry in settings.ts — the generic Settings page has no business
 * rendering a password field — one holding the configuration as JSON and one
 * holding the SMTP password, sealed.
 *
 * The password goes in and does not come back out: the admin screen learns
 * only whether one is stored, and it is opened solely to sign in to the mail
 * server it was entered for.
 */

export const EMAIL_DELIVERY_MODES = ['SMTP', 'PICKUP_FOLDER'] as const;
/**
 * `PICKUP_FOLDER` is for testing: each message is written as an .eml file to a
 * folder on the server instead of being sent.
 */
export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];

/**
 * How the connection to the mail server is protected.
 *
 *   STARTTLS        plain connection upgraded with STARTTLS (port 587: Gmail,
 *                   Office 365). The upgrade is required, never optional — a
 *                   server that does not offer it is refused, not used in clear.
 *   SSL_ON_CONNECT  TLS from the first byte (port 465).
 *   NONE            no encryption: an internal relay on a trusted network only.
 */
export const SMTP_SECURITY_MODES = ['STARTTLS', 'SSL_ON_CONNECT', 'NONE'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY_MODES)[number];

export interface EmailSettings {
  enabled: boolean;
  mode: EmailDeliveryMode;
  smtpHost: string;
  smtpPort: number;
  security: SmtpSecurity;
  /**
   * Accept the server's certificate without verifying it — self-signed, or
   * issued for another name. Traffic stays encrypted; it is the server's
   * identity that goes unchecked.
   */
  allowInvalidCertificate: boolean;
  username: string;
  fromAddress: string;
  /** Also the platform name the emails introduce themselves with. */
  fromName: string;
  replyToAddress: string;
  timeoutSeconds: number;
  /** The admin console as recipients reach it: the base of every link in an email. */
  appUrl: string;
  /** Folder for `PICKUP_FOLDER` mode. Empty means `guesslow-mail` in the system temp folder. */
  pickupDirectory: string;
}

/** Whether a password is stored, and whether this server can still open it. */
export type SmtpPasswordState = 'NOT_SET' | 'SET' | 'UNREADABLE';

/** Longer than any real mail password: a ceiling against abuse, not a policy. */
export const MAX_SMTP_PASSWORD_LENGTH = 256;

const DEFAULT_FROM_NAME = 'GuessLow';
const DEFAULT_TIMEOUT_SECONDS = 30;

const CONFIG_KEY = 'email.config';
const PASSWORD_KEY = 'email.smtpPassword';

// ----------------------------------------
// Settings
// ----------------------------------------

function isDeliveryMode(value: string): value is EmailDeliveryMode {
  return (EMAIL_DELIVERY_MODES as readonly string[]).includes(value);
}

function isSmtpSecurity(value: string): value is SmtpSecurity {
  return (SMTP_SECURITY_MODES as readonly string[]).includes(value);
}

/**
 * Whether this deployment permits the two weaker connection options: no
 * encryption, and a certificate accepted without being verified. They exist
 * for an internal mail server that needs them, and choosing them is for
 * whoever runs the server, not for an admin session — so they stay refused
 * unless SMTP_ALLOW_INSECURE is set, and a hijacked Super Admin session
 * cannot quietly downgrade the channel account activation and reset links
 * travel over.
 */
export function insecureSmtpAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.SMTP_ALLOW_INSECURE?.trim().toLowerCase() === 'true';
}

/**
 * The starting values, read from the environment and used until somebody saves
 * settings from the console. A deployment can be configured entirely this way
 * and never open the screen.
 */
export function emailSettingsFromEnvironment(
  env: Record<string, string | undefined> = process.env
): EmailSettings {
  const port = Number(env.SMTP_PORT) || 587;
  const security = String(env.SMTP_SECURITY ?? '').trim().toUpperCase();

  return {
    enabled: true,
    mode: String(env.EMAIL_MODE ?? '').trim().toUpperCase() === 'PICKUP_FOLDER' ? 'PICKUP_FOLDER' : 'SMTP',
    smtpHost: env.SMTP_HOST?.trim() ?? '',
    smtpPort: port,
    security: isSmtpSecurity(security) ? security : port === 465 ? 'SSL_ON_CONNECT' : 'STARTTLS',
    allowInvalidCertificate: env.SMTP_ALLOW_INVALID_CERTIFICATE?.trim().toLowerCase() === 'true',
    username: env.SMTP_USER?.trim() ?? '',
    fromAddress: env.EMAIL_FROM?.trim() ?? '',
    fromName: env.EMAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
    replyToAddress: env.EMAIL_REPLY_TO?.trim() ?? '',
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    // The front end's own origin is the one address every recipient can reach.
    appUrl: normalizeOrigin(env.ALLOWED_ORIGIN?.split(',')[0]?.trim()) ?? 'http://localhost:9003',
    pickupDirectory: env.EMAIL_PICKUP_DIR?.trim() ?? '',
  };
}

/**
 * Settings as the admin form sends them, trimmed and typed. Nothing is
 * defaulted or clamped here: `validateEmailSettings` refuses a bad value with a
 * reason, where a silent correction would hide it.
 */
export function emailSettingsFromInput(input: unknown): EmailSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (key: keyof EmailSettings) =>
    typeof source[key] === 'string' ? (source[key] as string).trim() : '';

  return {
    enabled: source.enabled === true,
    // Both unions are checked by validateEmailSettings before anything uses them.
    mode: (text('mode').toUpperCase() || 'SMTP') as EmailDeliveryMode,
    smtpHost: text('smtpHost'),
    smtpPort: Number(source.smtpPort),
    security: (text('security').toUpperCase() || 'STARTTLS') as SmtpSecurity,
    allowInvalidCertificate: source.allowInvalidCertificate === true,
    username: text('username'),
    fromAddress: text('fromAddress'),
    fromName: text('fromName'),
    replyToAddress: text('replyToAddress'),
    timeoutSeconds: Number(source.timeoutSeconds),
    appUrl: text('appUrl').replace(/\/+$/, ''),
    pickupDirectory: text('pickupDirectory'),
  };
}

/**
 * The rule a browser applies to `<input type="email">`, so the form and the
 * server never disagree about an address. It also rules out the line breaks a
 * header injection needs.
 */
const EMAIL_ADDRESS =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_ADDRESS.test(value);
}

/** A line break in a header value is how a header gets injected. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const HOST_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const HOST_NAME = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);

function isHostName(value: string): boolean {
  return value.length > 0 && value.length <= 253 && (HOST_NAME.test(value) || isIP(value) !== 0);
}

function isAppUrl(value: string): boolean {
  if (!value || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** True when `child` is `parent` or anywhere beneath it. */
function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/*
 * The `turbopackIgnore` comments below are load-bearing. Every path in this
 * module is decided at runtime, but the build cannot know that: left
 * unmarked, it reads `process.cwd()` and a computed `path.resolve` as
 * references to files and traces all of `public/` and `src/lib/` into every
 * route that sends email.
 */

/**
 * Folders the web server hands files out from: `public/`, and the upload
 * folder when UPLOAD_DIR moves it elsewhere. Resolved here rather than through
 * uploads.ts, whose default path would drag that folder into the build trace.
 */
function servedFolders(): string[] {
  const folders = [path.join(/* turbopackIgnore: true */ process.cwd(), 'public')];
  const uploads = process.env.UPLOAD_DIR?.trim();
  if (uploads) folders.push(path.resolve(/* turbopackIgnore: true */ uploads));
  return folders;
}

function pickupDirectoryProblem(folder: string): string | null {
  if (!folder) return null;
  if (folder.length > 260 || CONTROL_CHARACTERS.test(folder)) return 'The folder path is not valid.';
  if (!path.isAbsolute(folder)) {
    return 'Enter the full path of the folder, e.g. C:\\guesslow-mail or /var/guesslow/mail.';
  }
  // Every message in this mode is a file anyone who can fetch it can read, so
  // never a folder the web server hands out.
  const resolved = path.resolve(/* turbopackIgnore: true */ folder);
  if (servedFolders().some((served) => isWithin(resolved, served))) {
    return "Choose a folder outside the app's public and upload folders: files saved there can be downloaded.";
  }
  return null;
}

/** Where `PICKUP_FOLDER` mode writes, with the default filled in. */
export function resolvedPickupDirectory(settings: Pick<EmailSettings, 'pickupDirectory'>): string {
  return settings.pickupDirectory
    ? path.resolve(/* turbopackIgnore: true */ settings.pickupDirectory)
    : path.join(/* turbopackIgnore: true */ os.tmpdir(), 'guesslow-mail');
}

/**
 * What is wrong with these settings, as a sentence for the person fixing them,
 * or null when they are complete. `requirePassword` is for saving: a username
 * without a password would otherwise only fail at the first send.
 */
export function validateEmailSettings(
  s: EmailSettings,
  options: { requirePassword?: boolean; passwordAvailable?: boolean; allowInsecure?: boolean } = {}
): string | null {
  const allowInsecure = options.allowInsecure ?? insecureSmtpAllowed();
  if (!isEmailAddress(s.fromAddress)) return 'Set a valid sender (From) address.';
  if (s.replyToAddress && !isEmailAddress(s.replyToAddress)) {
    return 'The reply-to address is not valid.';
  }
  if (!s.fromName || s.fromName.length > 100 || CONTROL_CHARACTERS.test(s.fromName)) {
    return 'Set a sender name of at most 100 characters, on one line.';
  }
  if (!isAppUrl(s.appUrl)) {
    return 'The admin console address must be an absolute http(s) address, e.g. https://guesslow.example.et.';
  }
  if (!Number.isInteger(s.timeoutSeconds) || s.timeoutSeconds < 5 || s.timeoutSeconds > 120) {
    return 'Timeout must be between 5 and 120 seconds.';
  }
  if (!isDeliveryMode(s.mode)) return 'Unknown delivery mode.';
  if (s.mode === 'PICKUP_FOLDER') return pickupDirectoryProblem(s.pickupDirectory);

  if (!isHostName(s.smtpHost)) return 'Set a valid SMTP server host name.';
  if (!Number.isInteger(s.smtpPort) || s.smtpPort < 1 || s.smtpPort > 65535) {
    return 'SMTP port must be between 1 and 65535.';
  }
  if (!isSmtpSecurity(s.security)) return 'Unknown connection security option.';
  if (s.security === 'NONE' && !allowInsecure) {
    return (
      'Unencrypted SMTP is not allowed on this server. Use STARTTLS or SSL/TLS, or set ' +
      'SMTP_ALLOW_INSECURE=true in the environment for an internal relay.'
    );
  }
  if (s.allowInvalidCertificate && !allowInsecure) {
    return (
      "Accepting the server's certificate without checking it is not allowed on this server. " +
      'Set SMTP_ALLOW_INSECURE=true in the environment if an internal mail server needs it.'
    );
  }
  if (s.username.length > 256 || CONTROL_CHARACTERS.test(s.username)) {
    return 'The SMTP username is not valid.';
  }
  if (options.requirePassword && s.username && !options.passwordAvailable) {
    return 'Enter the SMTP password.';
  }
  return null;
}

/**
 * Whether two configurations sign in to the same mailbox. A stored password is
 * bound to the server and account it was entered for: change either and it
 * has to be entered again, so it is never handed to a host it was not meant
 * for.
 */
export function sameSmtpAccount(
  a: Pick<EmailSettings, 'smtpHost' | 'username'>,
  b: Pick<EmailSettings, 'smtpHost' | 'username'>
): boolean {
  return (
    a.smtpHost.trim().toLowerCase() === b.smtpHost.trim().toLowerCase() &&
    a.username.trim().toLowerCase() === b.username.trim().toLowerCase()
  );
}

/** One line for the audit trail. Never includes the password. */
export function describeEmailSettings(s: EmailSettings): string {
  const state = s.enabled ? 'on' : 'off';
  if (s.mode === 'PICKUP_FOLDER') {
    return `[${state}] folder ${resolvedPickupDirectory(s)}, from ${s.fromAddress}`;
  }
  const certificate = s.allowInvalidCertificate ? ', certificate not verified' : '';
  return (
    `[${state}] ${s.username || 'anonymous'}@${s.smtpHost}:${s.smtpPort} (${s.security}${certificate}), ` +
    `from ${s.fromAddress}, links to ${s.appUrl}`
  );
}

/**
 * Google shows an app password in four groups — `abcd efgh ijkl mnop` — and
 * people paste it that way. The spaces are presentation, not part of it.
 */
export function normalizeSmtpPassword(password: string, host: string): string {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(host.trim()) ? password.replace(/\s+/g, '') : password;
}

// ----------------------------------------
// The sealed password
// ----------------------------------------

const PASSWORD_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PASSWORD_AAD = Buffer.from('guesslow:email:smtp-password', 'utf8');

/**
 * Derived from SESSION_SECRET rather than configured separately: one more
 * required secret is one more thing a deployment can get wrong, and HKDF keeps
 * the derived key independent of the signing key it comes from. Rotating
 * SESSION_SECRET therefore makes a saved password unreadable — the screen says
 * so and asks for it again, which is the whole of the recovery.
 */
function passwordKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', requireSecret('SESSION_SECRET'), Buffer.alloc(0), 'guesslow/email/smtp-password/v1', 32)
  );
}

/** AES-256-GCM, as `v1.<iv>.<ciphertext‖tag>` in base64url. */
export function sealSmtpPassword(password: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', passwordKey(), iv);
  cipher.setAAD(PASSWORD_AAD);
  const body = Buffer.concat([cipher.update(password, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return [PASSWORD_VERSION, iv.toString('base64url'), body.toString('base64url')].join('.');
}

/** The password, or null when the envelope is malformed or was sealed under another key. */
export function openSmtpPassword(envelope: string): string | null {
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== PASSWORD_VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const body = Buffer.from(parts[2], 'base64url');
    if (iv.length !== IV_BYTES || body.length < TAG_BYTES) return null;

    const decipher = createDecipheriv('aes-256-gcm', passwordKey(), iv);
    decipher.setAAD(PASSWORD_AAD);
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

// ----------------------------------------
// Storage
// ----------------------------------------

/** The saved settings, field by field over the environment defaults. */
export async function getEmailSettings(): Promise<EmailSettings> {
  const defaults = emailSettingsFromEnvironment();
  const row = await prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } });
  if (!row) return defaults;

  try {
    const saved = JSON.parse(row.value) as Record<string, unknown>;
    // Merged per field, so a document saved before a field existed picks up
    // that field's default instead of leaving it undefined.
    const merged = { ...defaults } as unknown as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(defaults)) {
      if (saved && typeof saved[key] === typeof fallback) merged[key] = saved[key];
    }
    return merged as unknown as EmailSettings;
  } catch {
    // An unreadable document falls back to the environment rather than
    // breaking every send.
    return defaults;
  }
}

export interface StoredSmtpPassword {
  password: string | null;
  state: SmtpPasswordState;
  /** The password in use is `SMTP_PASSWORD` from the environment, not one saved here. */
  fromEnvironment: boolean;
}

export async function getSmtpPassword(): Promise<StoredSmtpPassword> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PASSWORD_KEY } });

  let sealed = '';
  if (row) {
    try {
      const value = JSON.parse(row.value);
      sealed = typeof value === 'string' ? value : '';
    } catch {
      sealed = row.value;
    }
  }

  if (!sealed) {
    const configured = process.env.SMTP_PASSWORD ?? '';
    return configured.trim()
      ? { password: configured, state: 'SET', fromEnvironment: true }
      : { password: null, state: 'NOT_SET', fromEnvironment: false };
  }

  const password = openSmtpPassword(sealed);
  return password === null
    ? { password: null, state: 'UNREADABLE', fromEnvironment: false }
    : { password, state: 'SET', fromEnvironment: false };
}

/**
 * Saves the settings. `password`: null keeps the stored one, '' removes it,
 * anything else replaces it. One transaction, so settings and the password
 * they were validated against are never half applied.
 */
export async function saveEmailSettings(
  settings: EmailSettings,
  password: string | null,
  updatedById: string
) {
  const upsert = (key: string, value: string, description: string) =>
    prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, description, category: 'email', updatedById },
      update: { value, updatedById },
    });

  const writes: Prisma.PrismaPromise<unknown>[] = [
    upsert(CONFIG_KEY, JSON.stringify(settings), 'Email delivery settings (Users → Email).'),
  ];
  if (password === '') {
    writes.push(prisma.systemSetting.deleteMany({ where: { key: PASSWORD_KEY } }));
  } else if (password !== null) {
    writes.push(
      upsert(
        PASSWORD_KEY,
        JSON.stringify(sealSmtpPassword(password)),
        'SMTP password, sealed with AES-256-GCM.'
      )
    );
  }
  await prisma.$transaction(writes);
}

/** Everything the admin screen shows. The password itself is never part of it. */
export interface EmailSettingsView {
  settings: EmailSettings;
  passwordState: SmtpPasswordState;
  passwordFromEnvironment: boolean;
  /** SMTP_ALLOW_INSECURE: whether the unencrypted and unverified options may be chosen at all. */
  insecureAllowed: boolean;
  resolvedPickupDirectory: string;
  /** What stops email going out as configured, or null when nothing does. */
  problem: string | null;
}

export async function getEmailSettingsView(): Promise<EmailSettingsView> {
  const [settings, stored] = await Promise.all([getEmailSettings(), getSmtpPassword()]);
  return {
    settings,
    passwordState: stored.state,
    passwordFromEnvironment: stored.fromEnvironment,
    insecureAllowed: insecureSmtpAllowed(),
    resolvedPickupDirectory: resolvedPickupDirectory(settings),
    problem: validateEmailSettings(settings, {
      requirePassword: true,
      passwordAvailable: stored.state === 'SET',
    }),
  };
}

// ----------------------------------------
// Sending
// ----------------------------------------

export interface OutgoingEmail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailSendResult =
  | { ok: true; /** The file written, in `PICKUP_FOLDER` mode. */ savedTo?: string }
  | { ok: false; error: string };

function firstLine(value: unknown): string {
  return String(value ?? '').split(/\r?\n/)[0].trim().slice(0, 300);
}

/**
 * A failed send as a sentence an administrator can act on. The password is
 * stripped out, in case a server ever echoes it back.
 */
export function describeSendError(
  error: unknown,
  context: { host?: string; secret?: string | null } = {}
): string {
  const failure = (error ?? {}) as { code?: string; message?: string; response?: string };
  const detail = firstLine(failure.response || failure.message || error) || 'unknown error';
  const isGmail = /(^|\.)(gmail|googlemail)\.com$/i.test(context.host?.trim() ?? '');

  let text: string;
  if (
    failure.code === 'EAUTH' ||
    /5\.7\.8|Username and Password not accepted/i.test(`${failure.response ?? ''} ${failure.message ?? ''}`)
  ) {
    text =
      `The mail server rejected the username or password (${detail}).` +
      (isGmail ? ' For Gmail, use a 16-character App Password, not the normal account password.' : '');
  } else if (/certificate|self[- ]signed|altnames/i.test(detail)) {
    text =
      `The mail server's certificate could not be verified (${detail}). If this is an internal server ` +
      `with its own certificate, turn on "Accept the server's certificate without checking it".`;
  } else if (failure.code === 'ETIMEDOUT') {
    text =
      `The mail server did not answer in time (${detail}). Check the host name and port, and that ` +
      `this server is allowed to reach it.`;
  } else {
    text = `The email could not be sent: ${detail}`;
  }

  return context.secret ? text.split(context.secret).join('[redacted]') : text;
}

function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '');
}

/**
 * Sends one message with the saved settings. The message is rendered from
 * them, since it needs their sender name and console address. Never throws.
 */
export async function sendWithSavedSettings(
  render: (settings: EmailSettings) => OutgoingEmail
): Promise<EmailSendResult> {
  try {
    const [settings, stored] = await Promise.all([getEmailSettings(), getSmtpPassword()]);
    if (stored.state === 'UNREADABLE' && settings.mode === 'SMTP' && settings.username) {
      return {
        ok: false,
        error: "The saved SMTP password can't be read on this server. Re-enter it under Users → Email.",
      };
    }
    return await sendEmailWith(settings, stored.password, render(settings));
  } catch (error) {
    console.error('[email] could not load the mail settings', error);
    return { ok: false, error: 'The mail settings could not be loaded.' };
  }
}

/**
 * Sends one message with explicit settings — the admin screen's test uses this
 * to try values before they are saved. Never throws.
 */
export async function sendEmailWith(
  settings: EmailSettings,
  password: string | null,
  message: OutgoingEmail
): Promise<EmailSendResult> {
  const problem = validateEmailSettings(settings);
  if (problem) return { ok: false, error: problem };
  if (!settings.enabled) return { ok: false, error: 'Email sending is turned off (Users → Email).' };

  const mail: SendMailOptions = {
    from: { name: settings.fromName, address: settings.fromAddress },
    to: message.toName ? { name: message.toName, address: message.to } : message.to,
    replyTo: settings.replyToAddress || undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  // Every body here is a string we rendered. Nothing should ever make the
  // mailer read a file or fetch a URL to build a message.
  const sandbox = { disableFileAccess: true, disableUrlAccess: true };

  try {
    if (settings.mode === 'PICKUP_FOLDER') {
      const transport = createTransport({ streamTransport: true, buffer: true, newline: 'windows', ...sandbox });
      const info = await transport.sendMail(mail);
      const folder = resolvedPickupDirectory(settings);
      await mkdir(/* turbopackIgnore: true */ folder, { recursive: true });
      const file = path.join(/* turbopackIgnore: true */ folder, `${timestamp()}-${randomUUID()}.eml`);
      await writeFile(/* turbopackIgnore: true */ file, info.message as Buffer);
      return { ok: true, savedTo: file };
    }

    if (settings.username && !password) return { ok: false, error: 'The SMTP password is not set.' };

    const timeout = settings.timeoutSeconds * 1000;
    const transport = createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.security === 'SSL_ON_CONNECT',
      requireTLS: settings.security === 'STARTTLS',
      ignoreTLS: settings.security === 'NONE',
      auth:
        settings.username && password
          ? { user: settings.username, pass: normalizeSmtpPassword(password, settings.smtpHost) }
          : undefined,
      tls: settings.allowInvalidCertificate ? { rejectUnauthorized: false } : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      ...sandbox,
    });
    try {
      await transport.sendMail(mail);
    } finally {
      transport.close();
    }
    return { ok: true };
  } catch (error) {
    // Connection, TLS, protocol, timeout or file errors: reported to the
    // caller, never thrown through the request that asked for the email.
    const description = describeSendError(error, { host: settings.smtpHost, secret: password });
    console.warn(`[email] "${message.subject}" to ${message.to} was not sent: ${description}`);
    return { ok: false, error: description };
  }
}
