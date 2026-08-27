import { describe, expect, it } from 'vitest';
import { resolveUploadPath, sniffImageType, uploadContentType } from './uploads';

/** A buffer beginning with `bytes`, padded out so short-header checks pass. */
function header(bytes: number[], length = 32): Uint8Array {
  const out = new Uint8Array(length);
  out.set(bytes.slice(0, length));
  return out;
}

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/** An ISO-BMFF `ftyp` box: size, 'ftyp', major brand, version, compatibles. */
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const body = [...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
  const size = 8 + body.length;
  return header([(size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff, ...ascii('ftyp'), ...body], size);
}

describe('sniffImageType', () => {
  it('recognises the formats we store', () => {
    expect(sniffImageType(header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(header([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(header(ascii('GIF89a')))).toBe('image/gif');
    expect(sniffImageType(header(ascii('GIF87a')))).toBe('image/gif');
    expect(sniffImageType(header([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]))).toBe(
      'image/webp'
    );
    expect(sniffImageType(ftyp('avif'))).toBe('image/avif');
    expect(sniffImageType(ftyp('avis'))).toBe('image/avif');
  });

  it('accepts a HEIF container only when it names avif among its brands', () => {
    expect(sniffImageType(ftyp('mif1', ['avif', 'miaf']))).toBe('image/avif');
    expect(sniffImageType(ftyp('mif1', ['heic', 'miaf']))).toBeNull();
  });

  it('refuses the rest of the ftyp family, which is not an image', () => {
    // The old check tested for 'ftyp' alone, so every one of these was stored
    // as an .avif and served back with an image Content-Type.
    expect(sniffImageType(ftyp('isom', ['iso2', 'mp41']))).toBeNull();
    expect(sniffImageType(ftyp('qt  '))).toBeNull();
    expect(sniffImageType(ftyp('heic', ['mif1']))).toBeNull();
    expect(sniffImageType(ftyp('AAAA'))).toBeNull();
  });

  it('refuses a script that has had an ftyp box bolted onto its front', () => {
    const payload = header([0, 0, 0, 0x18, ...ascii('ftypAAAA'), ...ascii('<?php echo 1; ?>')]);
    expect(sniffImageType(payload)).toBeNull();
  });

  it('refuses a near-miss on each real signature', () => {
    // PNG without the CRLF/EOF part of its signature.
    expect(sniffImageType(header([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
    // 'GIF8' with no trailing 'a'.
    expect(sniffImageType(header(ascii('GIF8xx')))).toBeNull();
    // A RIFF container that is not WebP.
    expect(sniffImageType(header([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVEfmt ')]))).toBeNull();
    // RIFF/WEBP with a chunk that is not a VP8 one.
    expect(sniffImageType(header([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPXXXX')]))).toBeNull();
  });

  it('refuses ordinary hostile uploads', () => {
    expect(sniffImageType(new Uint8Array(ascii('<?php system($_GET[0]); ?>')))).toBeNull();
    expect(sniffImageType(new Uint8Array(ascii('<svg onload="alert(1)"/>')))).toBeNull();
    expect(sniffImageType(new Uint8Array(ascii('#!/bin/sh\nid\n')))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('resolveUploadPath', () => {
  it('accepts a generated filename', () => {
    expect(resolveUploadPath('0f8fad5b-d9cb-469f-a165-70867728950e.png')).not.toBeNull();
  });

  it('refuses a name that tries to leave the directory', () => {
    expect(resolveUploadPath('../../.env')).toBeNull();
    expect(resolveUploadPath('..%2f..%2f.env')).toBeNull();
    expect(resolveUploadPath('sub/dir.png')).toBeNull();
    expect(resolveUploadPath('sub\\dir.png')).toBeNull();
    expect(resolveUploadPath('/etc/passwd')).toBeNull();
    expect(resolveUploadPath('no-extension')).toBeNull();
  });
});

describe('uploadContentType', () => {
  it('maps the extensions we store, and nothing else', () => {
    expect(uploadContentType('a.png')).toBe('image/png');
    expect(uploadContentType('a.AVIF')).toBe('image/avif');
    expect(uploadContentType('a.svg')).toBeNull();
    expect(uploadContentType('a.html')).toBeNull();
    expect(uploadContentType('a.php')).toBeNull();
  });
});
