import { isValidEthiopianPhone, normalizePhone } from './format';
import { containsMarkup } from './plain-text';

/**
 * Parsing for uploaded participant lists.
 *
 * Deliberately free of any database or Node import, so the same parser runs in
 * a unit test, in the upload route and — if it is ever wanted — in the browser
 * for a client-side preview. `eligibility.ts` holds everything that touches
 * Prisma.
 *
 * The input is whatever an operator has to hand: a one-number-per-line text
 * file, a CSV exported from a spreadsheet, or a sheet of an Excel workbook.
 * All three arrive here as rows of cells.
 */

export interface ParticipantEntry {
  /** Normalised to 251XXXXXXXXX, the form `Bidder.phoneNumber` is stored in. */
  phoneNumber: string;
  fullName: string | null;
  note: string | null;
}

export interface RejectedRow {
  /** 1-based row number in the uploaded file, so the operator can find it. */
  line: number;
  value: string;
  reason: string;
}

export interface ParsedList {
  entries: ParticipantEntry[];
  rejected: RejectedRow[];
  /** Rows dropped because the same number already appeared earlier in the file. */
  duplicates: number;
  /** A header row was recognised and skipped. */
  headerDetected: boolean;
}

/** Cells the phone column may be titled, lowercased and stripped of spaces. */
const PHONE_HEADERS = [
  'phone',
  'phonenumber',
  'phoneno',
  'mobile',
  'mobilenumber',
  'msisdn',
  'number',
  'tel',
  'telephone',
  'contact',
  'ስልክ',
];
const NAME_HEADERS = ['name', 'fullname', 'customer', 'customername', 'bidder', 'ስም'];
const NOTE_HEADERS = ['note', 'notes', 'remark', 'remarks', 'comment', 'reference', 'ref'];

const MAX_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 200;

/**
 * A phone number we could actually match a bidder against: 251 plus nine
 * digits. Anything shorter is a truncated cell, and anything longer is two
 * numbers that ran together — either way it would silently never match, so it
 * is reported back to the operator instead.
 */
export function isValidParticipantPhone(normalized: string): boolean {
  return isValidEthiopianPhone(normalized);
}

const normalizeHeader = (cell: string) => cell.toLowerCase().replace(/[\s_-]/g, '');

/**
 * Splits delimited text into rows of cells.
 *
 * Handles the quoting Excel emits (`"Doe, John",0912...`) including doubled
 * quotes inside a quoted cell, because a name with a comma in it would
 * otherwise shift every following column by one and put a surname where the
 * phone number should be.
 */
export function parseDelimitedText(text: string): string[][] {
  // A leading BOM would attach itself to the first header cell and stop it
  // matching "phone".
  const input = text.replace(/^﻿/, '');
  // Tab-separated pastes are common enough (copying straight out of Excel) to
  // be worth detecting rather than mangling into a single column.
  const delimiter = pickDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // CRLF is one break, not two.
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function pickDelimiter(input: string): string {
  const sample = input.slice(0, 4000);
  const counts: Record<string, number> = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length,
  };
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

/** Column positions for phone / name / note, from a recognised header row. */
function readHeader(cells: string[]): { phone: number; name: number; note: number } | null {
  const headers = cells.map((cell) => normalizeHeader(cell.trim()));
  const phone = headers.findIndex((header) => PHONE_HEADERS.includes(header));
  if (phone === -1) return null;

  return {
    phone,
    name: headers.findIndex((header) => NAME_HEADERS.includes(header)),
    note: headers.findIndex((header) => NOTE_HEADERS.includes(header)),
  };
}

const trim = (value: unknown) => String(value ?? '').trim();

/**
 * Turns rows of cells into participant entries.
 *
 * With a header row the columns are read by name; without one the layout is
 * assumed to be phone, name, note — which also covers the commonest case of
 * all, a file that is nothing but a column of numbers.
 */
export function rowsToEntries(rows: string[][]): ParsedList {
  const entries: ParticipantEntry[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const firstNonEmpty = rows.findIndex((row) => row.some((cell) => trim(cell) !== ''));
  const header = firstNonEmpty === -1 ? null : readHeader(rows[firstNonEmpty]);
  const columns = header ?? { phone: 0, name: 1, note: 2 };

  rows.forEach((row, index) => {
    if (header && index === firstNonEmpty) return;
    if (row.every((cell) => trim(cell) === '')) return;

    const line = index + 1;
    const raw = trim(row[columns.phone]);

    if (!raw) {
      rejected.push({ line, value: row.map(trim).join(' ').slice(0, 60), reason: 'No phone number in the row.' });
      return;
    }

    const phoneNumber = normalizePhone(raw);
    if (!isValidParticipantPhone(phoneNumber)) {
      rejected.push({
        line,
        value: raw.slice(0, 60),
        reason: 'Not a phone number we can match a bidder to.',
      });
      return;
    }

    const fullName = columns.name >= 0 ? trim(row[columns.name]).slice(0, MAX_NAME_LENGTH) : '';
    const note = columns.note >= 0 ? trim(row[columns.note]).slice(0, MAX_NOTE_LENGTH) : '';

    // A spreadsheet is a text field like any other. This is the one route into
    // the database that does not pass through readJsonBody, so the same rule is
    // applied here rather than left as the gap someone finds later.
    //
    // Checked before the number is marked as seen: a rejected row must not
    // claim the number, or a later good row for the same person would be
    // dropped as a duplicate and nobody would be on the list at all.
    if (containsMarkup(fullName) || containsMarkup(note)) {
      rejected.push({
        line,
        value: raw.slice(0, 60),
        reason: 'Name or note contains HTML or script tags.',
      });
      return;
    }

    if (seen.has(phoneNumber)) {
      duplicates += 1;
      return;
    }
    seen.add(phoneNumber);

    entries.push({
      phoneNumber,
      fullName: fullName || null,
      note: note || null,
    });
  });

  return { entries, rejected, duplicates, headerDetected: header !== null };
}

/** Convenience wrapper for CSV / TSV / plain-text input. */
export function parseParticipantText(text: string): ParsedList {
  return rowsToEntries(parseDelimitedText(text));
}

/** Merges a fresh parse into an existing set of numbers, for append imports. */
export function withoutExisting(entries: ParticipantEntry[], existing: Set<string>) {
  const fresh: ParticipantEntry[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (existing.has(entry.phoneNumber)) skipped += 1;
    else fresh.push(entry);
  }
  return { fresh, skipped };
}

/** The CSV an operator downloads as a starting point for their own list. */
export const PARTICIPANT_TEMPLATE_CSV = [
  'phone,name,note',
  '0912345678,Abebe Bekele,Loyalty tier gold',
  '251911223344,Sara Tesfaye,',
  '0700112233,,Branch referral',
  '',
].join('\r\n');
