import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './admin-users';

describe('verifyPassword', () => {
  it('matches the password a hash was made from, and nothing else', async () => {
    const hash = await hashPassword('Kt7$mQz9wRb2Xf!');

    expect(await verifyPassword('Kt7$mQz9wRb2Xf!', hash)).toBe(true);
    expect(await verifyPassword('Kt7$mQz9wRb2Xf?', hash)).toBe(false);
  });

  it('never matches an account that has no password yet', async () => {
    expect(await verifyPassword('', null)).toBe(false);
    expect(await verifyPassword('anything at all', null)).toBe(false);
  });
});
