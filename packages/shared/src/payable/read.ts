import { parseAmount } from './amount.js';
import {
  checkBankgiro,
  checkIban,
  checkPlusgiro,
  checkReference,
  IBAN_LENGTHS,
  type Check,
  type ReferenceKind,
} from './checks.js';
import { DATE_IN_TEXT, parseDate } from './date.js';
import {
  confidenceOf,
  rowsOf,
  whereOf,
  wordsIn,
  type PayableWord,
  type Row,
  type Where,
} from './rows.js';

/**
 * What a supplier invoice says to pay, read by rule from the words of a page.
 *
 * ## No model, ever, in this path (`docs/adr/0019`, HANDOVER decision 5)
 *
 * The words come from optical reading (or a PDF's text layer); everything after that is label
 * lists, regular expressions and check digits. The same page always gives the same reading, and a
 * wrong reading can be traced to the rule that made it.
 *
 * ## Nothing is accepted here
 *
 * Every field comes back as candidates, each with the place on the page it was found, whether its
 * own check digit held, and flags for anything unsure (low optical confidence, a format that could
 * mean two amounts). `status` says how far a reading goes on its own:
 * - `found`: one candidate, no doubts raised by the rules — still confirmed by a person;
 * - `ask`: two or more rival candidates, or one whose format is ambiguous;
 * - `missing`: nothing was found.
 * The review screen puts every field in front of the person whatever its status.
 *
 * ## Not computed
 *
 * A VAT figure is read where the page prints one, never worked out from a rate; a due date is
 * only one the page prints, never "invoice date plus terms".
 */

export type Flag =
  /** A word of it was read with low confidence by optical reading. */
  | 'ocr-unsure'
  /** The digits fit more than one amount or date; the reading chosen is offered, not assumed. */
  | 'format-unsure'
  /** Found next to a general word like "Summa", not "Amount due". */
  | 'weak-label'
  /** Its value is below its label, not beside it. */
  | 'below-label'
  /** Not printed as such: worked out from the bank number and "kr". */
  | 'inferred';

export interface Candidate<V> {
  /** Null when what was found could not be read as a value of this kind; `text` is what it was. */
  value: V | null;
  /** The words as printed. */
  text: string;
  where: Where;
  /** Whether the value's own check digit held; `none` for a kind with no check digit. */
  check: Check;
  /** For a payment reference: which checks held. */
  detail?: string;
  flags: Flag[];
  /** 0–100, the least sure word. */
  confidence: number;
  /** 1 is the strongest label ("Amount due"), larger weaker. */
  tier: number;
}

export interface FieldReading<V> {
  status: 'found' | 'ask' | 'missing';
  /** Best first. */
  candidates: Candidate<V>[];
}

export interface Bank {
  method: 'bankgiro' | 'plusgiro' | 'iban';
  account: string;
}
export interface PaymentReference {
  kind: ReferenceKind;
  value: string;
}

export interface InvoiceReading {
  total: FieldReading<bigint>;
  currency: FieldReading<string>;
  dueDate: FieldReading<string>;
  bank: FieldReading<Bank>;
  reference: FieldReading<PaymentReference>;
  /** The VAT amount as printed. Optional, and never used to work anything out. */
  vat: FieldReading<bigint>;
}

/** Below this, optical reading was unsure of a word. */
export const UNSURE_BELOW = 75;

const LETTER = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
/**
 * Optical reading often drops a diacritic ("Förfallodatum" comes back "Forfallodatum") and plain
 * ASCII invoices spell them out, so each accented letter in a label also matches its plain form.
 */
const PLAIN: Record<string, string> = {
  ö: '[öo]',
  ä: '[äa]',
  å: '[åa]',
  ø: '[øo]',
  æ: '(?:æ|ae)',
  ü: '(?:ü|ue|u)',
  ß: '(?:ß|ss)',
};
const plain = (word: string) => word.replace(/[öäåøæüß]/gu, (c) => PLAIN[c]!);
const labels = (words: string[]) =>
  new RegExp(`${LETTER}(?:${words.map(plain).join('|')})${END}`, 'giu');

/** Amount-payable labels, strongest first by tier. Swedish, Danish, Norwegian, German, English. */
const TOTAL_TIERS: RegExp[] = [
  labels([
    'att betala',
    'at betale',
    'å betale',
    'til betaling',
    'zu zahlen',
    'zahlbetrag',
    'zahlungsbetrag',
    'gesamtbetrag',
    'rechnungsbetrag',
    'endbetrag',
    'amount due',
    'total due',
    'balance due',
    'amount payable',
    'total payable',
    'amount to pay',
  ]),
  labels([
    'totalt',
    'total',
    'totalsumma',
    'totalbelopp',
    'i alt',
    'ialt',
    'gesamt',
    'gesamtsumme',
    'grand total',
    'invoice total',
    'fakturabelopp',
    'fakturasumma',
    'samlet',
  ]),
  labels(['summa', 'sum', 'belopp', 'beløb', 'betrag', 'amount']),
];

const DUE_TIERS: RegExp[] = [
  labels([
    'förfallodatum',
    'förfallodag',
    'förfaller',
    'betalas senast',
    'sista betalningsdag',
    'forfaldsdato',
    'forfaldsdag',
    'betales senest',
    'betalingsfrist',
    'forfallsdato',
    'fälligkeitsdatum',
    'fällig am',
    'fällig bis',
    'zahlbar bis',
    'zahlbar am',
    'due date',
    'payment due',
    'due on',
    'due by',
    'pay by',
    'date due',
    'payable by',
  ]),
  labels(['forfald', 'forfall', 'fällig', 'due', 'sista dag']),
];

const BANKGIRO = labels(['bankgirot', 'bankgiro(?:nr|nummer| nr| no)?', 'bg(?:-nr|-nummer)?']);
const PLUSGIRO = labels(['plusgirot', 'plusgiro(?:nr|nummer| nr| no)?', 'postgiro(?:t)?', 'pg']);
const IBAN_LABEL = labels(['iban']);

/** Payment-reference labels that make free text a reference too. */
const REFERENCE_STRONG = labels([
  'ocr(?:-?(?:nr|nummer|number|referens))?',
  'betalningsreferens',
  'betalingsreference',
  'betalingsreferanse',
  'payment reference',
  'verwendungszweck',
  'kid(?:-nummer)?',
]);
const REFERENCE_WEAK = labels([
  'referens(?:nummer|nr)?',
  'reference(?: number)?',
  'referenz(?:nummer)?',
  'kreditorreference',
  'creditor reference',
  'gläubigerreferenz',
  'rf-referenz',
]);
/** "Your reference: Anna" and its kin name a person, not a payment. */
const PERSON_REFERENCE =
  /(?:\b|^)(?:er|vår|din|dina|deres|vores|jeres|your|our|ihre|unsere|unser|ihr)\s+$/iu;

const VAT = labels([
  'moms',
  'vat',
  'mwst',
  'mva',
  'ust',
  'umsatzsteuer',
  'mehrwertsteuer',
  'merværdiafgift',
  'sales tax',
]);

const ANY_LABEL = new RegExp(
  [
    ...TOTAL_TIERS,
    ...DUE_TIERS,
    BANKGIRO,
    PLUSGIRO,
    IBAN_LABEL,
    REFERENCE_STRONG,
    REFERENCE_WEAK,
    VAT,
  ]
    .map((re) => re.source)
    .join('|'),
  'giu',
);

/** A line that is not the total to pay: before VAT, a subtotal, a quantity. */
const NOT_A_TOTAL =
  /(?<![\p{L}])(?:exkl|excl|ekskl|eksl|zzgl|netto|net|delsumma|subtotal|zwischensumme|delsum|antal|qty|quantity|menge|stk|pcs|vikt|weight)(?![\p{L}])|ex\.? ?(?:moms|vat|mva)|f[öo]re moms|before vat|excluding|exklusive/iu;
const MENTIONS_VAT = /(?<![\p{L}])(?:moms|vat|mwst|mva|ust|steuer|tax|afgift)(?![\p{L}])/iu;
const INCLUDING =
  /(?<![\p{L}])(?:inkl|incl|inklusive|including|included|brutto|gross|enthalten|inkl\.)(?![\p{L}])/iu;

const AMOUNT =
  /(?<![\d.,/-])(?:\d{1,3}(?:[\s.,'’]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])(?![.,]\d)(?!\s?%)(?![/-]\d)/gu;

interface Hit {
  row: Row;
  index: number;
  /** Where the label ends in the row's text. */
  end: number;
  /** Where the label starts. */
  start: number;
}

function hits(rows: Row[], pattern: RegExp): Hit[] {
  return rows.flatMap((row, index) =>
    [...row.text.matchAll(new RegExp(pattern.source, pattern.flags))].map((m) => ({
      row,
      index,
      start: m.index,
      end: m.index + m[0].length,
    })),
  );
}

/** Where the next label begins, so one label's window never takes its neighbour's value. */
function windowEnd(row: Row, from: number): number {
  for (const m of row.text.matchAll(new RegExp(ANY_LABEL.source, ANY_LABEL.flags))) {
    if (m.index >= from) return m.index;
  }
  return row.text.length;
}

function tokens(row: Row, pattern: RegExp, from: number, to: number) {
  return [...row.text.matchAll(new RegExp(pattern.source, pattern.flags))]
    .filter((m) => m.index >= from && m.index + m[0].length <= to)
    .map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

function candidate<V>(
  row: Row,
  start: number,
  end: number,
  value: V | null,
  check: Check,
  tier: number,
  flags: Flag[] = [],
  detail?: string,
): Candidate<V> {
  const words = wordsIn(row, start, end);
  const confidence = confidenceOf(words);
  const all = confidence < UNSURE_BELOW ? [...flags, 'ocr-unsure' as const] : flags;
  return {
    value,
    text: row.text.slice(start, end),
    where: whereOf(words),
    check,
    ...(detail ? { detail } : {}),
    flags: all,
    confidence,
    tier,
  };
}

/** The row under `row` on the same page, if there is one close enough to be its value. */
function below(rows: Row[], index: number): Row | null {
  const next = rows[index + 1];
  const row = rows[index]!;
  if (!next || next.page !== row.page) return null;
  const top = Math.min(...row.words.map((w) => w.y1));
  const gap = Math.min(...next.words.map((w) => w.y0)) - top;
  return gap < 0.06 ? next : null;
}

/** Of a row's tokens, those that sit under the label's words. */
function underLabel<T extends { start: number; end: number }>(row: Row, found: T[], label: Where) {
  const under = found.filter((token) => {
    const words = wordsIn(row, token.start, token.end);
    const x0 = Math.min(...words.map((w) => w.x0));
    const x1 = Math.max(...words.map((w) => w.x1));
    return x1 >= label.x0 - 0.05 && x0 <= label.x1 + 0.05;
  });
  return under;
}

/** Candidates merged by value: the strongest label and the first place win. */
function distinct<V>(found: Candidate<V>[], key: (value: V | null, text: string) => string) {
  const byValue = new Map<string, Candidate<V>>();
  for (const one of found) {
    const k = key(one.value, one.text);
    const have = byValue.get(k);
    if (!have || one.tier < have.tier) byValue.set(k, one);
  }
  return [...byValue.values()].sort(
    (a, b) =>
      a.tier - b.tier ||
      (b.check === 'passed' ? 1 : 0) - (a.check === 'passed' ? 1 : 0) ||
      a.where.page - b.where.page ||
      a.where.y0 - b.where.y0,
  );
}

function settle<V>(sorted: Candidate<V>[], rivals: (c: Candidate<V>) => boolean): FieldReading<V> {
  if (sorted.length === 0) return { status: 'missing', candidates: [] };
  const best = sorted.filter(rivals);
  const sure =
    best.length === 1 && best[0]!.value !== null && !best[0]!.flags.includes('format-unsure');
  return { status: sure ? 'found' : 'ask', candidates: sorted };
}

// -- total ------------------------------------------------------------------------------------

function readTotal(rows: Row[]): FieldReading<bigint> {
  const found: Candidate<bigint>[] = [];
  TOTAL_TIERS.forEach((pattern, t) => {
    const tier = t + 1;
    for (const hit of hits(rows, pattern)) {
      const stop = windowEnd(hit.row, hit.end);
      const context = hit.row.text.slice(hit.start, stop);
      if (NOT_A_TOTAL.test(context)) continue;
      if (MENTIONS_VAT.test(context) && !INCLUDING.test(context)) continue;
      let row = hit.row;
      let found_ = tokens(row, AMOUNT, hit.end, stop);
      const flags: Flag[] = tier >= 3 ? ['weak-label'] : [];
      if (found_.length === 0 && tier === 1) {
        // The value under its label, as on a form that prints small headings over big figures.
        const next = below(rows, hit.index);
        if (!next) continue;
        const label = whereOf(wordsIn(hit.row, hit.start, hit.end));
        found_ = underLabel(next, tokens(next, AMOUNT, 0, next.text.length), label);
        row = next;
        flags.push('below-label');
      }
      const token = found_[found_.length - 1];
      if (!token) continue;
      const parsed = parseAmount(token.text);
      if (parsed.status === 'invalid') continue;
      const value = parsed.status === 'ok' ? parsed.minor : parsed.candidates[0]!;
      const unsure: Flag[] = parsed.status === 'ask' ? ['format-unsure'] : [];
      found.push(
        candidate(row, token.start, token.end, value, 'none', tier, [...flags, ...unsure]),
      );
    }
  });
  const sorted = distinct(found, (value) => String(value));
  // Rivals: other amounts that share the strongest label's tier.
  return settle(sorted, (c) => c.tier === sorted[0]!.tier);
}

// -- due date ---------------------------------------------------------------------------------

function readDueDate(rows: Row[]): FieldReading<string> {
  const found: Candidate<string>[] = [];
  DUE_TIERS.forEach((pattern, t) => {
    const tier = t + 1;
    for (const hit of hits(rows, pattern)) {
      const stop = windowEnd(hit.row, hit.end);
      let row = hit.row;
      let dates = tokens(row, DATE_IN_TEXT, hit.end, stop);
      const flags: Flag[] = [];
      if (dates.length === 0) {
        const next = below(rows, hit.index);
        if (!next) continue;
        const label = whereOf(wordsIn(hit.row, hit.start, hit.end));
        dates = underLabel(next, tokens(next, DATE_IN_TEXT, 0, next.text.length), label);
        row = next;
        flags.push('below-label');
      }
      const date = dates[0];
      if (!date) continue;
      const parsed = parseDate(date.text);
      if (parsed.status === 'invalid') {
        found.push(candidate<string>(row, date.start, date.end, null, 'failed', tier, flags));
      } else if (parsed.status === 'ok') {
        found.push(candidate(row, date.start, date.end, parsed.iso, 'none', tier, flags));
      } else {
        for (const iso of parsed.candidates) {
          found.push(
            candidate(row, date.start, date.end, iso, 'none', tier, [...flags, 'format-unsure']),
          );
        }
      }
    }
  });
  const sorted = distinct(found, (value, text) => value ?? `?${text}`);
  return settle(sorted, (c) => c.tier === sorted[0]!.tier);
}

// -- bank number ------------------------------------------------------------------------------

const BANKGIRO_NUMBER = /(?<![\d-])(?:\d{3,4}[- ]\d{4}|\d{7,8})(?![\d]|-\d)/gu;
const PLUSGIRO_NUMBER = /(?<![\d-])\d(?:[ ]?\d){0,6}-\d(?!\d)/gu;
const IBAN_START = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}/gu;

function readBank(rows: Row[]): FieldReading<Bank> {
  const found: Candidate<Bank>[] = [];
  const giro = (pattern: RegExp, number: RegExp, method: 'bankgiro' | 'plusgiro') => {
    for (const hit of hits(rows, pattern)) {
      const stop = windowEnd(hit.row, hit.end);
      const first = tokens(hit.row, number, hit.end, stop)[0];
      if (!first) continue;
      const checked = method === 'bankgiro' ? checkBankgiro(first.text) : checkPlusgiro(first.text);
      found.push(
        candidate(
          hit.row,
          first.start,
          first.end,
          { method, account: checked.value },
          checked.check,
          1,
        ),
      );
    }
  };
  giro(BANKGIRO, BANKGIRO_NUMBER, 'bankgiro');
  giro(PLUSGIRO, PLUSGIRO_NUMBER, 'plusgiro');

  for (const row of rows) {
    for (const start of row.text.matchAll(IBAN_START)) {
      const country = start[0].slice(0, 2);
      const length = IBAN_LENGTHS[country];
      const labelled = /iban\W{0,3}$/iu.test(
        row.text.slice(Math.max(0, start.index - 8), start.index),
      );
      if (!length && !labelled) continue;
      // Take exactly the country's length in characters, spaces skipped: a BIC after it is not IBAN.
      let compact = '';
      let end = start.index;
      for (let i = start.index; i < row.text.length && compact.length < (length ?? 34); i += 1) {
        const char = row.text[i]!;
        if (char === ' ') {
          if (!/^[A-Za-z0-9]/.test(row.text.slice(i + 1))) break;
          continue;
        }
        if (!/[A-Za-z0-9]/.test(char)) break;
        compact += char;
        end = i + 1;
      }
      const checked = checkIban(compact);
      if (!labelled && checked.check !== 'passed') continue;
      found.push(
        candidate(
          row,
          start.index,
          end,
          { method: 'iban', account: checked.value },
          checked.check,
          1,
        ),
      );
    }
  }

  const sorted = distinct(
    found,
    (value) => `${value?.method}:${value?.account.replace(/\D/g, '')}`,
  );
  // A failed reading beside a passed one of the same kind is that number misread, not a rival.
  const kept = sorted.filter(
    (c) =>
      c.check === 'passed' ||
      !sorted.some((o) => o.check === 'passed' && o.value?.method === c.value?.method),
  );
  return {
    status: kept.length === 1 ? 'found' : kept.length === 0 ? 'missing' : 'ask',
    candidates: kept,
  };
}

// -- payment reference --------------------------------------------------------------------------

/** Words further apart than this are different columns, not one number printed in groups. */
const GAP = 0.03;

function readReference(rows: Row[]): FieldReading<PaymentReference> {
  const found: Candidate<PaymentReference>[] = [];
  for (const [pattern, tier] of [
    [REFERENCE_STRONG, 1],
    [REFERENCE_WEAK, 2],
  ] as const) {
    for (const hit of hits(rows, pattern)) {
      if (PERSON_REFERENCE.test(hit.row.text.slice(0, hit.start))) continue;
      const stop = windowEnd(hit.row, hit.end);
      const after = hit.row.words.filter(
        (_, i) => hit.row.spans[i]!.start >= hit.end && hit.row.spans[i]!.end <= stop,
      );
      const run: PayableWord[] = [];
      for (const word of after) {
        if (run.length === 0 && /^[:.\-–#]+$/u.test(word.text)) continue;
        const last = run[run.length - 1];
        if (last && word.x0 - last.x1 > GAP) break;
        run.push(word);
        if (run.length === 8) break;
      }
      const first = run[0];
      if (!first) continue;
      const asRow = (n: number) => {
        const used = run.slice(0, n);
        const start = hit.row.words.indexOf(used[0]!);
        const last = hit.row.words.indexOf(used[used.length - 1]!);
        return { start: hit.row.spans[start]!.start, end: hit.row.spans[last]!.end };
      };

      const rf =
        /^RF\d{2}/iu.test(first.text) ||
        (/^RF$/iu.test(first.text) && run[1] && /^\d{2}/.test(run[1].text));
      const digits = /^\d+$/.test(first.text);
      const garbled =
        !rf &&
        !digits &&
        /^\d[\dA-Za-z]*$/.test(first.text) &&
        first.text.replace(/\D/g, '').length >= 4;
      if (rf || digits) {
        // A PDF's text layer prints an RF reference as one item ("RF18539007547034"); optical
        // reading splits it in groups of four. The first word may therefore be the whole of it.
        const ok = (w: PayableWord, i: number) =>
          (rf ? (i === 0 ? /^[A-Za-z0-9]{1,25}$/ : /^[A-Za-z0-9]{1,8}$/) : /^\d+$/).test(w.text);
        let n = 0;
        while (n < run.length && ok(run[n]!, n)) n += 1;
        // The longest stretch that is a reference: its check digits hold, length digit first.
        let best = 0;
        let rank = -1;
        for (let k = 1; k <= n; k += 1) {
          const checked = checkReference(
            run
              .slice(0, k)
              .map((w) => w.text)
              .join(' '),
          );
          const score = checked.check !== 'passed' ? 0 : checked.detail === 'luhn' ? 1 : 2;
          if (score > 0 && score >= rank) {
            best = k;
            rank = score;
          }
        }
        // Never zero words: `rf` or `digits` matched the first word, so it is at least that one.
        const take = best || n || 1;
        const span = asRow(take);
        const checked = checkReference(
          run
            .slice(0, take)
            .map((w) => w.text)
            .join(' '),
        );
        found.push(
          candidate(
            hit.row,
            span.start,
            span.end,
            { kind: checked.kind, value: checked.value },
            checked.check,
            tier,
            [],
            checked.detail,
          ),
        );
      } else if (garbled) {
        const span = asRow(1);
        found.push(
          candidate(
            hit.row,
            span.start,
            span.end,
            { kind: 'ocr', value: first.text },
            'failed',
            tier,
          ),
        );
      } else if (tier === 1) {
        const span = asRow(Math.min(run.length, 4));
        const text = hit.row.text.slice(span.start, span.end);
        found.push(
          candidate(hit.row, span.start, span.end, { kind: 'text', value: text }, 'none', tier),
        );
      }
    }
  }
  const sorted = distinct(found, (value) => value?.value.replace(/\s/g, '') ?? '');
  const kept = sorted.filter(
    (c) => c.check === 'passed' || !sorted.some((o) => o.check === 'passed'),
  );
  return {
    status: kept.length === 1 ? 'found' : kept.length === 0 ? 'missing' : 'ask',
    candidates: kept,
  };
}

// -- VAT ------------------------------------------------------------------------------------------

function readVat(rows: Row[]): FieldReading<bigint> {
  const found: Candidate<bigint>[] = [];
  for (const hit of hits(rows, VAT)) {
    const stop = windowEnd(hit.row, hit.end);
    const context = hit.row.text.slice(hit.start, stop);
    // "Summa exkl. moms 12 000,00" is the amount before tax, not the tax.
    if (NOT_A_TOTAL.test(hit.row.text.slice(0, hit.end))) continue;
    if (INCLUDING.test(context) || INCLUDING.test(hit.row.text.slice(0, hit.start).slice(-14)))
      continue;
    // The figure with its öre: a bare "25" beside a rate is not an amount of tax.
    const amounts = tokens(hit.row, AMOUNT, hit.end, stop).filter((t) =>
      /[.,]\d{1,2}$/.test(t.text),
    );
    const token = amounts[amounts.length - 1];
    if (!token) continue;
    const parsed = parseAmount(token.text);
    if (parsed.status !== 'ok') continue;
    found.push(candidate(hit.row, token.start, token.end, parsed.minor, 'none', 1));
  }
  const sorted = distinct(found, (value) => String(value));
  return {
    status: sorted.length === 0 ? 'missing' : sorted.length === 1 ? 'found' : 'ask',
    candidates: sorted,
  };
}

// -- currency ---------------------------------------------------------------------------------------

const ISO = /(?<![\p{L}])(SEK|NOK|DKK|EUR|USD|GBP|CHF)(?![\p{L}])/gu;
const KRONA = /(?<![\p{L}])kr(?:\.|onor)?(?![\p{L}])|\d\s?:-/giu;
const SYMBOL: Record<string, string> = { '€': 'EUR', '£': 'GBP' };

function readCurrency(
  rows: Row[],
  total: FieldReading<bigint>,
  bank: FieldReading<Bank>,
): FieldReading<string> {
  const printed = rows.flatMap((row) =>
    tokens(row, ISO, 0, row.text.length).map((t) => ({ row, ...t })),
  );
  const make = (found: (typeof printed)[number], flags: Flag[] = []) =>
    candidate<string>(found.row, found.start, found.end, found.text, 'none', 1, flags);

  // 1. A code on the total's own row.
  const at = total.candidates[0]?.where;
  if (at) {
    const centre = (at.y0 + at.y1) / 2;
    const near = printed.filter(({ row }) => {
      const w = row.words[0]!;
      const rowCentre = row.words.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / row.words.length;
      return w.page === at.page && Math.abs(rowCentre - centre) < at.y1 - at.y0;
    });
    const codes = [...new Set(near.map((n) => n.text))];
    if (codes.length === 1) return { status: 'found', candidates: [make(near[0]!)] };
  }
  // 2. Any code the page prints.
  const codes = [...new Set(printed.map((p) => p.text))];
  if (codes.length >= 1) {
    const sorted = distinct(
      printed.map((p) => make(p)),
      (value) => value ?? '',
    );
    return { status: codes.length === 1 ? 'found' : 'ask', candidates: sorted };
  }
  // 3. A symbol, or "kr".
  for (const row of rows) {
    for (const m of row.text.matchAll(/[€£]/gu)) {
      const hit = { row, text: SYMBOL[m[0]]!, start: m.index, end: m.index + 1 };
      return { status: 'found', candidates: [make(hit, ['inferred'])] };
    }
  }
  for (const row of rows) {
    for (const m of row.text.matchAll(KRONA)) {
      const accounts = bank.candidates.map((c) => c.value).filter(Boolean);
      const countries = new Set(
        accounts.map((a) =>
          a!.method === 'iban'
            ? ({ SE: 'SEK', DK: 'DKK', NO: 'NOK' }[a!.account.slice(0, 2)] ?? '')
            : 'SEK',
        ),
      );
      countries.delete('');
      const options = countries.size > 0 ? [...countries] : ['SEK', 'DKK', 'NOK'];
      const place = {
        row,
        start: m.index + (m[0].match(/^\d/) ? 1 : 0),
        end: m.index + m[0].length,
      };
      const sorted = options.map((code) => make({ ...place, text: code }, ['inferred']));
      return { status: options.length === 1 ? 'found' : 'ask', candidates: sorted };
    }
  }
  return { status: 'missing', candidates: [] };
}

export function readInvoice(words: readonly PayableWord[]): InvoiceReading {
  const rows = rowsOf(words);
  const total = readTotal(rows);
  const bank = readBank(rows);
  return {
    total,
    currency: readCurrency(rows, total, bank),
    dueDate: readDueDate(rows),
    bank,
    reference: readReference(rows),
    vat: readVat(rows),
  };
}
