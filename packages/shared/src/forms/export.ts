import { answerableChildren, answerableFields, repeatingGroups } from './helpers.js';
import type { AnswerableField, EntryField, FormDefinition } from './definition.js';

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

/** How each column is titled, in the reader's own language. */
export interface ColumnLabels {
  header: (key: string) => string;
  fieldHeader: (fieldKey: string) => string;
  /**
   * How a group's numbered column is titled — "Guests 1 — Name".
   *
   * Supplied by the caller rather than composed here, because the order and the joining glyph are
   * wording, and `CLAUDE.md` rule 4 keeps wording in `packages/i18n`. The fallback exists so this
   * function stays callable without a catalogue; anything a person reads passes a real one.
   */
  entryHeader?: (group: string, entryNumber: number, child: string) => string;
}

/**
 * Columns for a form: when it arrived, then the answers, then the bookkeeping.
 *
 * ## Why the answers are not last
 *
 * The order used to be reference, submittedAt, locale, status, *then* the answers — so the first
 * thing anybody saw, on screen and in a spreadsheet, was an eight-character machine code, followed
 * by two columns that are usually the same value in every row. The name of the person who filled
 * the form in was column five at best, and off the right-hand edge on a narrow screen.
 *
 * `submittedAt` leads because a list of responses is read newest-first, and the answers follow
 * because they are the reason the form exists. `reference` keeps a column — it is what a person
 * at a door types in — but it does not open the table.
 */
export function columnsFor(definition: FormDefinition, labels: ColumnLabels): ExportColumn[] {
  const when: ExportColumn[] = [
    { key: 'submittedAt', header: labels.header('submittedAt'), type: 'date' },
  ];

  const bookkeeping: ExportColumn[] = [
    { key: 'reference', header: labels.header('reference'), type: 'text' },
    { key: 'locale', header: labels.header('locale'), type: 'text' },
    { key: 'status', header: labels.header('status'), type: 'text' },
  ];

  const fields = answerableFields(definition).flatMap((field): ExportColumn[] => {
    /**
     * A group becomes `max` blocks of columns — `guests_1_name`, `guests_1_meal`, `guests_2_name`.
     *
     * `max` is required on a group precisely so this loop can run off the definition alone. Columns
     * for entries nobody filled in are empty, exactly like an unanswered optional question, which
     * is what keeps every row the same width whatever anybody answered.
     *
     * See `docs/adr/0003-repeating-groups.md` for why this and not a JSON cell or a row per entry.
     */
    if (field.type === 'repeating_group') {
      const entryHeader =
        labels.entryHeader ?? ((group, number, child) => `${group} ${number} — ${child}`);

      return Array.from({ length: field.max }, (_unused, entry) =>
        answerableChildren(field).map((child): ExportColumn => ({
          key: entryColumnKey(field.key, entry + 1, child.key),
          header: entryHeader(
            labels.fieldHeader(field.key),
            entry + 1,
            labels.fieldHeader(child.key),
          ),
          type: cellType(child),
        })),
      ).flat();
    }

    return [{ key: field.key, header: labels.fieldHeader(field.key), type: cellType(field) }];
  });

  return [...when, ...fields, ...bookkeeping];
}

function cellType(field: AnswerableField | EntryField): ExportColumn['type'] {
  switch (field.type) {
    case 'number':
    case 'rating':
      return 'number';
    case 'date':
      return 'date';
    case 'yes_no':
      return 'boolean';
    case 'multi_select':
      return 'list';
    default:
      return 'text';
  }
}

/**
 * The column an answer inside a group lands in. **One-based**, because it is read by a person.
 *
 * `guests_1_name` is the first guest in the export and `guests[0].name` is the first guest in the
 * data, and both are right: a spreadsheet heading that started at nought would be a heading nobody
 * could act on, and an array index that started at one would be an array index that lies.
 */
export function entryColumnKey(groupKey: string, entryNumber: number, childKey: string): string {
  return `${groupKey}_${entryNumber}_${childKey}`;
}

/**
 * A submission's answers, with each group's entries spread across its numbered columns.
 *
 * The only place flattening happens. The answer a respondent gave, the answer the API returns and
 * the answer stored in the database all keep the nested shape; this is the presentation step, and
 * confining it here is what stops `guests_1_name` leaking into the model as a real key.
 *
 * The group's own key is dropped rather than left beside its columns — a cell containing
 * `[object Object],[object Object]` helps nobody, and every answer it held is already to the right.
 */
export function flattenAnswers(
  definition: FormDefinition,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const groups = repeatingGroups(definition);
  if (groups.length === 0) return { ...data };

  const flat: Record<string, unknown> = { ...data };

  for (const group of groups) {
    delete flat[group.key];

    const entries = Array.isArray(data[group.key]) ? (data[group.key] as unknown[]) : [];

    for (let entry = 0; entry < group.max; entry += 1) {
      const given = entries[entry];
      const answers =
        given !== null && typeof given === 'object' && !Array.isArray(given)
          ? (given as Record<string, unknown>)
          : {};

      for (const child of answerableChildren(group)) {
        flat[entryColumnKey(group.key, entry + 1, child.key)] = answers[child.key] ?? null;
      }
    }
  }

  return flat;
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
