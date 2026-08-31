import { answerableFields } from './helpers.js';
import type { FormDefinition } from './definition.js';

/**
 * Export, and the one criterion it has to meet.
 *
 * START-HERE's Done-means list says "The CSV opens in Excel with Swedish characters intact". On
 * Windows, Excel reads a CSV as the system code page unless the file starts with a UTF-8 byte
 * order mark, so `Öberg` arrives as `Ã–berg`. The BOM below is the whole reason that works, and
 * there is a test asserting it is there.
 *
 * Exports reproduce what is on screen — same columns, same order, same rows. That is why the
 * caller passes the visible columns and rows rather than a query.
 */
export const UTF8_BOM = '﻿';

export interface ExportColumn {
  key: string;
  header: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'list';
}

export type ExportRow = Record<string, unknown>;

export interface CsvOptions {
  /**
   * Excel picks the delimiter from the system list separator, which is `;` in Sweden and much of
   * Europe. Configurable rather than assumed.
   */
  separator?: ',' | ';' | '\t';
  /** CRLF by default: Excel is happier with it, and every other reader tolerates it. */
  newline?: '\r\n' | '\n';
}

/** Columns for a form: the fixed submission metadata, then one per answerable field. */
export function columnsFor(
  definition: FormDefinition,
  labels: { header: (key: string) => string; fieldHeader: (fieldKey: string) => string },
): ExportColumn[] {
  const meta: ExportColumn[] = [
    { key: 'reference', header: labels.header('reference'), type: 'text' },
    { key: 'submittedAt', header: labels.header('submittedAt'), type: 'date' },
    { key: 'locale', header: labels.header('locale'), type: 'text' },
    { key: 'status', header: labels.header('status'), type: 'text' },
  ];

  const fields = answerableFields(definition).map((field): ExportColumn => {
    const type: ExportColumn['type'] =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'yes_no'
            ? 'boolean'
            : field.type === 'multi_select'
              ? 'list'
              : 'text';
    return { key: field.key, header: labels.fieldHeader(field.key), type };
  });

  return [...meta, ...fields];
}

export function toCsv(
  columns: readonly ExportColumn[],
  rows: readonly ExportRow[],
  options: CsvOptions = {},
): string {
  const separator = options.separator ?? ';';
  const newline = options.newline ?? '\r\n';

  const lines = [
    columns.map((column) => escapeCsv(column.header, separator)).join(separator),
    ...rows.map((row) =>
      columns.map((column) => escapeCsv(formatCell(row[column.key]), separator)).join(separator),
    ),
  ];

  return UTF8_BOM + lines.join(newline) + newline;
}

/** Rows shaped for a spreadsheet writer, with real types rather than strings. */
export function toSheetRows(
  columns: readonly ExportColumn[],
  rows: readonly ExportRow[],
): Array<Array<{ value: string | number | boolean | Date | null; type: ExportColumn['type'] }>> {
  return rows.map((row) =>
    columns.map((column) => ({
      value: typedCell(row[column.key], column.type),
      type: column.type,
    })),
  );
}

function typedCell(value: unknown, type: ExportColumn['type']) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  if (type === 'boolean') return Boolean(value);
  if (type === 'date') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date;
  }
  return formatCell(value);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Quotes a field when it contains the separator, a quote or a newline, doubling embedded quotes.
 *
 * The leading-character guard is not cosmetic: a cell beginning `=`, `+`, `-` or `@` is executed
 * as a formula when the file is opened, so an answer typed into a public form could run in the
 * operator's spreadsheet. Prefixing a tab neutralises it without changing the visible text.
 */
function escapeCsv(value: string, separator: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
  const needsQuotes =
    guarded.includes(separator) ||
    guarded.includes('"') ||
    guarded.includes('\n') ||
    guarded.includes('\r');
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
