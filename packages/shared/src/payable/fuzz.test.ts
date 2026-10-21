import { describe, expect, it } from 'vitest';
import { buildOcr, isValidOcr } from '../invoicing/ocr.js';
import { parseAmount } from './amount.js';
import {
  checkBankgiro,
  checkIban,
  checkPlusgiro,
  checkReference,
  checkRf,
  IBAN_LENGTHS,
  luhnValid,
  normaliseBankgiro,
} from './checks.js';
import { parseDate } from './date.js';
import { readInvoice } from './read.js';
import { decimalOf, payableCsv, type ReviewedPayable } from './record.js';
import type { PayableWord } from './rows.js';

/**
 * Property tests with a seeded generator (no dependency, no clock, no Math.random).
 *
 * A failure names the seed and the case, and `FUZZ_SEED=<n> pnpm vitest run <file>` replays it.
 * Each property is a few thousand cases and the file runs in well under a second.
 */
const SEED = Number(process.env['FUZZ_SEED'] ?? 20261021);

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    digits: (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(''),
  };
}

const where = (name: string, i: number, seed = SEED) => `seed=${seed} ${name} case=${i}`;
const CASES = 1500;

/** Replaces one digit of `text` (at a digit position chosen by `r`) with a different digit. */
function mutateDigit(text: string, r: ReturnType<typeof prng>, from = 0): string {
  const at: number[] = [];
  for (let i = from; i < text.length; i += 1) if (/\d/.test(text[i]!)) at.push(i);
  const index = r.pick(at);
  const old = Number(text[index]);
  const replacement = (old + r.int(1, 9)) % 10;
  return text.slice(0, index) + String(replacement) + text.slice(index + 1);
}

const luhnDigit = (payload: string) => {
  for (let d = 0; d <= 9; d += 1) if (luhnValid(payload + String(d))) return String(d);
  throw new Error('no Luhn digit');
};

/** ISO 13616 / 11649 check digits: 98 - (number mod 97), the number made of digits and A=10…Z=35. */
function mod97Of(text: string): bigint {
  const digits = [...text].map((c) => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('');
  return BigInt(digits) % 97n;
}
const checkPair = (n: bigint) => String(98n - n).padStart(2, '0');

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

describe('check digits (seed-driven properties)', () => {
  it('a Luhn-valid bankgiro or plusgiro passes and any one-digit change fails', () => {
    const r = prng(SEED);
    for (let i = 0; i < CASES; i += 1) {
      const n = r.int(6, 7); // payload; the check digit makes it 7-8 long
      const payload = r.digits(n);
      const bankgiro = payload + luhnDigit(payload);
      expect(checkBankgiro(bankgiro).check, where('bankgiro valid', i)).toBe('passed');
      expect(checkBankgiro(normaliseBankgiro(bankgiro)).check, where('bankgiro printed', i)).toBe(
        'passed',
      );
      const broken = mutateDigit(bankgiro, r);
      expect(checkBankgiro(broken).check, where(`bankgiro ${bankgiro}->${broken}`, i)).toBe(
        'failed',
      );

      const plus = r.digits(r.int(1, 7));
      const plusgiro = plus + luhnDigit(plus);
      expect(checkPlusgiro(plusgiro).check, where('plusgiro valid', i)).toBe('passed');
      expect(checkPlusgiro(mutateDigit(plusgiro, r)).check, where('plusgiro mutated', i)).toBe(
        'failed',
      );
    }
  });

  it('a well-formed IBAN passes in every shape it is printed, and any one-digit change fails', () => {
    const r = prng(SEED + 1);
    const countries = Object.keys(IBAN_LENGTHS);
    for (let i = 0; i < CASES; i += 1) {
      const country = r.pick(countries);
      const bbanLength = IBAN_LENGTHS[country]! - 4;
      // Digits and capitals, the way real IBANs mix them (GB, NL, IT, FR have letters).
      const bban = Array.from({ length: bbanLength }, () =>
        r.next() < 0.7 ? String(r.int(0, 9)) : r.pick([...ALNUM.slice(10)]),
      ).join('');
      const iban = `${country}${checkPair(mod97Of(`${bban}${country}00`))}${bban}`;
      const spaced = iban.replace(/(.{4})/g, '$1 ').trim();

      expect(checkIban(iban).check, where(`iban ${iban}`, i)).toBe('passed');
      expect(checkIban(spaced).check, where(`iban spaced ${spaced}`, i)).toBe('passed');
      expect(checkIban(iban.toLowerCase()).check, where('iban lower', i)).toBe('passed');
      expect(checkIban(iban).value, where('iban printed', i)).toBe(spaced);

      const broken = mutateDigit(iban, r, 2);
      expect(checkIban(broken).check, where(`iban ${iban}->${broken}`, i)).toBe('failed');
      // A wrong length never passes, whatever the digits.
      expect(checkIban(iban + '0').check, where('iban long', i)).toBe('failed');
      expect(checkIban(iban.slice(0, -1)).check, where('iban short', i)).toBe('failed');
    }
  });

  it('an RF creditor reference passes and any one-digit change fails', () => {
    const r = prng(SEED + 2);
    for (let i = 0; i < CASES; i += 1) {
      const body = Array.from({ length: r.int(1, 21) }, () => r.pick([...ALNUM])).join('');
      const rf = `RF${checkPair(mod97Of(`${body}RF00`))}${body}`;
      expect(checkRf(rf).check, where(`rf ${rf}`, i)).toBe('passed');
      expect(checkReference(rf).kind, where('rf kind', i)).toBe('rf');
      expect(checkReference(rf).check, where('rf via reference', i)).toBe('passed');
      if (/\d/.test(rf.slice(2))) {
        const broken = mutateDigit(rf, r, 2);
        expect(checkRf(broken).check, where(`rf ${rf}->${broken}`, i)).toBe('failed');
      }
    }
  });

  it('an OCR number built with length control passes fully and any one-digit change fails', () => {
    const r = prng(SEED + 3);
    for (let i = 0; i < CASES; i += 1) {
      const ocr = buildOcr(r.digits(r.int(2, 23)));
      const read = checkReference(ocr);
      expect(read.kind, where('ocr kind', i)).toBe('ocr');
      expect(read.check, where(`ocr ${ocr}`, i)).toBe('passed');
      expect(read.detail, where(`ocr ${ocr} detail`, i)).toBe('luhn+length');
      expect(isValidOcr(ocr), where('isValidOcr agrees', i)).toBe(true);
      const broken = mutateDigit(ocr, r);
      expect(checkReference(broken).check, where(`ocr ${ocr}->${broken}`, i)).toBe('failed');
    }
  });

  it('random garbage never throws and never passes as a number it is not', () => {
    const r = prng(SEED + 4);
    const alphabet = [...'0123456789 -ABCDEFRSEabcxyz.,/  \t\n:€$ÅÄÖ\u{1F600}\u0000%'];
    for (let i = 0; i < CASES * 2; i += 1) {
      const text = Array.from({ length: r.int(0, 40) }, () => r.pick(alphabet)).join('');
      const calls = [
        () => checkBankgiro(text),
        () => checkPlusgiro(text),
        () => checkIban(text),
        () => checkRf(text),
        () => checkReference(text),
        () => normaliseBankgiro(text),
      ];
      for (const call of calls) expect(call, where(JSON.stringify(text), i)).not.toThrow();
      // Nothing that is not digits-and-capitals-by-the-book passes an IBAN check.
      if (!/^[A-Za-z]{2}\d{2}/.test(text.replace(/\s/g, ''))) {
        expect(checkIban(text).check, where(`iban garbage ${JSON.stringify(text)}`, i)).toBe(
          'failed',
        );
      }
    }
  });
});

describe('amounts and dates (seed-driven round trips)', () => {
  /** An amount as five different countries print it. */
  function printed(minor: bigint, r: ReturnType<typeof prng>): string {
    const whole = (minor / 100n).toString();
    const cents = (minor % 100n).toString().padStart(2, '0');
    const groups = (sep: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return r.pick([
      `${groups(' ')},${cents}`,
      `${groups('.')},${cents}`,
      `${groups(',')}.${cents}`,
      `${groups("'")}.${cents}`,
      `${whole},${cents}`,
      `${whole}.${cents}`,
      `${groups(' ')},${cents}`,
      `${groups(' ')},${cents}`,
    ]);
  }

  it('parse(print(x)) is x for every way of printing it, with or without a currency', () => {
    const r = prng(SEED + 5);
    for (let i = 0; i < CASES * 2; i += 1) {
      const minor = BigInt(r.int(0, 999_999)) * BigInt(r.pick([1, 1, 100, 10_000]) + r.int(0, 99));
      const text = printed(minor, r);
      const dressed = r.pick([text, `${text} kr`, `SEK ${text}`, `${text} EUR`, `€${text}`]);
      const parsed = parseAmount(dressed);
      expect(parsed, where(`amount ${JSON.stringify(dressed)}`, i)).toEqual({
        status: 'ok',
        minor,
      });
    }
  });

  it('a lone dot or comma before three digits is asked, never read as a decimal', () => {
    const r = prng(SEED + 6);
    for (let i = 0; i < 500; i += 1) {
      const before = String(r.int(1, 999));
      const after = r.digits(3);
      for (const mark of ['.', ',']) {
        const text = `${before}${mark}${after}`;
        expect(parseAmount(text), where(text, i)).toEqual({
          status: 'ask',
          candidates: [BigInt(before + after) * 100n],
        });
      }
    }
  });

  it('garbage in an amount never throws, and an ok amount is never negative', () => {
    const r = prng(SEED + 7);
    const alphabet = [..."0123456789 .,'’-−()kr:SEK   e+x"];
    for (let i = 0; i < CASES * 3; i += 1) {
      const text = Array.from({ length: r.int(0, 24) }, () => r.pick(alphabet)).join('');
      const result = parseAmount(text);
      expect(['ok', 'ask', 'invalid'], where(JSON.stringify(text), i)).toContain(result.status);
      if (result.status === 'ok') expect(result.minor >= 0n, where(text, i)).toBe(true);
      // A minus sign is never silently dropped from a number that goes on to be paid.
      if (result.status === 'ok' && /[-−]/.test(text.replace(/:-|,-/g, ''))) {
        expect.fail(where(`parseAmount read ${JSON.stringify(text)} as ${result.minor}`, i));
      }
    }
  });

  const MONTH_NAMES = [
    ['januari', 'January'],
    ['februari', 'February'],
    ['mars', 'March'],
    ['april', 'April'],
    ['maj', 'May'],
    ['juni', 'June'],
    ['juli', 'July'],
    ['augusti', 'August'],
    ['september', 'September'],
    ['oktober', 'October'],
    ['november', 'November'],
    ['december', 'December'],
  ] as const;

  it('a real calendar date is read back to the same ISO date from every written form', () => {
    const r = prng(SEED + 8);
    for (let i = 0; i < CASES * 2; i += 1) {
      const year = r.int(1990, 2099);
      const month = r.int(1, 12);
      const day = r.int(1, new Date(Date.UTC(year, month, 0)).getUTCDate());
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');

      for (const text of [
        iso,
        `${year}${mm}${dd}`,
        `${day}.${month}.${year}`,
        `${dd}.${mm}.${year}`,
      ]) {
        expect(parseDate(text), where(text, i)).toEqual({ status: 'ok', iso });
      }
      const [sv, en] = MONTH_NAMES[month - 1]!;
      expect(parseDate(`${day} ${sv} ${year}`), where(`${day} ${sv} ${year}`, i)).toEqual({
        status: 'ok',
        iso,
      });
      expect(parseDate(`${en} ${day}, ${year}`), where(`${en} ${day}, ${year}`, i)).toEqual({
        status: 'ok',
        iso,
      });

      // Day and month both possible either way round: asked, with both readings offered.
      const slash = parseDate(`${dd}/${mm}/${year}`);
      if (day <= 12 && day !== month) {
        expect(slash.status, where(`${dd}/${mm}/${year}`, i)).toBe('ask');
        if (slash.status === 'ask') expect(slash.candidates, where('candidates', i)).toContain(iso);
      } else {
        expect(slash, where(`${dd}/${mm}/${year}`, i)).toEqual({ status: 'ok', iso });
      }
    }
  });

  it('a day the calendar does not have is invalid, never corrected', () => {
    const r = prng(SEED + 9);
    for (let i = 0; i < 800; i += 1) {
      const year = r.int(1990, 2099);
      const month = r.int(1, 12);
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const day = r.int(last + 1, 39);
      const text = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      expect(parseDate(text), where(text, i)).toEqual({ status: 'invalid' });
      expect(parseDate(`${day}.${month}.${year}`), where(`${day}.${month}.${year}`, i)).toEqual({
        status: 'invalid',
      });
    }
  });

  it('garbage in a date never throws', () => {
    const r = prng(SEED + 10);
    const alphabet = [...'0123456789 ./-,stndrhoktbmaujlgpvecfrÅÄÖ :'];
    for (let i = 0; i < CASES * 2; i += 1) {
      const text = Array.from({ length: r.int(0, 30) }, () => r.pick(alphabet)).join('');
      expect(() => parseDate(text), where(JSON.stringify(text), i)).not.toThrow();
    }
  });
});

describe('reading a whole page of random words', () => {
  const VOCABULARY = [
    'Att',
    'betala',
    'Total',
    'Summa',
    'Amount',
    'due',
    'Förfallodatum',
    'Forfallodatum',
    'Due',
    'date',
    'Bankgiro',
    'Plusgiro',
    'IBAN',
    'OCR',
    'Referens',
    'Moms',
    'VAT',
    'kr',
    'SEK',
    'EUR',
    '1 234,56',
    '1234.56',
    '999999999999999999999,99',
    '2026-10-31',
    '31.10.2026',
    '5555-5555',
    'SE45 5000 0000 0583 9825 7466',
    'RF18 5390 0754 7034',
    '1234567890',
    '-',
    ':',
    '',
    ' ',
    '€',
  ];

  it('never throws, and anything it calls found is a non-negative amount or a real date', () => {
    const r = prng(SEED + 11);
    for (let i = 0; i < 400; i += 1) {
      const words: PayableWord[] = Array.from({ length: r.int(0, 60) }, () => {
        const x0 = r.next();
        const y0 = r.next();
        return {
          page: r.int(0, 2),
          text: r.pick(VOCABULARY),
          x0,
          y0,
          x1: x0 + r.next() * 0.2,
          y1: y0 + r.next() * 0.05,
          confidence: r.int(0, 100),
        };
      });
      let reading: ReturnType<typeof readInvoice> | undefined;
      expect(() => (reading = readInvoice(words)), where('readInvoice', i)).not.toThrow();
      for (const candidate of reading!.total.candidates) {
        if (candidate.value !== null) expect(candidate.value >= 0n, where('total', i)).toBe(true);
      }
      for (const candidate of reading!.dueDate.candidates) {
        if (candidate.value !== null)
          expect(candidate.value, where('date', i)).toMatch(/^\d{4}-\d\d-\d\d$/);
      }
    }
  });
});

describe('the kept record', () => {
  const base: ReviewedPayable = {
    version: 1,
    total: '12345',
    currency: 'SEK',
    dueDate: '2026-10-31',
    bank: { method: 'bankgiro', account: '5555-5555' },
    reference: { kind: 'ocr', value: '1234567890' },
    vat: null,
    keptDespiteFailedCheck: [],
    reviewedAt: '2026-10-21T08:00:00.000Z',
  };

  it('decimalOf is exact for any bigint-sized amount', () => {
    const r = prng(SEED + 12);
    for (let i = 0; i < CASES; i += 1) {
      const digits = r.digits(r.int(1, 18)).replace(/^0+(?=\d)/, '');
      const text = decimalOf(digits);
      expect(text, where(digits, i)).toMatch(/^\d+\.\d\d$/);
      expect(BigInt(text.replace('.', '')), where(digits, i)).toBe(BigInt(digits));
    }
  });

  it('no cell of the CSV can start a formula, whatever the reference or account holds', () => {
    const r = prng(SEED + 13);
    const starts = ['=', '+', '-', '@', '\t', '\r'];
    for (let i = 0; i < 300; i += 1) {
      const evil = `${r.pick(starts)}${r.pick(['SUM(A1)', 'cmd|calc', 'HYPERLINK("x")'])}`;
      const csv = payableCsv({
        ...base,
        bank: { method: 'bankgiro', account: evil },
        reference: { kind: 'text', value: evil },
      });
      // Every cell, read as a spreadsheet would: split on commas outside quotes, per line.
      const cells = csv
        .trimEnd()
        .split('\n')[1]!
        .match(/("([^"]|"")*"|[^,]*)(,|$)/g)!
        .map((cell) => cell.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      for (const cell of cells) {
        expect(/^[=+\-@\t\r]/.test(cell), where(`cell ${JSON.stringify(cell)}`, i)).toBe(false);
      }
    }
  });

  it('a negative total (a credit note) stays a number in the CSV', () => {
    const csv = payableCsv({ ...base, total: '-12345' });
    // The amount column must still parse as a number, not be turned into the text '-123.45.
    expect(csv.split('\n')[1]!.split(',')[0]).toBe('-123.45');
  });
});
