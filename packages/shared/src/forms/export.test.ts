import { describe, expect, it } from 'vitest';
import { Field, columnsFor, emptyDefinition, toCsv, toSheetRows, UTF8_BOM } from './index.js';
import type { ExportColumn, FormDefinition } from './index.js';

const columns: ExportColumn[] = [
  { key: 'reference', header: 'Referens', type: 'text' },
  { key: 'full_name', header: 'Namn', type: 'text' },
  { key: 'guests', header: 'Gäster', type: 'number' },
];

describe('the CSV acceptance criterion', () => {
  it('starts with a UTF-8 BOM — without it Excel mangles å ä ö on Windows', () => {
    const csv = toCsv(columns, []);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('round-trips Swedish characters unchanged', () => {
    const csv = toCsv(columns, [{ reference: 'A1', full_name: 'Björn Öberg', guests: 1 }]);
    expect(csv).toContain('Björn Öberg');
    expect(csv).toContain('Gäster');
  });

  it('defaults to a semicolon, which is the list separator Excel expects in Sweden', () => {
    expect(toCsv(columns, [{ reference: 'A1' }])).toContain('Referens;Namn;Gäster');
  });

  it('accepts a comma or tab instead', () => {
    expect(toCsv(columns, [], { separator: ',' })).toContain('Referens,Namn,Gäster');
    expect(toCsv(columns, [], { separator: '\t' })).toContain('Referens\tNamn\tGäster');
  });
});

describe('escaping', () => {
  it('quotes a value containing the separator', () => {
    const csv = toCsv(columns, [{ reference: 'A1', full_name: 'Sjöström; & Co' }]);
    expect(csv).toContain('"Sjöström; & Co"');
  });

  it('doubles embedded quotes', () => {
    const csv = toCsv(columns, [{ reference: 'A1', full_name: 'Anna "Anki" Ek' }]);
    expect(csv).toContain('"Anna ""Anki"" Ek"');
  });

  it('quotes a value containing a newline', () => {
    const csv = toCsv(columns, [{ reference: 'A1', full_name: 'Line one\nLine two' }]);
    expect(csv).toContain('"Line one\nLine two"');
  });

  /**
   * A public form takes text from anyone. A cell starting `=` is executed when the operator opens
   * the file, so an answer could run in their spreadsheet.
   */
  it('neutralises a formula typed into a public form', () => {
    const csv = toCsv(columns, [{ reference: 'A1', full_name: '=cmd|calc' }]);
    expect(csv).not.toMatch(/(^|;)=cmd/);
    expect(csv).toContain('\t=cmd|calc');
  });

  it('neutralises the other formula-leading characters', () => {
    for (const dangerous of ['+1+1', '-1+1', '@SUM(A1)']) {
      const csv = toCsv(columns, [{ reference: 'A1', full_name: dangerous }]);
      expect(csv).toContain(`\t${dangerous}`);
    }
  });
});

describe('cell formatting', () => {
  it('joins a multi-select into one readable cell', () => {
    const column: ExportColumn[] = [{ key: 'sessions', header: 'Pass', type: 'list' }];
    // With the default semicolon separator the comma inside the cell is harmless, so no quoting.
    expect(toCsv(column, [{ sessions: ['a', 'b'] }])).toContain('a, b');
    // With a comma separator the same cell must be quoted, or it would split into two columns.
    expect(toCsv(column, [{ sessions: ['a', 'b'] }], { separator: ',' })).toContain('"a, b"');
  });

  it('writes an empty cell for a missing answer rather than "undefined"', () => {
    const csv = toCsv(columns, [{ reference: 'A1' }]);
    expect(csv).not.toContain('undefined');
    expect(csv).toContain('A1;;');
  });
});

describe('spreadsheet rows keep their types', () => {
  it('gives numbers, dates and booleans real types rather than strings', () => {
    const sheet = toSheetRows(
      [
        { key: 'guests', header: 'Gäster', type: 'number' },
        { key: 'submittedAt', header: 'Skickad', type: 'date' },
        { key: 'dietary', header: 'Kost', type: 'boolean' },
      ],
      [{ guests: '2', submittedAt: '2026-05-14T09:00:00.000Z', dietary: true }],
    );

    expect(sheet[0]?.[0]?.value).toBe(2);
    expect(sheet[0]?.[1]?.value).toBeInstanceOf(Date);
    expect(sheet[0]?.[2]?.value).toBe(true);
  });

  it('leaves a missing value null rather than zero', () => {
    const sheet = toSheetRows([{ key: 'guests', header: 'Gäster', type: 'number' }], [{}]);
    expect(sheet[0]?.[0]?.value).toBeNull();
  });
});

describe('columns follow the form', () => {
  it('puts submission metadata first, then one column per answerable field', () => {
    const definition: FormDefinition = {
      ...emptyDefinition,
      fields: [
        Field.parse({
          id: 'f1',
          key: 'full_name',
          type: 'short_text',
          label: { 'sv-SE': 'Namn' },
        }),
        Field.parse({ id: 'f2', key: 'page', type: 'page_break' }),
        Field.parse({ id: 'f3', key: 'guests', type: 'number', label: { 'sv-SE': 'Gäster' } }),
      ],
    };

    const result = columnsFor(definition, {
      header: (key) => key,
      fieldHeader: (key) => key.toUpperCase(),
    });

    // When it arrived, then what was answered, then the bookkeeping. A reader looking for a
    // person should not have to pass an eight-character machine code to reach their name.
    expect(result.map((column) => column.key)).toEqual([
      'submittedAt',
      'full_name',
      'guests',
      'reference',
      'locale',
      'status',
    ]);
    // Presentational fields collect nothing, so they get no column.
    expect(result.some((column) => column.key === 'page')).toBe(false);
    expect(result.find((column) => column.key === 'guests')?.type).toBe('number');
  });
});
