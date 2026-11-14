import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { XlsxError, openWorkbook, serialToText, writeXlsx } from './xlsx.js';

const fixture = Uint8Array.from(
  readFileSync(new URL('../../../../../fixtures/xlsx/people.xlsx', import.meta.url)),
);

describe('reading', () => {
  it('lists the sheets and reads values, dates, booleans and formula results as text', async () => {
    const book = await openWorkbook(fixture);
    expect(book.sheets.map((s) => s.name)).toEqual(['People', 'Second']);
    const rows = await book.read(0);
    expect(rows[0]).toEqual(['Name', 'Age', 'Joined', 'Active', 'Zip', 'Note']);
    expect(rows[1]).toEqual(['Åsa Öberg', '31', '2024-03-05', 'TRUE', '00123', 'a & b <c>']);
    expect(rows[2]).toEqual(['Bo', '4.5', '2024-12-31 13:30:00', 'FALSE', '90210', '']);
    expect(rows[3]?.slice(0, 1)).toEqual(['Sum']);
    expect(await book.read(1)).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('refuses what is not a workbook', async () => {
    await expect(openWorkbook(Uint8Array.from([1, 2, 3]))).rejects.toMatchObject({
      code: 'not-xlsx',
    });
    await expect(openWorkbook(fixture.subarray(0, 100))).rejects.toBeInstanceOf(XlsxError);
  });
});

describe('serialToText', () => {
  it('handles the 1900 and 1904 systems', () => {
    expect(serialToText(45356, false)).toBe('2024-03-05');
    expect(serialToText(1, false)).toBe('1900-01-01');
    expect(serialToText(60, false)).toBe('1900-02-29');
    expect(serialToText(61, false)).toBe('1900-03-01');
    expect(serialToText(0, true)).toBe('1904-01-01');
  });
});

describe('writing', () => {
  const rows = [
    ['Name', 'Amount', 'Zip', 'Id', 'Note'],
    ['Åsa & Co <x>', '12.5', '00123', '12345678901234567890', ' padded '],
    ['', '-3', '1e5', '0', 'line\nbreak'],
  ];

  it('round-trips through our own reader', async () => {
    const book = await openWorkbook(writeXlsx(rows, 'Data'));
    expect(book.sheets.map((s) => s.name)).toEqual(['Data']);
    expect(await book.read(0)).toEqual(rows);
  });

  it('is the same bytes every time', () => {
    expect(writeXlsx(rows)).toEqual(writeXlsx(rows));
  });

  it('keeps leading zeros and long ids as text and plain numbers as numbers', () => {
    const text = new TextDecoder().decode(writeXlsx(rows));
    expect(text).toContain('<c r="B2"><v>12.5</v></c>');
    expect(text).toContain('<c r="C2" t="inlineStr">');
    expect(text).toContain('<c r="D2" t="inlineStr">');
    expect(text).toContain('<c r="B3"><v>-3</v></c>');
    expect(text).toContain('<c r="D3"><v>0</v></c>');
  });
});
