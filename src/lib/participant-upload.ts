import type { NextRequest } from 'next/server';
import { readJsonBody } from './api';
import { parseParticipantText, readParticipantFile } from './eligibility';
import type { ParsedList } from './eligibility-list';

/**
 * Reading an uploaded participant list off a request.
 *
 * The same CSV can now be dropped in two places — onto one auction, or onto a
 * saved list under Content — and an operator would rightly expect the same file
 * to behave identically in both. Keeping the request-shaped part here is what
 * guarantees that: the size limit, the accepted extensions, the drag-and-drop
 * multipart form and the pasted-text JSON body are defined once.
 *
 * Parsing itself lives in `eligibility-list.ts`; this only gets the bytes to it.
 */

/** Uploads are lists of phone numbers, so a few hundred KB is already generous. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = ['.csv', '.txt', '.tsv', '.xlsx', '.xlsm'];

/** The same string the file picker and the drop zone advertise. */
export const ACCEPTED_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');

export interface UploadRead {
  parsed: ParsedList;
  mode: 'replace' | 'append';
  /** How the numbers arrived, stored on each participant row. */
  source: string;
  /** Anything else that came alongside the file, e.g. a new list's name. */
  fields: Record<string, string>;
}

export interface UploadFailure {
  error: string;
  status: number;
}

export function isUploadFailure(result: UploadRead | UploadFailure): result is UploadFailure {
  return 'error' in result;
}

/**
 * Turns a request into parsed entries, whichever way the operator supplied them.
 *
 * Returns a failure rather than throwing so a route can hand it straight to
 * `jsonError` with the right status — a 413 for an oversized file and a 415 for
 * a .docx are worth telling apart.
 */
export async function readParticipantUpload(req: NextRequest): Promise<UploadRead | UploadFailure> {
  const contentType = req.headers.get('content-type') || '';
  const fields: Record<string, string> = {};

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { error: 'Could not read the uploaded file.', status: 400 };
    }

    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') fields[key] = value;
    }

    const file = form.get('file');
    if (!file || typeof file === 'string') return { error: 'No file was supplied.', status: 400 };
    if (file.size === 0) return { error: 'The selected file is empty.', status: 400 };
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        error: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        } MB.`,
        status: 413,
      };
    }

    const name = 'name' in file ? String(file.name).toLowerCase() : '';
    if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      return { error: 'Upload a .csv, .txt or .xlsx file.', status: 415 };
    }

    try {
      return {
        parsed: await readParticipantFile(file),
        mode: fields.mode === 'replace' ? 'replace' : 'append',
        source: 'UPLOAD',
        fields,
      };
    } catch (error) {
      console.error('[participants] parse failed', error);
      return { error: 'The file could not be read. Save it as CSV and try again.', status: 400 };
    }
  }

  const body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
  const mode = body.mode === 'replace' ? 'replace' : 'append';

  if (typeof body.text === 'string') {
    return { parsed: parseParticipantText(body.text), mode, source: 'MANUAL', fields };
  }

  if (Array.isArray(body.entries)) {
    // Entries arrive as raw rows and go through the same parser, so a number
    // typed into the admin is normalised exactly like an uploaded one.
    const text = body.entries
      .map((entry: unknown) => {
        if (typeof entry === 'string') return entry;
        const row = entry as {
          phoneNumber?: string;
          phone?: string;
          fullName?: string;
          note?: string;
        };
        return [row.phoneNumber ?? row.phone ?? '', row.fullName ?? '', row.note ?? '']
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',');
      })
      .join('\n');

    return { parsed: parseParticipantText(text), mode, source: 'MANUAL', fields };
  }

  return { error: 'Supply a file, a list of numbers, or entries to add.', status: 400 };
}

/**
 * The "nothing usable in there" message, which differs depending on whether the
 * file was empty or simply unreadable.
 */
export function emptyParseError(parsed: ParsedList): UploadFailure & { rejected: ParsedList['rejected'] } {
  return {
    error:
      parsed.rejected.length > 0
        ? `No usable phone numbers were found — ${parsed.rejected.length} row(s) could not be read.`
        : 'No phone numbers were found in what you supplied.',
    status: 400,
    rejected: parsed.rejected.slice(0, 20),
  };
}

/** Quotes a CSV field only when it has to be. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A downloadable CSV of phone/name/note rows. */
export function toParticipantCsv(
  rows: { phoneNumber: string; fullName: string | null; note: string | null }[]
): string {
  return [
    'phone,name,note',
    ...rows.map((row) => [row.phoneNumber, row.fullName ?? '', row.note ?? ''].map(csvCell).join(',')),
    '',
  ].join('\r\n');
}
