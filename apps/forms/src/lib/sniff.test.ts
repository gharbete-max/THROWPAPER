import { describe, expect, it } from 'vitest';
import { sniffBytes, sniffFile } from './sniff.js';

const bytes = (...parts: Array<string | number[]>) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe('sniffing a file by its bytes', () => {
  const table: Array<[string, Uint8Array, string]> = [
    ['a PDF', bytes('%PDF-1.7\n'), 'pdf'],
    ['a PDF with junk before the marker', bytes('\n\n  junk %PDF-1.4'), 'pdf'],
    ['a JPEG', bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'), 'photo'],
    ['a PNG', bytes([0x89], 'PNG\r\n', [0x1a], '\n'), 'photo'],
    ['a WebP', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'photo'],
    ['a HEIC photo', bytes([0, 0, 0, 24], 'ftypheic'), 'photo'],
    ['a Word file', bytes('PK\x03\x04', [0, 0], '...word/document.xml...'), 'word'],
    ['a spreadsheet zip', bytes('PK\x03\x04', [0, 0], '...xl/workbook.xml...'), 'other'],
    ['plain text', bytes('hello'), 'other'],
    ['nothing', new Uint8Array(), 'other'],
  ];
  it.each(table)('%s', (_name, data, expected) => {
    expect(sniffBytes(data)).toBe(expected);
  });

  it('reads a zip listing from the end of the file', () => {
    const head = bytes('PK\x03\x04', [0, 0]);
    expect(sniffBytes(head, bytes('...word/document.xml'))).toBe('word');
    expect(sniffBytes(head, bytes('...xl/sheet1.xml'))).toBe('other');
  });

  it('ignores the name: a photograph called scan.pdf is a photograph', async () => {
    const file = new File([bytes([0xff, 0xd8, 0xff, 0xe0])], 'scan.pdf', {
      type: 'application/pdf',
    });
    expect(await sniffFile(file)).toBe('photo');
    const word = new File([bytes('PK\x03\x04', 'word/document.xml')], 'minutes', { type: '' });
    expect(await sniffFile(word)).toBe('word');
  });
});
