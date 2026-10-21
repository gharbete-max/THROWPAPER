import { describe, expect, it } from 'vitest';
import {
  checkCampaign,
  mergeCampaign,
  normaliseAddress,
  renderCampaign,
  uniqueRecipients,
} from './campaign.js';
import {
  MERGE_FIELDS,
  checkBatch,
  guessColumns,
  mergeText,
  oneLine,
  parseBasisPoints,
  parseMinor,
  parseTable,
  rowsFrom,
  type BatchRow,
} from './send.js';

/**
 * Property tests for the Send list: amounts, the pasted/uploaded table, merge fields, campaigns.
 * Seeded and dependency-free; a failure names the seed and the case, and
 * `FUZZ_SEED=<n> pnpm vitest run <file>` replays it.
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
  };
}
type Rng = ReturnType<typeof prng>;
const at = (name: string, i: number) => `seed=${SEED} ${name} case=${i}`;
const text = (r: Rng, alphabet: readonly string[], low: number, high: number) =>
  Array.from({ length: r.int(low, high) }, () => r.pick(alphabet)).join('');

describe('amounts in a list', () => {
  it('print then parse is exact, in every national style, with a currency word around it', () => {
    const r = prng(SEED);
    for (let i = 0; i < 4000; i += 1) {
      const minor = BigInt(r.int(0, 99_999_999)) * BigInt(r.int(1, 9)) + BigInt(r.int(0, 99));
      const whole = (minor / 100n).toString();
      const cents = (minor % 100n).toString().padStart(2, '0');
      const group = (sep: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
      const printed = r.pick([
        `${group(' ')},${cents}`,
        `${group('.')},${cents}`,
        `${group(',')}.${cents}`,
        `${whole}.${cents}`,
        `${whole},${cents}`,
        `${group(' ')},${cents}`,
      ]);
      const dressed = r.pick([printed, `${printed} kr`, `SEK ${printed}`, ` ${printed} `]);
      expect(parseMinor(dressed), at(JSON.stringify(dressed), i)).toBe(minor);
    }
  });

  it('a minus sign is never dropped: a credit is refused wherever the sign sits', () => {
    const r = prng(SEED + 1);
    for (let i = 0; i < 1000; i += 1) {
      const n = `${r.int(1, 99999)},${String(r.int(0, 99)).padStart(2, '0')}`;
      for (const input of [
        `-${n}`,
        `−${n}`,
        `kr -${n}`,
        `SEK -${n}`,
        `${n}-`,
        `${n} -`,
        `- ${n}`,
      ]) {
        expect(parseMinor(input), at(JSON.stringify(input), i)).toBeNull();
      }
    }
  });

  it('garbage never throws and never yields a negative or absurd amount', () => {
    const r = prng(SEED + 2);
    const alphabet = [..."0123456789 .,'-−()krSEK:  eE+x%\n"];
    for (let i = 0; i < 6000; i += 1) {
      const input = text(r, alphabet, 0, 30);
      const minor = parseMinor(input);
      if (minor !== null) {
        expect(minor >= 0n, at(JSON.stringify(input), i)).toBe(true);
        expect(minor < 10n ** 14n, at(JSON.stringify(input), i)).toBe(true);
      }
      const bp = parseBasisPoints(input);
      if (bp !== null) expect(bp >= 0 && bp <= 10_000, at(JSON.stringify(input), i)).toBe(true);
    }
  });
});

describe('a pasted or uploaded table', () => {
  const MARKS = [',', ';', '\t'] as const;
  const CELL = [...'abcXYZ 012,;"\t\n\r=+-@åäö\u{1F600} '];

  /** RFC 4180: a cell is quoted when it holds the mark, a quote or a line break. */
  function serialise(rows: string[][], mark: string, eol: string): string {
    return rows
      .map((row) =>
        row
          .map((cell) =>
            /["\r\n]/.test(cell) || cell.includes(mark) ? `"${cell.replace(/"/g, '""')}"` : cell,
          )
          .join(mark),
      )
      .join(eol);
  }

  it('what is written in RFC 4180 is read back cell for cell (BOM, CRLF, any mark)', () => {
    const r = prng(SEED + 3);
    for (let i = 0; i < 1500; i += 1) {
      const columns = r.int(2, 6);
      const mark = r.pick(MARKS);
      // The header decides the mark: plain words, so it carries the most of it on its own line.
      const header = Array.from({ length: columns }, (_, c) => `col${c}`);
      const body = Array.from({ length: r.int(0, 8) }, () =>
        Array.from({ length: columns }, () => text(r, CELL, 0, 12)),
      );
      const expected = [header, ...body].filter((row) => row.some((cell) => cell.trim() !== ''));
      const eol = r.pick(['\n', '\r\n']);
      const bom = r.next() < 0.3 ? '﻿' : '';
      const written = bom + serialise([header, ...body], mark, eol);
      expect(parseTable(written), at(JSON.stringify(written), i)).toEqual(expected);
    }
  });

  it('never throws, never loops, and every cell it returns came from the input', () => {
    const r = prng(SEED + 4);
    const alphabet = [...'ab ,;\t"\r\n﻿=\u0000é'];
    for (let i = 0; i < 4000; i += 1) {
      const input = text(r, alphabet, 0, 60);
      const rows = parseTable(input);
      for (const row of rows) {
        expect(
          row.some((cell) => cell.trim() !== ''),
          at('blank row kept', i),
        ).toBe(true);
        for (const cell of row) {
          // Quotes can only shorten a cell, never invent characters.
          expect(input.length >= cell.length, at(JSON.stringify(input), i)).toBe(true);
        }
      }
    }
  });

  it('a huge row and a huge file are linear: no cell, column or row count breaks it', () => {
    const wide = Array.from({ length: 5000 }, (_, i) => `c${i}`).join(';');
    expect(parseTable(wide)[0]).toHaveLength(5000);

    const bigCell = `name,email\n"${'x'.repeat(2_000_000)}",a@example.com`;
    const started = Date.now();
    const rows = parseTable(bigCell);
    expect(rows[1]![0]).toHaveLength(2_000_000);

    const many = ['name,email', ...Array.from({ length: 100_000 }, (_, i) => `n${i},e${i}@x.se`)];
    expect(parseTable(many.join('\r\n'))).toHaveLength(100_001);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('an unterminated quote swallows the rest as one cell instead of failing', () => {
    expect(parseTable('a,b\n"open,1\n2,3')).toEqual([['a', 'b'], ['open,1\n2,3']]);
  });

  it('cells that would start a formula in a spreadsheet are carried verbatim (they are not defused here)', () => {
    const rows = parseTable('name,email\n=HYPERLINK("http://x"),a@example.com');
    expect(rows[1]![0]).toBe('=HYPERLINK("http://x")');
    // They only ever reach an email, a PDF or this screen, never a spreadsheet, so nothing to defuse.
    const [mapped] = rowsFrom(rows.slice(1), guessColumns(rows[0]!));
    expect(mapped!.name).toBe('=HYPERLINK("http://x")');
  });

  it('guessColumns never maps two fields to one column and never points outside the header', () => {
    const r = prng(SEED + 5);
    const words = [
      'name',
      'email',
      'e-post',
      'amount',
      'belopp',
      'reference',
      'ref',
      'x',
      'total',
      '',
    ];
    for (let i = 0; i < 1500; i += 1) {
      const header = Array.from({ length: r.int(0, 8) }, () => r.pick(words));
      const map = guessColumns(header);
      const used = Object.values(map).filter((index) => index >= 0);
      expect(new Set(used).size, at(JSON.stringify(header), i)).toBe(used.length);
      for (const index of used) expect(index < header.length, at('range', i)).toBe(true);
    }
  });
});

describe('merge fields', () => {
  const VALUES_ALPHABET = [..."abc $&`'$1$$ {{name}} \n"];

  it('fills every known field exactly once, leaves anything else, and never expands a value again', () => {
    const r = prng(SEED + 6);
    for (let i = 0; i < 2000; i += 1) {
      const values = {
        name: text(r, VALUES_ALPHABET, 0, 12),
        email: text(r, VALUES_ALPHABET, 0, 12),
        amount: text(r, VALUES_ALPHABET, 0, 12),
        reference: text(r, VALUES_ALPHABET, 0, 12),
      };
      const parts = Array.from({ length: r.int(0, 8) }, () =>
        r.pick([
          () => `{{${r.pick(MERGE_FIELDS)}}}`,
          () => `{{ ${r.pick(MERGE_FIELDS)} }}`,
          () => `{{${r.pick(['nope', 'unsubscribe', 'Name'])}}}`,
          () => text(r, [...'xyz $& $1 {} '], 0, 6),
        ])(),
      );
      let expected = '';
      for (const part of parts) {
        const known = /^\{\{\s*([A-Za-z]+)\s*\}\}$/.exec(part)?.[1];
        expected +=
          known && (MERGE_FIELDS as readonly string[]).includes(known)
            ? values[known as keyof typeof values]
            : part;
      }
      expect(mergeText(parts.join(''), values), at(JSON.stringify(parts), i)).toBe(expected);
    }
  });

  it('a subject made of a row is always one line, whatever the row holds', () => {
    const r = prng(SEED + 7);
    const alphabet = [
      ...['a', 'b', ' ', '\r', '\n', '\t', String.fromCharCode(0, 0x7f, 0x2028, 0x2029), 'é'].join(
        '',
      ),
    ];
    for (let i = 0; i < 3000; i += 1) {
      const line = oneLine(text(r, alphabet, 0, 30));
      expect(controls.test(line), at(JSON.stringify(line), i)).toBe(false);
      expect(line, at('trimmed', i)).toBe(line.trim());
      expect(oneLine(line), at('idempotent', i)).toBe(line);
    }
  });
});

const controls = new RegExp(`[\\u0000-\\u001f\\u007f${String.fromCharCode(0x2028, 0x2029)}]`);

describe('batch and campaign checks', () => {
  const row = (r: Rng, n: number): BatchRow => ({
    name: `Name ${n}`,
    email: `p${n}-${r.int(0, 999)}@example.com`,
    amount: `${r.int(1, 9999)},${String(r.int(0, 99)).padStart(2, '0')}`,
    reference: `ref${n}`,
  });
  const goodFooter = 'Sent by Club. You get this because you joined. Stop: {{unsubscribe}}';

  it('a clean campaign has no problems and renders with no token left', () => {
    const r = prng(SEED + 8);
    for (let i = 0; i < 400; i += 1) {
      const rows = Array.from({ length: r.int(1, 30) }, (_, n) => row(r, n));
      const subject = r.pick(['Hello {{name}}', 'News', 'Hi {{name | friend}}']);
      const body = r.pick(['Dear {{name}}, ref {{reference}}', 'Pay {{amount}} to {{email}}']);
      expect(checkCampaign(subject, body, goodFooter, rows), at('clean', i)).toEqual([]);
      for (const one of rows) {
        const sent = renderCampaign({ subject, body, footer: goodFooter }, one, 'https://x/u?t=1');
        expect(/\{\{/.test(sent.subject + sent.text), at(sent.text, i)).toBe(false);
        expect(sent.subject.includes('\n'), at('subject one line', i)).toBe(false);
        expect(sent.text.endsWith('\n'), at('ends', i)).toBe(true);
      }
    }
  });

  it('each way of breaking a campaign is named, and only that', () => {
    const r = prng(SEED + 9);
    const rows = [row(r, 1), row(r, 2)];
    const codes = (...args: Parameters<typeof checkCampaign>) =>
      checkCampaign(...args).map((p) => p.code);
    expect(codes('s', 'b', '', rows)).toEqual(['footer-missing']);
    expect(codes('s', 'b', '   ', rows)).toEqual(['footer-missing']);
    expect(codes('s', 'b', 'no link here', rows)).toEqual(['footer-no-link']);
    expect(codes('s', 'b', `[Your name] ${goodFooter}`, rows)).toEqual(['footer-placeholder']);
    expect(codes('s {{unsubscribe}}', 'b', goodFooter, rows)).toEqual(['unknown-field']);
    expect(codes('s {{nope}}', 'b', goodFooter, rows)).toEqual(['unknown-field']);
    expect(codes('s', 'b', goodFooter, [{ ...rows[0]!, email: 'not an address' }])).toEqual([
      'bad-email',
    ]);
    expect(codes('{{name}}', 'b', goodFooter, [{ ...rows[0]!, name: ' ' }])).toEqual([
      'empty-field',
    ]);
    // A fallback typed in the text is the answer to an empty value.
    expect(codes('{{name | friend}}', 'b', goodFooter, [{ ...rows[0]!, name: '' }])).toEqual([]);
  });

  it('garbage in any part never throws', () => {
    const r = prng(SEED + 10);
    const alphabet = [...'ab {}|[]\n\t{{name}}{{unsubscribe}}@.é'];
    for (let i = 0; i < 3000; i += 1) {
      const rows = Array.from({ length: r.int(0, 3) }, () => ({
        name: text(r, alphabet, 0, 6),
        email: text(r, alphabet, 0, 10),
        amount: text(r, alphabet, 0, 6),
        reference: text(r, alphabet, 0, 6),
      }));
      const [s, b, f] = [
        text(r, alphabet, 0, 30),
        text(r, alphabet, 0, 30),
        text(r, alphabet, 0, 40),
      ];
      expect(() => checkCampaign(s, b, f, rows), at('checkCampaign', i)).not.toThrow();
      expect(
        () =>
          checkBatch(
            { layout: 'invoice', locale: 'sv-SE', currency: 'SEK', title: s, body: b, vatRate: f },
            s,
            b,
            rows,
          ),
        at('checkBatch', i),
      ).not.toThrow();
      for (const one of rows) {
        expect(() => mergeCampaign(b, one, f), at('merge', i)).not.toThrow();
      }
    }
  });

  it('unique recipients keep the first of each address, in order, and are idempotent', () => {
    const r = prng(SEED + 11);
    for (let i = 0; i < 1500; i += 1) {
      const rows = Array.from({ length: r.int(0, 25) }, (_, n) => ({
        ...row(r, n),
        email: r.pick([
          'A@Example.com',
          'a@example.com',
          ' b@example.com ',
          'c@example.com',
          'bad',
          '',
        ]),
      }));
      const unique = uniqueRecipients(rows);
      const addresses = unique.map((one) => normaliseAddress(one.email));
      expect(new Set(addresses).size, at('distinct', i)).toBe(addresses.length);
      expect(uniqueRecipients(unique), at('idempotent', i)).toEqual(unique);
      for (const one of unique) {
        expect(
          rows.find((x) => normaliseAddress(x.email) === normaliseAddress(one.email)),
          at('first', i),
        ).toBe(one);
      }
    }
  });
});
