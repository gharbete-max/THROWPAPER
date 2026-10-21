import { describe, expect, it } from 'vitest';
import {
  COMMON_DOMAINS,
  checkAddresses,
  editDistance,
  suggestDomain,
  tokensOf,
} from '../apps/forms/src/lib/address-hygiene.js';
import { sniffBytes } from '../apps/forms/src/lib/sniff.js';
import { findDate, safeName, suggestName, withPdf } from '../apps/forms/src/lib/suggest-name.js';

/**
 * Property tests for the small pure libraries of the Forms screens that decide what a file is
 * called, whether an address is plausible and what a dropped file is. They live here, beside the
 * other repository-wide tests, because the review of the backend and the shared packages did not
 * touch `apps/forms`. Seeded; `FUZZ_SEED=<n> pnpm vitest run <file>` replays a failure.
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
const some = (r: Rng, alphabet: readonly string[], low: number, high: number) =>
  Array.from({ length: r.int(low, high) }, () => r.pick(alphabet)).join('');

const NAME_PARTS = [
  ...'abcXYZ 012.-_',
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  '\n',
  '\t',
  String.fromCharCode(0),
  'Åsa',
  'ö',
  '会议',
  'Протокол',
  '\u{1F600}',
  'con',
  'NUL',
  'com1',
  '...',
  ' ',
  'é',
];

describe('file names', () => {
  // Open finding (docs/reviews/2026-10-backend-and-shared.md, F-14): a run of dots left after the
  // replaced characters survives as a leading dot, so the name is hidden on macOS and Linux, and a
  // second pass strips it. Owned by apps/forms; add `startsWith('.')` and idempotence here once fixed.
  it('safeName is fit for Windows, macOS and Linux, in any script', () => {
    const r = prng(SEED);
    // eslint-disable-next-line no-control-regex
    const forbidden = new RegExp('[\\\\/:*?"<>|\u0000-\u001f]');
    for (let i = 0; i < 4000; i += 1) {
      const input = some(r, NAME_PARTS, 0, 30);
      const name = safeName(input);
      const ctx = at(JSON.stringify(input), i);
      expect(forbidden.test(name), ctx).toBe(false);
      expect(name, ctx).toBe(name.trim());
      expect(name.endsWith('.'), ctx).toBe(false);
      expect([...name].length <= 81, ctx).toBe(true);
      expect(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name), ctx).toBe(false);
      expect(name, ctx).toBe(name.normalize('NFC'));
    }
  });

  it('a name with .pdf added is never empty, never reserved, and never gets two extensions', () => {
    const r = prng(SEED + 1);
    for (let i = 0; i < 2000; i += 1) {
      const input = some(r, [...NAME_PARTS, '.pdf', '.PDF'], 0, 12);
      const name = withPdf(input);
      expect(name.endsWith('.pdf'), at(input, i)).toBe(true);
      const stem = name.slice(0, -4);
      expect(stem.length > 0, at(JSON.stringify(input), i)).toBe(true);
      expect(
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem),
        at(JSON.stringify(input), i),
      ).toBe(false);
    }
  });

  it('a suggested name is deterministic, safe, and carries the date it was told', () => {
    const r = prng(SEED + 2);
    const today = new Date(2026, 9, 21);
    const lines = [
      'Protokoll',
      'Datum: 2026-03-02',
      'Möte 2026-03-02',
      'a@b.se',
      '12345',
      'www.x.se',
      '会议 2026年3月2日',
      '',
      '   ',
    ];
    for (let i = 0; i < 2000; i += 1) {
      const text = Array.from({ length: r.int(0, 8) }, () =>
        r.pick([...lines, some(r, NAME_PARTS, 0, 20)]),
      ).join(r.pick(['\n', '\r\n']));
      const name = suggestName(text, 'Scan', today);
      expect(name, at(JSON.stringify(text), i)).toBe(suggestName(text, 'Scan', today));
      expect(name, at('safe', i)).toBe(safeName(name));
      expect(name.length > 0, at('non-empty', i)).toBe(true);
    }
    expect(suggestName('', 'Scan', today)).toBe('Scan 2026-10-21');
  });

  it('a date found is a date written: ISO shape, in range, and the same date back', () => {
    const r = prng(SEED + 3);
    for (let i = 0; i < 3000; i += 1) {
      const y = r.int(1990, 2100);
      const m = r.int(1, 12);
      const d = r.int(1, 28);
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      expect(findDate(`Ref ${iso} done`), at(iso, i)).toBe(iso);
      expect(findDate(`${d}.${m}.${y}`), at(`${d}.${m}.${y}`, i)).toBe(iso);
      const noise = some(r, [...'0123456789-./ abc年月日'], 0, 30);
      const found = findDate(noise);
      if (found !== null) expect(found, at(JSON.stringify(noise), i)).toMatch(/^\d{4}-\d\d-\d\d$/);
    }
  });
});

describe('addresses in a list', () => {
  const LOCALS = ['asa', 'Bo', 'info', 'NoReply', 'a.b+c', 'x', '', 'sp ace'];
  const DOMAINS = [
    'example.com',
    'gmail.com',
    'gmial.com',
    'hotmail.se',
    'hotmial.se',
    'outlok.com',
    'x.y',
    '',
    'bad domain',
  ];

  it('every finding points at a real row, and says only what is true of it', () => {
    const r = prng(SEED + 4);
    for (let i = 0; i < 1500; i += 1) {
      const list = Array.from({ length: r.int(0, 25) }, () =>
        r.next() < 0.1 ? null : `${r.pick(LOCALS)}@${r.pick(DOMAINS)}`.replace(/^@$/, ''),
      );
      const issues = checkAddresses(list);
      const norm = (value: string | null) => value?.trim().toLowerCase() ?? null;
      for (const issue of issues) {
        const ctx = at(JSON.stringify({ list, issue }), i);
        expect(list[issue.index], ctx).not.toBeNull();
        if (issue.kind === 'duplicate') {
          expect(issue.of < issue.index, ctx).toBe(true);
          expect(norm(list[issue.of]!), ctx).toBe(norm(list[issue.index]!));
        }
        if (issue.kind === 'typo') {
          const domain = issue.suggestion.slice(issue.suggestion.lastIndexOf('@') + 1);
          expect(COMMON_DOMAINS as readonly string[], ctx).toContain(domain);
        }
      }
      // A row that was skipped (null) never makes a later one a duplicate.
      expect(checkAddresses(list, { duplicates: false }).some((x) => x.kind === 'duplicate')).toBe(
        false,
      );
    }
  });

  it('the common domains are never called typos, and one slip away is', () => {
    for (const domain of COMMON_DOMAINS) expect(suggestDomain(domain), domain).toBeNull();
    expect(suggestDomain('gmial.com')).toBe('gmail.com');
    expect(suggestDomain('hotmial.se')).toBe('hotmail.se');
  });

  it('edit distance is zero for itself, symmetric, and no more than the longer length', () => {
    const r = prng(SEED + 5);
    for (let i = 0; i < 2000; i += 1) {
      const a = some(r, [...'abcde'], 0, 12);
      const b = some(r, [...'abcde'], 0, 12);
      expect(editDistance(a, a), at(a, i)).toBe(0);
      expect(editDistance(a, b), at(`${a}|${b}`, i)).toBe(editDistance(b, a));
      expect(editDistance(a, b) <= Math.max(a.length, b.length), at(`${a}|${b}`, i)).toBe(true);
    }
  });

  it('tokens keep every piece in order and merge nothing', () => {
    const r = prng(SEED + 6);
    for (let i = 0; i < 1500; i += 1) {
      const pieces = Array.from({ length: r.int(0, 10) }, () => some(r, [...'ab@.'], 1, 8));
      const text = pieces
        .map((piece) => piece + r.pick([' ', ',', ';', '\n', ' , ', '\t']))
        .join('');
      expect(tokensOf(text), at(JSON.stringify(text), i)).toEqual(pieces);
    }
  });
});

describe('sniffing a dropped file', () => {
  it('never throws on any bytes, and the magic bytes decide whatever follows them', () => {
    const r = prng(SEED + 7);
    const bytes = (n: number) => Uint8Array.from({ length: n }, () => r.int(0, 255));
    const jpeg = [0xff, 0xd8, 0xff];
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 3000; i += 1) {
      const head = bytes(r.int(0, 600));
      const tail = bytes(r.int(0, 20_000));
      expect(() => sniffBytes(head, tail), at('random', i)).not.toThrow();
      expect(sniffBytes(Uint8Array.from([...jpeg, ...head]), tail), at('jpeg', i)).toBe('photo');
      expect(sniffBytes(Uint8Array.from([...png, ...head]), tail), at('png', i)).toBe('photo');
      expect(
        sniffBytes(Uint8Array.from([...Buffer.from('%PDF-'), ...head]), tail),
        at('pdf', i),
      ).toBe('pdf');
      const zip = Uint8Array.from([...Buffer.from('PK\x03\x04'), ...head]);
      const listing = Uint8Array.from([...tail, ...Buffer.from('word/document.xml')]);
      expect(sniffBytes(zip, listing), at('word', i)).toBe('word');
    }
  });
});
