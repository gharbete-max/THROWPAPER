import { z } from 'zod';
import { Email, Locale } from './common.js';

/**
 * Sending documents by mail (Documents, phase "Send"): one document to some people, or one
 * personalised PDF per recipient from a list.
 *
 * Everything here is pure and shared, so the screen checks a list with the very code the server
 * checks it with. Money is a bigint of minor units; text becomes one by `parseMinor` and never
 * passes through a float. A VAT rate is only ever one a person typed: nothing here has a default.
 */

/** Hard caps. A larger list is refused, not trimmed: a silent cut would leave tenants unbilled. */
export const SEND_LIMITS = {
  /** Personalised documents in one batch. */
  batch: 200,
  /** People one document goes to in one press. */
  recipients: 20,
  /** People one campaign email goes to in one press (`campaign.ts`). */
  campaign: 500,
  /** One attachment, as brought in. */
  attachmentBytes: 25 * 1024 * 1024,
} as const;

export const BATCH_LAYOUTS = ['letter', 'invoice'] as const;
export const BatchLayout = z.enum(BATCH_LAYOUTS);
export type BatchLayout = z.infer<typeof BatchLayout>;

export const SEND_CURRENCIES = ['SEK', 'EUR', 'NOK', 'DKK'] as const;

/** The fields a list can fill in, written `{{name}}` in a title, a subject or a message. */
export const MERGE_FIELDS = ['name', 'email', 'amount', 'reference'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** One line of the list, as typed or read from a file: text, checked by `checkBatch`. */
export const BatchRow = z.object({
  name: z.string().max(200),
  email: z.string().max(320),
  amount: z.string().max(40),
  reference: z.string().max(100),
});
export type BatchRow = z.infer<typeof BatchRow>;

/**
 * The layout every document in a batch shares. Words in it are the person's own; the labels the
 * invoice layout prints ("Total", "Due") are functional ones from the product's catalogue.
 */
export const BatchTemplate = z.object({
  layout: BatchLayout,
  locale: Locale,
  currency: z.enum(SEND_CURRENCIES),
  /** The heading of the document. May use fields. */
  title: z.string().trim().min(1).max(200),
  /** A letter's text, or an invoice's description line. May use fields. */
  body: z.string().max(5000),
  /** Invoice only. A percentage a person typed, like `25` or `12,5`; `0` is typed too. */
  vatRate: z.string().max(10).optional(),
  /** Invoice only. Where to pay, as typed. */
  payTo: z.string().max(60).optional(),
  /** Invoice only. A date, `YYYY-MM-DD`. */
  dueOn: z.string().date().optional(),
});
export type BatchTemplate = z.infer<typeof BatchTemplate>;

/** The press on a batch (`POST /v1/send/batch`). `key` makes a second press the same press. */
export const SendBatchRequest = z.object({
  key: z.string().uuid(),
  /** The confirmation step, answered. A request without it queues nothing. */
  confirmed: z.literal(true),
  /** Test: everything goes to this one address instead, marked as a test. */
  testTo: Email.optional(),
  template: BatchTemplate,
  subject: z.string().trim().min(1).max(200),
  message: z.string().max(2000),
  /** Counted against `SEND_LIMITS.batch` by the route, which says so in words. */
  rows: z.array(BatchRow).min(1).max(5000),
});
export type SendBatchRequest = z.infer<typeof SendBatchRequest>;

export const BatchPreviewRequest = z.object({ template: BatchTemplate, row: BatchRow });
export type BatchPreviewRequest = z.infer<typeof BatchPreviewRequest>;

/** Where a message goes: to the waiting list, to a test place, or out. */
export const SEND_MODES = ['to-send', 'test', 'live'] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const SendMode = z.enum(SEND_MODES);
export const SendModeResponse = z.object({
  mode: SendMode,
  batch: z.number().int(),
  recipients: z.number().int(),
});
export type SendModeResponse = z.infer<typeof SendModeResponse>;

export const SendQueued = z.object({
  items: z.array(z.object({ index: z.number().int(), to: z.string(), id: z.string().uuid() })),
});
export type SendQueued = z.infer<typeof SendQueued>;

/** `skipped`: a campaign message not sent because the address is on the suppression list. */
export const SEND_STATES = ['queued', 'sent', 'failed', 'skipped'] as const;
export const SendStatusResponse = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      state: z.enum(SEND_STATES),
      /** Which provider took it: `queue` is To send, `outbox` and `console` are tests. */
      provider: z.string().nullable(),
    }),
  ),
});
export type SendStatusResponse = z.infer<typeof SendStatusResponse>;

// ---------------------------------------------------------------------------------------------
// Amounts

/** Whitespace in an amount: any space, a no-break space, a narrow no-break space. */
const SPACES = new RegExp(`[\\s${String.fromCharCode(0xa0, 0x202f)}]`, 'g');

/**
 * An amount a person typed or a file held, as minor units — `"1 234,50"`, `"1,234.50"`,
 * `"1.234"`, `"12 kr"` — or `null` when it is not one. Integer arithmetic only.
 *
 * A separator followed by one or two digits is the decimal mark; followed by exactly three it
 * groups thousands (`1.234` is 1234, because money has two decimals). Mixed marks must be in
 * order (`1.234,50`, `1,234.50`). No sign: a credit is not something to guess at.
 */
export function parseMinor(text: string): bigint | null {
  // A minus (or a dash standing for one) anywhere is a credit, never "12 kr -5" read as 5. The
  // Swedish whole-krona marks `:-` and `,-` are the one place a hyphen is not a sign.
  if (/[-‐-―−]/.test(text.replace(/[:,]-/g, ''))) return null;
  const s = text.replace(SPACES, '').replace(/^[^\d.,]+|[^\d.,]+$/g, '');
  const m = /^(\d+|\d{1,3}(?:[.,]\d{3})+)(?:([.,])(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const [, whole, mark, cents] = m as unknown as [
    string,
    string,
    string | undefined,
    string | undefined,
  ];
  // The mark that groups thousands must not also be the decimal mark.
  if (mark && whole.includes(mark)) return null;
  if (whole.includes('.') && whole.includes(',')) return null;
  const digits = whole.replace(/[.,]/g, '');
  if (digits.length > 12) return null;
  return BigInt(digits) * 100n + BigInt((cents ?? '').padEnd(2, '0') || '0');
}

/** A typed percentage (`25`, `12,5`, `0`) as basis points, or `null`. Up to two decimals, max 100. */
export function parseBasisPoints(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const points = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return points <= 10_000 ? points : null;
}

// ---------------------------------------------------------------------------------------------
// Merge fields

const FIELD = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** The names between double braces that are not fields a list can fill. */
export function unknownFields(...texts: readonly string[]): string[] {
  const bad = new Set<string>();
  for (const text of texts) {
    for (const [, name] of text.matchAll(FIELD)) {
      if (!(MERGE_FIELDS as readonly string[]).includes(name!)) bad.add(name!);
    }
  }
  return [...bad];
}

/** Fills `{{name}}` and the others from a row's values; anything else is left as written. */
export function mergeText(text: string, values: Record<MergeField, string>): string {
  return text.replace(FIELD, (whole, name: string) =>
    (MERGE_FIELDS as readonly string[]).includes(name) ? values[name as MergeField] : whole,
  );
}

/** A header (subject): one line, no control characters. */
export const oneLine = (text: string): string =>
  [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? ' ' : char;
    })
    .join('')
    .replace(/ +/g, ' ')
    .trim();

// ---------------------------------------------------------------------------------------------
// Checking a list

export type RowProblem = { row: number; field: keyof BatchRow | 'template'; code: string };

const EMAIL = Email;

/**
 * What is wrong with a list before anything is previewed or sent: a missing name, an address that
 * is not one, an amount that is not understood or zero where the layout or the words use it, a
 * VAT rate nobody typed. Empty means fine.
 */
export function checkBatch(
  template: BatchTemplate,
  subject: string,
  message: string,
  rows: readonly BatchRow[],
): RowProblem[] {
  const problems: RowProblem[] = [];
  const unknown = unknownFields(template.title, template.body, subject, message);
  if (unknown.length > 0) problems.push({ row: -1, field: 'template', code: 'unknown-field' });
  const invoice = template.layout === 'invoice';
  if (invoice && (template.vatRate === undefined || parseBasisPoints(template.vatRate) === null)) {
    problems.push({ row: -1, field: 'template', code: 'vat-rate' });
  }
  const texts = [template.title, template.body, subject, message].join('\n');
  const usesAmount = invoice || /\{\{\s*amount\s*\}\}/.test(texts);
  const usesReference = /\{\{\s*reference\s*\}\}/.test(texts);
  rows.forEach((row, index) => {
    if (row.name.trim() === '') problems.push({ row: index, field: 'name', code: 'missing' });
    if (!EMAIL.safeParse(row.email.trim()).success) {
      problems.push({ row: index, field: 'email', code: 'bad-email' });
    }
    if (usesAmount) {
      const minor = parseMinor(row.amount);
      if (minor === null) problems.push({ row: index, field: 'amount', code: 'bad-amount' });
      else if (invoice && minor === 0n) {
        problems.push({ row: index, field: 'amount', code: 'zero-amount' });
      }
    }
    if (usesReference && row.reference.trim() === '') {
      problems.push({ row: index, field: 'reference', code: 'missing' });
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------
// A pasted or uploaded table

/**
 * Comma-, semicolon- or tab-separated text into rows of cells (RFC 4180 quoting). The mark is the
 * one that appears most in the first line. Blank lines are dropped. Never throws.
 */
export function parseTable(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const first = source.split(/\r?\n/, 1)[0] ?? '';
  const count = (mark: string) => first.split(mark).length - 1;
  const mark = [';', '\t', ','].reduce(
    (best, next) => (count(next) > count(best) ? next : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === mark) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
    } else cell += char;
  }
  endRow();
  return rows;
}

/** Which column holds which field: an index into a row's cells, or `-1` for none. */
export type ColumnMap = Record<keyof BatchRow, number>;

/**
 * A first guess at the mapping from a header line's words, in the languages of the product.
 * Wrong guesses are harmless: the screen shows the mapping and the person changes it.
 */
export function guessColumns(header: readonly string[]): ColumnMap {
  const words: Record<keyof BatchRow, RegExp> = {
    name: /name|namn|navn|nimi|nom|nombre|名前|氏名|имя|姓名|nafn|hyresg|tenant|mieter/i,
    email: /mail|e-?post|sähkö|correo|メール|почт|邮|netfang/i,
    amount:
      /amount|belopp|beløb|beløp|summa|betrag|importe|montant|montant|金額|сумма|金额|upphæð|hyra|rent|total/i,
    reference:
      /ref|ocr|viite|referen|referenz|référence|参照|ссылк|参考|tilvísun|fakturanr|invoice/i,
  };
  const map: ColumnMap = { name: -1, email: -1, amount: -1, reference: -1 };
  for (const field of ['email', 'amount', 'reference', 'name'] as const) {
    const at = header.findIndex(
      (cell, index) => words[field].test(cell) && !Object.values(map).includes(index),
    );
    map[field] = at;
  }
  return map;
}

/** Table cells to rows, through a mapping. A field with no column is empty. */
export function rowsFrom(cells: readonly (readonly string[])[], map: ColumnMap): BatchRow[] {
  const at = (row: readonly string[], index: number) =>
    index < 0 ? '' : (row[index] ?? '').trim();
  return cells.map((row) => ({
    name: at(row, map.name),
    email: at(row, map.email),
    amount: at(row, map.amount),
    reference: at(row, map.reference),
  }));
}
