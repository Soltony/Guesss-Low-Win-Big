import { describe, expect, it } from 'vitest';
import {
  activationEmail,
  describeMinutes,
  escapeHtml,
  passwordResetEmail,
  testEmail,
} from './email-templates';

const LINK = 'https://guesslow.example.et/admin/set-password#token=abc123';

const invitation = {
  brand: 'GuessLow',
  fullName: 'Selam Bekele',
  email: 'selam@example.com',
  link: LINK,
  minutes: 1440,
};

describe('escapeHtml', () => {
  it('escapes everything that could open a tag or leave an attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });
});

describe('describeMinutes', () => {
  it('says a lifetime the way a person would', () => {
    expect(describeMinutes(1)).toBe('1 minute');
    expect(describeMinutes(30)).toBe('30 minutes');
    expect(describeMinutes(60)).toBe('1 hour');
    expect(describeMinutes(180)).toBe('3 hours');
    expect(describeMinutes(1440)).toBe('1 day');
    expect(describeMinutes(4320)).toBe('3 days');
    expect(describeMinutes(90)).toBe('90 minutes');
  });
});

describe('activationEmail', () => {
  it('carries the link, the sign-in address and how long the link lasts', () => {
    const email = activationEmail(invitation);

    expect(email.subject).toBe('Activate your GuessLow admin account');
    expect(email.text).toContain('You sign in with this email address, selam@example.com.');
    expect(email.text).toContain(`Activate account: ${LINK}`);
    expect(email.text).toContain('expires in 1 day');
    expect(email.html).toContain(`href="${escapeHtml(LINK)}"`);
  });

  it('carries no password of any kind', () => {
    const email = activationEmail(invitation);
    expect(email.text).not.toMatch(/one-time password|temporary password/i);
    expect(email.text).toMatch(/choose your password/);
  });

  it('escapes every typed value in the HTML', () => {
    const email = activationEmail({
      ...invitation,
      brand: 'Guess<b>Low</b>',
      fullName: '<script>alert(1)</script>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Low</b>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('only turns a web address into a link', () => {
    const email = activationEmail({ ...invitation, link: 'javascript:alert(1)' });
    expect(email.html).not.toContain('href=');
    expect(email.text).not.toContain('javascript:');
  });

  it('greets without a name when there is none', () => {
    expect(activationEmail({ ...invitation, fullName: '  ' }).text.startsWith('Hello,\n')).toBe(true);
  });
});

describe('passwordResetEmail', () => {
  it('tells an account an administrator reset that its old password is gone', () => {
    const email = passwordResetEmail({ ...invitation, minutes: 30, initiatedByAdmin: true });

    expect(email.subject).toBe('Reset your GuessLow password');
    expect(email.text).toMatch(/An administrator has reset your GuessLow password/);
    expect(email.text).toMatch(/previous password no longer works/);
    expect(email.text).toContain('expires in 30 minutes');
    expect(email.text).toContain(`Choose a new password: ${LINK}`);
  });

  it('tells someone who asked that ignoring it changes nothing', () => {
    const email = passwordResetEmail({ ...invitation, minutes: 30, initiatedByAdmin: false });

    expect(email.text).toMatch(/We received a request to reset the GuessLow password for selam@example\.com/);
    expect(email.text).toMatch(/ignore this email; your password stays as it is/);
    expect(email.text).not.toMatch(/no longer works/);
  });
});

describe('testEmail', () => {
  it('names the platform it came from', () => {
    const email = testEmail({ brand: 'GuessLow', fullName: 'Selam Bekele' });

    expect(email.subject).toBe('GuessLow test email');
    expect(email.text).toBe(
      'Hello Selam Bekele,\n\nThis is a test message. Email delivery from GuessLow is working.\n'
    );
  });
});
