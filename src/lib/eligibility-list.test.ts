import { describe, expect, it } from 'vitest';
import {
  isValidParticipantPhone,
  parseDelimitedText,
  parseParticipantText,
  withoutExisting,
} from './eligibility-list';

describe('isValidParticipantPhone', () => {
  it('accepts a normalised Ethiopian number', () => {
    expect(isValidParticipantPhone('251912345678')).toBe(true);
  });

  it('rejects a number that is too short or too long', () => {
    expect(isValidParticipantPhone('25191234')).toBe(false);
    expect(isValidParticipantPhone('2519123456789')).toBe(false);
  });
});

describe('parseDelimitedText', () => {
  it('keeps a quoted comma inside one cell', () => {
    expect(parseDelimitedText('"Doe, John",0912345678')).toEqual([
      ['Doe, John', '0912345678'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseDelimitedText('"say ""hi""",0912345678')).toEqual([
      ['say "hi"', '0912345678'],
    ]);
  });

  it('treats CRLF as a single row break', () => {
    expect(parseDelimitedText('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('detects tab-separated input', () => {
    expect(parseDelimitedText('0912345678\tAbebe')).toEqual([['0912345678', 'Abebe']]);
  });
});

describe('parseParticipantText', () => {
  it('reads a bare column of numbers', () => {
    const result = parseParticipantText('0912345678\n0911223344\n');

    expect(result.headerDetected).toBe(false);
    expect(result.entries.map((entry) => entry.phoneNumber)).toEqual([
      '251912345678',
      '251911223344',
    ]);
  });

  it('normalises the three ways the same number gets written', () => {
    const result = parseParticipantText('0912345678\n+251912345678\n251912345678');

    // All three are one person, so two of them are duplicates.
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].phoneNumber).toBe('251912345678');
    expect(result.duplicates).toBe(2);
  });

  it('reads named columns from a header row in any order', () => {
    const result = parseParticipantText(
      ['Note,Full Name,Mobile', 'Gold tier,Abebe Bekele,0912345678'].join('\n')
    );

    expect(result.headerDetected).toBe(true);
    expect(result.entries).toEqual([
      { phoneNumber: '251912345678', fullName: 'Abebe Bekele', note: 'Gold tier' },
    ]);
  });

  it('assumes phone,name,note when there is no header', () => {
    const result = parseParticipantText('0912345678,Abebe Bekele,Gold tier');

    expect(result.entries[0]).toEqual({
      phoneNumber: '251912345678',
      fullName: 'Abebe Bekele',
      note: 'Gold tier',
    });
  });

  it('reports unusable rows with their line number instead of dropping them silently', () => {
    const result = parseParticipantText(
      ['phone,name', '0912345678,Abebe', 'N/A,Broken row', '0912,Truncated'].join('\n')
    );

    expect(result.entries).toHaveLength(1);
    expect(result.rejected.map((row) => row.line)).toEqual([3, 4]);
  });

  it('skips blank lines without counting them as errors', () => {
    const result = parseParticipantText('0912345678\n\n\n0911223344\n');

    expect(result.entries).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('ignores a leading byte-order mark on the header', () => {
    const result = parseParticipantText('﻿phone,name\n0912345678,Abebe');

    expect(result.headerDetected).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it('leaves a name with a comma in it intact', () => {
    const result = parseParticipantText('phone,name\n0912345678,"Bekele, Abebe"');

    expect(result.entries[0].fullName).toBe('Bekele, Abebe');
  });
});

describe('withoutExisting', () => {
  it('separates numbers already on the list from new ones', () => {
    const entries = [
      { phoneNumber: '251912345678', fullName: null, note: null },
      { phoneNumber: '251911223344', fullName: null, note: null },
    ];

    const { fresh, skipped } = withoutExisting(entries, new Set(['251912345678']));

    expect(skipped).toBe(1);
    expect(fresh.map((entry) => entry.phoneNumber)).toEqual(['251911223344']);
  });
});
