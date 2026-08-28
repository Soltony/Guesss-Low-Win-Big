import { describe, expect, it } from 'vitest';
import {
  isEthiopianMobile,
  isValidEthiopianPhone,
  looksLikePhoneNumber,
  normalizePhone,
  parseEthiopianMobile,
} from './format';

describe('normalizePhone', () => {
  it('brings the usual local forms to 251XXXXXXXXX', () => {
    expect(normalizePhone('0912345678')).toBe('251912345678');
    expect(normalizePhone('+251912345678')).toBe('251912345678');
    expect(normalizePhone('251 912 345 678')).toBe('251912345678');
    expect(normalizePhone('912345678')).toBe('251912345678');
  });
});

describe('isValidEthiopianPhone', () => {
  it('holds the country code to exactly nine more digits', () => {
    expect(isValidEthiopianPhone('251912345678')).toBe(true);
    expect(isValidEthiopianPhone('251111234567')).toBe(true);
    expect(isValidEthiopianPhone('25191234567')).toBe(false);
    expect(isValidEthiopianPhone('2519123456789')).toBe(false);
  });
});

describe('isEthiopianMobile', () => {
  it('accepts the 09 and 07 ranges', () => {
    expect(isEthiopianMobile('251912345678')).toBe(true);
    expect(isEthiopianMobile('251712345678')).toBe(true);
  });

  it('rejects landlines, which no SMS can reach', () => {
    expect(isEthiopianMobile('251111234567')).toBe(false);
    expect(isEthiopianMobile('251221234567')).toBe(false);
  });
});

describe('looksLikePhoneNumber', () => {
  it('allows the punctuation people actually type', () => {
    expect(looksLikePhoneNumber('+251 (91) 234-5678')).toBe(true);
    expect(looksLikePhoneNumber('0912345678')).toBe(true);
  });

  it('rejects anything carrying letters', () => {
    expect(looksLikePhoneNumber('0912345678abc')).toBe(false);
    expect(looksLikePhoneNumber('not a number')).toBe(false);
    expect(looksLikePhoneNumber('')).toBe(false);
  });
});

describe('parseEthiopianMobile', () => {
  it('reads the forms an operator would type', () => {
    expect(parseEthiopianMobile('0912345678')).toBe('251912345678');
    expect(parseEthiopianMobile('+251 912 345 678')).toBe('251912345678');
    expect(parseEthiopianMobile('  251712345678  ')).toBe('251712345678');
  });

  it('refuses a number with text on the end rather than stripping it', () => {
    // The reported case: normalizePhone alone discards the letters and leaves a
    // well-formed number, so the entry has to be judged before it is cleaned up.
    expect(normalizePhone('251900000001sdfghjk')).toBe('251900000001');
    expect(parseEthiopianMobile('251900000001sdfghjk')).toBeNull();
    expect(parseEthiopianMobile('0912345678abc')).toBeNull();
  });

  it('refuses anything that is not exactly one Ethiopian mobile number', () => {
    expect(parseEthiopianMobile('25191234')).toBeNull();
    expect(parseEthiopianMobile('251912345678912345')).toBeNull();
    expect(parseEthiopianMobile('0111234567')).toBeNull();
    expect(parseEthiopianMobile('')).toBeNull();
  });
});
