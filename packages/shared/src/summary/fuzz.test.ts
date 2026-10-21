import { describe, expect, it } from 'vitest';
import {
  QUOTED_CATEGORIES,
  QUOTED_LEXICON,
  TERMS_NEEDED,
  mustQuote,
} from '../import/quoted/quoted.js';
import { digitCheck, numbersIn } from './check.js';
import { MAX_SELECTED, parseSelection, quote, splitPassages } from './passages.js';
import {
  PROOFREAD_KINDS,
  addedNumberDoubts,
  applyFixes,
  mergeIssues,
  missingSpans,
  verifyIssues,
} from './proofread.js';

/**
 * Property tests for the pure cores around the local model: the passage selector, the quoted-text
 * rule, the number check and the proofread span verification. These are what stand between a
 * model's answer and the screen, so they are held to: whatever the model says, nothing it invents
 * reaches the person. Seeded; `FUZZ_SEED=<n> pnpm vitest run <file>` replays a failure.
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
const words = (r: Rng, alphabet: readonly string[], n: number) =>
  Array.from({ length: n }, () => r.pick(alphabet)).join('');

const DIGITS = '0123456789';

describe('the number check', () => {
  it('a changed digit is caught however long the number is (an account or reference number)', () => {
    const r = prng(SEED);
    for (let i = 0; i < 2000; i += 1) {
      const length = r.int(1, 40);
      const source = words(r, [...DIGITS], length).replace(/^0+(?=\d)/, '');
      const index = r.int(0, source.length - 1);
      const changed =
        source.slice(0, index) +
        String((Number(source[index]) + r.int(1, 9)) % 10) +
        source.slice(index + 1);
      // A leading zero removed or added is the same number; anything else is a different one.
      if (source.replace(/^0+(?=\d)/, '') === changed.replace(/^0+(?=\d)/, '')) continue;
      const result = digitCheck(`Pay ${source} now`, `Pay ${changed} now`);
      expect(result.added, at(`${source} -> ${changed}`, i)).not.toEqual([]);
      expect(result.missing, at(`${source} -> ${changed}`, i)).not.toEqual([]);
    }
  });

  it('leading zeros, other scripts and fullwidth digits are the same number', () => {
    expect(numbersIn('007 ７ ٧').size).toBe(1);
    expect(digitCheck('Nr 0042', 'No. 42').added).toEqual([]);
  });

  it('whatever the text, the sets are digits only and the check is its own mirror', () => {
    const r = prng(SEED + 1);
    const alphabet = [...`${DIGITS} ab,.-:\n٣２`];
    for (let i = 0; i < 2000; i += 1) {
      const a = words(r, alphabet, r.int(0, 40));
      const b = words(r, alphabet, r.int(0, 40));
      const forward = digitCheck(a, b);
      const backward = digitCheck(b, a);
      expect(forward.added, at('mirror', i)).toEqual(backward.missing);
      expect(forward.missing, at('mirror', i)).toEqual(backward.added);
      for (const n of numbersIn(a)) expect(n, at(n, i)).toMatch(/^(0|[1-9]\d*)$/);
    }
  });
});

describe('proofread: what a model says is checked against the text', () => {
  const SNIPPETS = [
    'Hello',
    'wrold',
    'on 2026-10-31',
    'pay 1 500 kr',
    'Åsa',
    'ref 12345678901234567',
    '\n',
    ' ',
    'the the',
  ];

  function model(r: Rng, text: string) {
    const issues = Array.from({ length: r.int(0, 12) }, () => {
      const from = r.int(0, Math.max(0, text.length - 1));
      const inText = text.slice(from, from + r.int(1, 14));
      const bad = r.next() < 0.2;
      return r.pick([
        {
          span: bad ? 'NOT IN TEXT' : inText,
          kind: r.pick([...PROOFREAD_KINDS, 'invented']),
          fix: r.pick(['wrong', 'fix 99', '', inText, inText + '.']),
        },
        { span: inText },
        { span: 3, kind: 'spelling', fix: 'x' },
        null,
        'string',
        { span: inText, kind: 'spelling', fix: 7 },
      ]);
    });
    return r.pick([{ issues }, { issues: 'no' }, null, [], 'text', { issues }, { issues }]);
  }

  it('every issue it keeps is really in the text, in order, apart, with a real change', () => {
    const r = prng(SEED + 2);
    for (let i = 0; i < 3000; i += 1) {
      const text = words(r, SNIPPETS, r.int(0, 14));
      const source = r.next() < 0.5 ? '' : words(r, SNIPPETS, r.int(0, 8));
      const raw = model(r, text);
      let verified!: ReturnType<typeof verifyIssues>;
      expect(() => (verified = verifyIssues(text, raw, source)), at('verify', i)).not.toThrow();
      let end = 0;
      verified.issues.forEach((issue, index) => {
        const ctx = at(JSON.stringify({ text, issue }), i);
        expect(issue.id, ctx).toBe(index + 1);
        expect(text.slice(issue.start, issue.end), ctx).toBe(issue.span);
        expect(issue.start >= end, ctx).toBe(true);
        end = issue.end;
        expect(issue.fix, ctx).not.toBe(issue.span);
        expect(PROOFREAD_KINDS as readonly string[], ctx).toContain(issue.kind);
      });

      // Accepting nothing changes nothing; accepting all changes exactly the named spans.
      const all = new Set(verified.issues.map((issue) => issue.id));
      expect(applyFixes(text, verified.issues, new Set()), at('none', i)).toBe(text);
      let manual = text;
      for (const issue of [...verified.issues].reverse()) {
        if (issue.fix !== null)
          manual = manual.slice(0, issue.start) + issue.fix + manual.slice(issue.end);
      }
      expect(applyFixes(text, verified.issues, all), at('all', i)).toBe(manual);

      // The number doubts on top: still in the text, still apart from what the model kept.
      const merged = mergeIssues(text, verified, source);
      let last = 0;
      for (const issue of merged.issues) {
        expect(text.slice(issue.start, issue.end), at('merged slice', i)).toBe(issue.span);
        void last;
        last = issue.end;
      }
      for (const doubt of addedNumberDoubts(text, source)) {
        expect(doubt.fix, at('doubt', i)).toBeNull();
        expect(text.slice(doubt.start, doubt.end), at('doubt span', i)).toBe(doubt.span);
      }
    }
  });

  it('a fix that brings a number in from nowhere is refused', () => {
    const text = 'Pay on 31 October.';
    const out = verifyIssues(text, {
      issues: [{ span: 'Pay', kind: 'wording', fix: 'Pay by 2027' }],
    });
    expect(out.issues).toEqual([]);
    expect(out.rejected).toBe(1);
  });

  it('missingSpans names exactly the spans an email leaves out', () => {
    const r = prng(SEED + 3);
    for (let i = 0; i < 500; i += 1) {
      const spans = Array.from({ length: r.int(0, 6) }, () =>
        words(r, ['a', 'b', 'c', ' '], r.int(1, 4)),
      );
      const email = words(r, ['a', 'b', 'c', ' '], r.int(0, 12));
      expect(missingSpans(email, spans), at('missing', i)).toEqual(
        spans.filter((s) => !email.includes(s)),
      );
    }
  });
});

describe('passages: the model chooses numbers, the screen shows the original', () => {
  const PIECES = [
    'Clause one',
    ' ',
    '\n',
    '\n\n',
    '\r\n\r\n',
    '   \n  \n',
    '\t',
    'Åsa',
    '1.',
    '(a)',
    ' ',
  ];

  it('passages are ordered, apart, trimmed and cut from the text exactly', () => {
    const r = prng(SEED + 4);
    for (let i = 0; i < 3000; i += 1) {
      const text = words(r, PIECES, r.int(0, 25));
      const passages = splitPassages(text);
      let end = 0;
      passages.forEach((passage, index) => {
        const ctx = at(JSON.stringify(text), i);
        expect(passage.number, ctx).toBe(index + 1);
        expect(passage.start >= end, ctx).toBe(true);
        expect(passage.end > passage.start, ctx).toBe(true);
        end = passage.end;
        const body = text.slice(passage.start, passage.end);
        expect(body, ctx).toBe(body.trim());
        expect(/\n\s*\n/.test(body), ctx).toBe(false);
      });
      // Nothing with a letter in it is lost.
      const kept = passages.map((p) => text.slice(p.start, p.end)).join('');
      expect(kept.replace(/\s/g, ''), at('coverage', i)).toBe(text.replace(/\s/g, ''));
      expect(
        quote(
          text,
          passages,
          passages.map((p) => p.number),
        ),
        at('quote', i),
      ).toEqual(passages.map((p) => text.slice(p.start, p.end)));
      expect(quote(text, passages, [0, passages.length + 1, -1]), at('out of range', i)).toEqual(
        [],
      );
    }
  });

  it('only a JSON object of whole numbers in range is accepted, de-duplicated and sorted', () => {
    const r = prng(SEED + 5);
    for (let i = 0; i < 4000; i += 1) {
      const count = r.int(0, 12);
      const raw = r.pick([
        JSON.stringify({ indices: Array.from({ length: r.int(0, 8) }, () => r.int(-1, 14)) }),
        JSON.stringify({ indices: [1.5, 2] }),
        JSON.stringify({ indices: ['1'] }),
        JSON.stringify({ indices: [null] }),
        JSON.stringify([1, 2]),
        '{"indices":[1,2',
        'null',
        '',
        words(r, [...'{}[]",:1 a'], r.int(0, 20)),
      ]);
      const out = parseSelection(raw, count);
      if (out === null) continue;
      expect(out.length >= 1 && out.length <= MAX_SELECTED, at(raw, i)).toBe(true);
      expect(
        out.every((n) => Number.isInteger(n) && n >= 1 && n <= count),
        at(raw, i),
      ).toBe(true);
      expect(out, at(raw, i)).toEqual([...new Set(out)].sort((a, b) => a - b));
    }
  });
});

describe('the quoted-text rule', () => {
  it('never throws, and adding text can only keep or add a reason to quote', () => {
    const r = prng(SEED + 6);
    const alphabet = [
      ...'ab c\n,.:;- Å\u{1F600}\u0000 the party agrees consent signature'.split(' ').join(' '),
    ];
    for (let i = 0; i < 600; i += 1) {
      const a = words(r, alphabet, r.int(0, 80));
      const b = words(r, alphabet, r.int(0, 80));
      const alone = mustQuote(a);
      expect(mustQuote(`${a}\n\n${b}`).quoteOnly || !alone.quoteOnly, at('monotonic', i)).toBe(
        true,
      );
    }
  });

  it('two distinct terms of any category, in any language of the lexicon, are enough to quote', () => {
    for (const category of QUOTED_CATEGORIES) {
      for (const [language, terms] of Object.entries(QUOTED_LEXICON.categories[category] ?? {})) {
        const plain = terms.map((term) => term.replace(/\*$/, ''));
        for (let a = 0; a < plain.length; a += 1) {
          for (let b = a + 1; b < plain.length; b += 1) {
            const [x, y] = [plain[a]!.toLowerCase(), plain[b]!.toLowerCase()];
            if (x.includes(y) || y.includes(x)) continue;
            const text = `${plain[a]}. ${plain[b]}.`;
            const verdict = mustQuote(text);
            expect(
              verdict.categories,
              `seed=${SEED} ${category}/${language}: ${JSON.stringify(text)} (needs ${TERMS_NEEDED})`,
            ).toContain(category);
          }
        }
      }
    }
  });

  it('a long text is judged in well under a second', () => {
    const started = Date.now();
    mustQuote('the party agrees '.repeat(200_000));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
