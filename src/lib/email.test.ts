import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeSendError,
  emailSettingsFromEnvironment,
  emailSettingsFromInput,
  insecureSmtpAllowed,
  isEmailAddress,
  normalizeSmtpPassword,
  openSmtpPassword,
  sameSmtpAccount,
  sealSmtpPassword,
  sendEmailWith,
  validateEmailSettings,
  type EmailSettings,
} from './email';
import { resetSecretCache } from './secrets';

const gmail: EmailSettings = {
  enabled: true,
  mode: 'SMTP',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  security: 'STARTTLS',
  allowInvalidCertificate: false,
  username: 'guesslow.mailer@gmail.com',
  fromAddress: 'guesslow.mailer@gmail.com',
  fromName: 'GuessLow',
  replyToAddress: '',
  timeoutSeconds: 30,
  appUrl: 'https://guesslow.example.et',
  pickupDirectory: '',
};

const message = {
  to: 'selam@example.com',
  toName: 'Selam Bekele',
  subject: 'GuessLow test email',
  text: 'Hello Selam Bekele,\n\nThis is a test message.\n',
  html: '<p>Hello Selam Bekele,</p><p>This is a test message.</p>',
};

describe('emailSettingsFromEnvironment', () => {
  it('starts from STARTTLS on 587 and links to the first allowed origin', () => {
    const settings = emailSettingsFromEnvironment({
      SMTP_HOST: ' smtp.office365.com ',
      SMTP_USER: 'ops@example.com',
      EMAIL_FROM: 'ops@example.com',
      ALLOWED_ORIGIN: 'https://guesslow.example.et, https://admin.example.et',
    });

    expect(settings).toMatchObject({
      enabled: true,
      mode: 'SMTP',
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      security: 'STARTTLS',
      username: 'ops@example.com',
      fromName: 'GuessLow',
      appUrl: 'https://guesslow.example.et',
    });
  });

  it('follows the port when no security is named, and honours one that is', () => {
    expect(emailSettingsFromEnvironment({ SMTP_PORT: '465' }).security).toBe('SSL_ON_CONNECT');
    expect(emailSettingsFromEnvironment({ SMTP_PORT: '25', SMTP_SECURITY: 'none' }).security).toBe(
      'NONE'
    );
    expect(emailSettingsFromEnvironment({ SMTP_SECURITY: 'bogus' }).security).toBe('STARTTLS');
  });

  it('falls back to the local console address and to testing mode only when asked', () => {
    const settings = emailSettingsFromEnvironment({ EMAIL_MODE: 'pickup_folder' });
    expect(settings.mode).toBe('PICKUP_FOLDER');
    expect(settings.appUrl).toBe('http://localhost:9003');
  });
});

describe('emailSettingsFromInput', () => {
  it('trims, normalises the enumerations and drops a trailing slash from the console address', () => {
    const settings = emailSettingsFromInput({
      ...gmail,
      mode: 'smtp',
      security: 'ssl_on_connect',
      smtpHost: '  smtp.gmail.com ',
      appUrl: 'https://guesslow.example.et/',
    });

    expect(settings.mode).toBe('SMTP');
    expect(settings.security).toBe('SSL_ON_CONNECT');
    expect(settings.smtpHost).toBe('smtp.gmail.com');
    expect(settings.appUrl).toBe('https://guesslow.example.et');
  });

  it('takes switches only from real booleans', () => {
    expect(emailSettingsFromInput({ ...gmail, enabled: 'true' }).enabled).toBe(false);
    expect(emailSettingsFromInput({ ...gmail, allowInvalidCertificate: 1 }).allowInvalidCertificate).toBe(
      false
    );
  });

  it('survives a body that is not an object', () => {
    expect(() => emailSettingsFromInput(null)).not.toThrow();
    expect(validateEmailSettings(emailSettingsFromInput('nonsense'))).not.toBeNull();
  });
});

describe('isEmailAddress', () => {
  it('accepts what a browser email field accepts', () => {
    expect(isEmailAddress('selam@example.com')).toBe(true);
    expect(isEmailAddress('ops+alerts@mail.example.et')).toBe(true);
    expect(isEmailAddress('mailer@localhost')).toBe(true);
  });

  it('refuses display names, spaces and line breaks', () => {
    expect(isEmailAddress('Selam <selam@example.com>')).toBe(false);
    expect(isEmailAddress('selam @example.com')).toBe(false);
    expect(isEmailAddress('selam@example.com\r\nBcc: everyone@example.com')).toBe(false);
    expect(isEmailAddress('')).toBe(false);
  });
});

describe('validateEmailSettings', () => {
  it('passes a complete Gmail setup', () => {
    expect(validateEmailSettings(gmail)).toBeNull();
  });

  it('explains the first thing that is wrong', () => {
    expect(validateEmailSettings({ ...gmail, fromAddress: 'nobody' })).toMatch(/sender/i);
    expect(validateEmailSettings({ ...gmail, replyToAddress: 'nope' })).toMatch(/reply-to/i);
    expect(validateEmailSettings({ ...gmail, fromName: '' })).toMatch(/sender name/i);
    expect(validateEmailSettings({ ...gmail, fromName: 'GuessLow\r\nBcc: x@y.z' })).toMatch(
      /one line/i
    );
    expect(validateEmailSettings({ ...gmail, appUrl: 'guesslow.example.et' })).toMatch(/absolute/i);
    expect(validateEmailSettings({ ...gmail, appUrl: 'javascript:alert(1)' })).toMatch(/absolute/i);
    expect(validateEmailSettings({ ...gmail, appUrl: 'https://x.et/?next=evil' })).toMatch(/absolute/i);
    expect(validateEmailSettings({ ...gmail, timeoutSeconds: 4 })).toMatch(/timeout/i);
    expect(validateEmailSettings({ ...gmail, timeoutSeconds: 121 })).toMatch(/timeout/i);
    expect(validateEmailSettings({ ...gmail, smtpHost: 'smtp gmail com' })).toMatch(/host/i);
    expect(validateEmailSettings({ ...gmail, smtpHost: '' })).toMatch(/host/i);
    expect(validateEmailSettings({ ...gmail, smtpPort: 0 })).toMatch(/port/i);
    expect(validateEmailSettings({ ...gmail, smtpPort: 70000 })).toMatch(/port/i);
    expect(validateEmailSettings({ ...gmail, security: 'TLS' as never })).toMatch(/security/i);
    expect(validateEmailSettings({ ...gmail, mode: 'SENDMAIL' as never })).toMatch(/mode/i);
  });

  it('accepts an IP address as the server', () => {
    expect(validateEmailSettings({ ...gmail, smtpHost: '10.0.0.25' })).toBeNull();
    expect(validateEmailSettings({ ...gmail, smtpHost: '::1' })).toBeNull();
  });

  it('requires TLS and a verified certificate unless the deployment allows otherwise', () => {
    const plain = { ...gmail, security: 'NONE' as const };
    const unverified = { ...gmail, allowInvalidCertificate: true };

    expect(validateEmailSettings(plain, { allowInsecure: false })).toMatch(
      /Unencrypted SMTP is not allowed.*SMTP_ALLOW_INSECURE/
    );
    expect(validateEmailSettings(unverified, { allowInsecure: false })).toMatch(
      /not allowed on this server.*SMTP_ALLOW_INSECURE/
    );
    expect(validateEmailSettings(plain, { allowInsecure: true })).toBeNull();
    expect(validateEmailSettings(unverified, { allowInsecure: true })).toBeNull();
  });

  it('reads the deployment switch from SMTP_ALLOW_INSECURE alone', () => {
    expect(insecureSmtpAllowed({})).toBe(false);
    expect(insecureSmtpAllowed({ SMTP_ALLOW_INSECURE: 'false' })).toBe(false);
    expect(insecureSmtpAllowed({ SMTP_ALLOW_INSECURE: ' TRUE ' })).toBe(true);
  });

  it('asks for a password only when saving a username without one', () => {
    expect(validateEmailSettings(gmail, { requirePassword: true, passwordAvailable: false })).toBe(
      'Enter the SMTP password.'
    );
    expect(validateEmailSettings(gmail, { requirePassword: true, passwordAvailable: true })).toBeNull();
    expect(
      validateEmailSettings({ ...gmail, username: '' }, { requirePassword: true, passwordAvailable: false })
    ).toBeNull();
  });

  it('skips the server checks in testing mode, but not the folder', () => {
    const folder = { ...gmail, mode: 'PICKUP_FOLDER' as const, smtpHost: '' };
    expect(validateEmailSettings(folder)).toBeNull();
    expect(validateEmailSettings({ ...folder, pickupDirectory: 'relative/mail' })).toMatch(/full path/i);
  });

  it('never saves mail where the web server hands files out', () => {
    const folder = { ...gmail, mode: 'PICKUP_FOLDER' as const };
    expect(
      validateEmailSettings({ ...folder, pickupDirectory: path.join(process.cwd(), 'public') })
    ).toMatch(/public and upload/i);
    expect(
      validateEmailSettings({ ...folder, pickupDirectory: path.join(process.cwd(), 'public', 'uploads', 'mail') })
    ).toMatch(/public and upload/i);
    expect(
      validateEmailSettings({ ...folder, pickupDirectory: path.join(process.cwd(), 'public-mail') })
    ).toBeNull();
  });
});

describe('sameSmtpAccount', () => {
  it('ignores case and spacing, and nothing else', () => {
    expect(sameSmtpAccount(gmail, { smtpHost: ' SMTP.Gmail.com', username: 'GuessLow.Mailer@gmail.com' })).toBe(
      true
    );
    expect(sameSmtpAccount(gmail, { smtpHost: 'smtp.evil.example', username: gmail.username })).toBe(false);
    expect(sameSmtpAccount(gmail, { smtpHost: gmail.smtpHost, username: 'someone@gmail.com' })).toBe(false);
  });
});

describe('normalizeSmtpPassword', () => {
  it('drops the spaces Google prints in an app password', () => {
    expect(normalizeSmtpPassword('abcd efgh ijkl mnop', 'smtp.gmail.com')).toBe('abcdefghijklmnop');
  });

  it('leaves every other server’s password exactly as typed', () => {
    expect(normalizeSmtpPassword('pass phrase ', 'smtp.office365.com')).toBe('pass phrase ');
  });
});

describe('the sealed SMTP password', () => {
  const original = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghij';
    resetSecretCache();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
    resetSecretCache();
  });

  it('round-trips, without the password appearing in the envelope', () => {
    const sealed = sealSmtpPassword('Ab<cd 3f!');
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('Ab<cd');
    expect(openSmtpPassword(sealed)).toBe('Ab<cd 3f!');
  });

  it('seals the same password differently every time', () => {
    expect(sealSmtpPassword('same')).not.toBe(sealSmtpPassword('same'));
  });

  it('cannot be opened once SESSION_SECRET has changed', () => {
    const sealed = sealSmtpPassword('app-password');
    process.env.SESSION_SECRET = 'a-completely-different-session-secret-value';
    resetSecretCache();
    expect(openSmtpPassword(sealed)).toBeNull();
  });

  it('rejects a tampered or malformed envelope instead of guessing', () => {
    const sealed = sealSmtpPassword('app-password');
    const [version, iv, body] = sealed.split('.');
    const flipped = body.slice(0, -2) + (body.endsWith('AA') ? 'AB' : 'AA');
    expect(openSmtpPassword([version, iv, flipped].join('.'))).toBeNull();
    expect(openSmtpPassword('v1.only-two')).toBeNull();
    expect(openSmtpPassword('v2.a.b')).toBeNull();
    expect(openSmtpPassword('')).toBeNull();
  });
});

describe('describeSendError', () => {
  it('turns a rejected Gmail sign-in into the App Password advice', () => {
    const text = describeSendError(
      { code: 'EAUTH', response: '535-5.7.8 Username and Password not accepted.' },
      { host: 'smtp.gmail.com' }
    );
    expect(text).toMatch(/rejected the username or password/);
    expect(text).toMatch(/App Password/);
  });

  it('keeps the Gmail advice to Gmail', () => {
    const text = describeSendError({ code: 'EAUTH', message: 'Invalid login' }, { host: 'mail.example.et' });
    expect(text).toMatch(/rejected the username or password/);
    expect(text).not.toMatch(/Gmail/);
  });

  it('points a certificate failure at the certificate switch', () => {
    const text = describeSendError({ code: 'ESOCKET', message: 'self-signed certificate in certificate chain' });
    expect(text).toMatch(/Accept the server's certificate/);
  });

  it('explains a timeout and passes anything else through on one line', () => {
    expect(describeSendError({ code: 'ETIMEDOUT', message: 'Greeting never received' })).toMatch(
      /did not answer in time/
    );
    expect(describeSendError(new Error('connect ECONNREFUSED 127.0.0.1:2525\n    at stack'))).toBe(
      'The email could not be sent: connect ECONNREFUSED 127.0.0.1:2525'
    );
  });

  it('never repeats the password, even when the server does', () => {
    const text = describeSendError({ message: 'bad credentials hunter2' }, { secret: 'hunter2' });
    expect(text).not.toContain('hunter2');
    expect(text).toContain('[redacted]');
  });
});

describe('sendEmailWith', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('reports invalid or disabled settings instead of trying', async () => {
    expect(await sendEmailWith({ ...gmail, fromAddress: '' }, 'x', message)).toEqual({
      ok: false,
      error: 'Set a valid sender (From) address.',
    });
    expect(await sendEmailWith({ ...gmail, enabled: false }, 'x', message)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/turned off/),
    });
    expect(await sendEmailWith(gmail, null, message)).toEqual({
      ok: false,
      error: 'The SMTP password is not set.',
    });
  });

  describe('in testing mode', () => {
    let folder: string;
    beforeAll(async () => {
      folder = await mkdtemp(path.join(os.tmpdir(), 'guesslow-mail-test-'));
    });
    afterAll(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    it('writes the message to the folder as an .eml file', async () => {
      const result = await sendEmailWith(
        { ...gmail, mode: 'PICKUP_FOLDER', pickupDirectory: folder, replyToAddress: 'help@example.com' },
        null,
        message
      );

      expect(result.ok).toBe(true);
      const files = await readdir(folder);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{8}-\d{6}-[0-9a-f-]{36}\.eml$/);
      expect(result).toEqual({ ok: true, savedTo: path.join(folder, files[0]) });

      const eml = await readFile(path.join(folder, files[0]), 'utf8');
      expect(eml).toContain('Subject: GuessLow test email');
      expect(eml).toMatch(/From: GuessLow <guesslow\.mailer@gmail\.com>/);
      expect(eml).toMatch(/To: Selam Bekele <selam@example\.com>/);
      expect(eml).toMatch(/Reply-To: help@example\.com/);
      expect(eml).toContain('multipart/alternative');
    });
  });

  describe('through an SMTP server', () => {
    // The fake server speaks plain text, which only a deployment that opts in may use.
    const allowInsecure = process.env.SMTP_ALLOW_INSECURE;
    let server: FakeSmtp;
    beforeAll(async () => {
      process.env.SMTP_ALLOW_INSECURE = 'true';
      server = await startFakeSmtp({ user: 'mailer@example.com', pass: 'right-password' });
    });
    afterAll(async () => {
      if (allowInsecure === undefined) delete process.env.SMTP_ALLOW_INSECURE;
      else process.env.SMTP_ALLOW_INSECURE = allowInsecure;
      await server.close();
    });

    const local = (): EmailSettings => ({
      ...gmail,
      smtpHost: '127.0.0.1',
      smtpPort: server.port,
      security: 'NONE',
      username: 'mailer@example.com',
      fromAddress: 'mailer@example.com',
      timeoutSeconds: 5,
    });

    it('signs in and hands the message over', async () => {
      const result = await sendEmailWith(local(), 'right-password', message);

      expect(result).toEqual({ ok: true });
      expect(server.logins).toContain('mailer@example.com:right-password');
      const delivered = server.messages.at(-1) ?? '';
      expect(delivered).toContain('Subject: GuessLow test email');
      expect(delivered).toMatch(/To: Selam Bekele <selam@example\.com>/);
      expect(delivered.replace(/=\r\n/g, '')).toContain('This is a test message.');
    });

    it('never opens a plain-text connection when the deployment has not allowed one', async () => {
      process.env.SMTP_ALLOW_INSECURE = 'false';
      try {
        const before = server.logins.length;
        const result = await sendEmailWith(local(), 'right-password', message);

        expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Unencrypted SMTP/) });
        expect(server.logins).toHaveLength(before);
      } finally {
        process.env.SMTP_ALLOW_INSECURE = 'true';
      }
    });

    it('reports a refused password as one, without throwing', async () => {
      const result = await sendEmailWith(local(), 'wrong-password', message);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/rejected the username or password/);
        expect(result.error).not.toContain('wrong-password');
      }
    });

    it('reports a server that cannot be reached, without throwing', async () => {
      const closedPort = await unusedPort();
      const result = await sendEmailWith({ ...local(), smtpPort: closedPort }, 'right-password', message);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/^The email could not be sent: /);
    }, 20_000);
  });
});

// ----------------------------------------
// A minimal SMTP server: just enough of the protocol for a plain-text
// conversation with AUTH PLAIN, so the real transport can be exercised
// without a network or a mail account.
// ----------------------------------------

interface FakeSmtp {
  port: number;
  logins: string[];
  messages: string[];
  close: () => Promise<void>;
}

function startFakeSmtp(account: { user: string; pass: string }): Promise<FakeSmtp> {
  const logins: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});

    let buffer = '';
    let receivingData = false;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake.smtp ESMTP ready');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (receivingData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          receivingData = false;
          reply('250 2.0.0 Queued');
          continue;
        }

        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.toUpperCase();

        if (command.startsWith('EHLO')) {
          socket.write('250-fake.smtp\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        } else if (command.startsWith('HELO')) {
          reply('250 fake.smtp');
        } else if (command.startsWith('AUTH PLAIN')) {
          const payload = line.split(' ')[2] ?? '';
          const [, user, pass] = Buffer.from(payload, 'base64').toString('utf8').split('\u0000');
          logins.push(`${user}:${pass}`);
          reply(
            user === account.user && pass === account.pass
              ? '235 2.7.0 Authentication successful'
              : '535 5.7.8 Username and Password not accepted'
          );
        } else if (command.startsWith('MAIL FROM') || command.startsWith('RCPT TO')) {
          reply('250 2.1.0 OK');
        } else if (command === 'DATA') {
          receivingData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (command === 'QUIT') {
          reply('221 2.0.0 Bye');
          socket.end();
        } else if (command === 'RSET' || command === 'NOOP') {
          reply('250 2.0.0 OK');
        } else {
          reply('502 5.5.2 Command not implemented');
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        logins,
        messages,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A port nothing is listening on: opened, noted, and closed again. */
function unusedPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
