import bcrypt from 'bcryptjs';
import { secureRandomInt } from './jwt';

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Passwords that pass the complexity rules while still being among the first
 * few thousand an attacker tries. The list is deliberately small — it catches
 * the patterns people actually reach for when told "add a capital and a symbol"
 * rather than trying to be a full breach corpus.
 */
const COMMON_PASSWORDS = new Set([
  'password1!',
  'password123!',
  'passw0rd!',
  'p@ssw0rd1',
  'p@ssword123',
  'admin@123',
  'admin@1234',
  'welcome@123',
  'welcome1!',
  'qwerty@123',
  'qwerty123!',
  'letmein@123',
  'changeme!1',
  'changeme@123',
  'abcd@1234',
  'test@1234',
  'guesslow@123',
  'january@2026',
  'summer@2026',
]);

/** Rejects `aaaa`, `1234`, `abcd` and keyboard walks of 4 or more. */
function hasTrivialRun(password: string): boolean {
  const lower = password.toLowerCase();
  let ascending = 1;
  let repeated = 1;

  for (let i = 1; i < lower.length; i += 1) {
    const previous = lower.charCodeAt(i - 1);
    const current = lower.charCodeAt(i);

    repeated = current === previous ? repeated + 1 : 1;
    ascending = current === previous + 1 ? ascending + 1 : 1;
    if (repeated >= 4 || ascending >= 4) return true;
  }
  return /qwerty|asdfgh|zxcvbn|123456/.test(lower);
}

/**
 * Password policy for admin accounts. Deliberately strict — these accounts can
 * publish auctions, settle results and move money.
 */
export function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > 128) {
    return { ok: false, error: 'Password must be at most 128 characters.' };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, error: 'Password must include a lowercase letter.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: 'Password must include an uppercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must include a number.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: 'Password must include a symbol.' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, error: 'That password is too common. Choose something less predictable.' };
  }
  if (hasTrivialRun(password)) {
    return {
      ok: false,
      error: 'Password must not contain repeated characters or a keyboard sequence.',
    };
  }
  return { ok: true };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Temporary password issued when an admin creates or resets an account.
 *
 * Every draw comes from the platform CSPRNG. `Math.random()` is seeded from
 * observable state and its output stream can be reconstructed from a handful of
 * samples, so a caller who has seen one issued password could predict the next
 * — and these passwords open admin accounts.
 */
export function generateTempPassword() {
  // A random 14-character draw lands on a repeated pair or a short alphabetical
  // run about once in four thousand, which `validatePassword` then rejects.
  // Resampling is the honest fix: patching the candidate would bias the output,
  // and issuing a credential our own policy refuses is worse than drawing again.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = drawTempPassword();
    if (validatePassword(candidate).ok) return candidate;
  }
  // 100 consecutive rejections is ~10^-360 with the rates above, so reaching
  // here means the policy and the generator have diverged, not bad luck.
  throw new Error(
    'Could not generate a temporary password satisfying the password policy after 100 attempts.'
  );
}

function drawTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  const pick = (set: string) => set[secureRandomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));

  // Fisher-Yates so the guaranteed characters are not always in front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
