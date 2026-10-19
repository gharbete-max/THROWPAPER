import { describe, expect, it } from 'vitest';
import {
  addedNumberDoubts,
  applyFixes,
  feedbackMaterial,
  isComposeTask,
  isProofreadTask,
  mergeIssues,
  missingSpans,
  pageOfOffset,
  verifyIssues,
} from './proofread.js';

const TEXT =
  'The board met on Tuesday. Teh budget was approved for 450 members.\nThe meeting closed.';
const raw = (...issues: Array<Record<string, unknown>>) => ({ issues });

describe('verifying what the model said', () => {
  it('keeps an issue whose span stands in the text word for word, with its place', () => {
    const { issues, rejected } = verifyIssues(
      TEXT,
      raw({ span: 'Teh', kind: 'spelling', fix: 'The' }),
    );
    expect(rejected).toBe(0);
    expect(issues).toEqual([
      { id: 1, kind: 'spelling', span: 'Teh', start: 26, end: 29, fix: 'The' },
    ]);
    expect(TEXT.slice(issues[0]!.start, issues[0]!.end)).toBe('Teh');
  });

  it('rejects, and counts, a span not in the text, a bad kind and a no-op fix', () => {
    const { issues, rejected } = verifyIssues(
      TEXT,
      raw(
        { span: 'Teh budgit', kind: 'spelling', fix: 'The budget' },
        { span: 'Teh', kind: 'style', fix: 'The' },
        { span: 'Teh', kind: 'spelling', fix: 'Teh' },
        { kind: 'spelling' },
      ),
    );
    expect(issues).toEqual([]);
    expect(rejected).toBe(4);
  });

  it('rejects a fix that brings in a number neither the span nor the source has', () => {
    const bad = verifyIssues(
      TEXT,
      raw({ span: '450 members', kind: 'wording', fix: '540 members' }),
    );
    expect(bad.issues).toEqual([]);
    expect(bad.rejected).toBe(1);
    const fine = verifyIssues(
      TEXT,
      raw({ span: '450 members', kind: 'wording', fix: '450 people' }),
    );
    expect(fine.issues).toHaveLength(1);
  });

  it('puts the same span twice on its two places, never on one', () => {
    const text = 'teh cat and teh dog';
    const { issues } = verifyIssues(
      text,
      raw(
        { span: 'teh', kind: 'spelling', fix: 'the' },
        { span: 'teh', kind: 'spelling', fix: 'the' },
      ),
    );
    expect(issues.map((i) => i.start)).toEqual([0, 12]);
  });

  it('holds a contract, consent or clinical text to spelling only', () => {
    const contract =
      'This agreement is binding. The Terms and Conditions apply. Teh parties agree.';
    const { issues, rejected } = verifyIssues(
      contract,
      raw(
        { span: 'Teh', kind: 'spelling', fix: 'The' },
        { span: 'binding', kind: 'wording', fix: 'enforceable' },
      ),
    );
    expect(issues.map((i) => i.kind)).toEqual(['spelling']);
    expect(rejected).toBe(1);
  });

  it('survives anything else the model sends', () => {
    for (const bad of [null, 'x', 4, {}, { issues: 'x' }, { issues: [null, 5, 'a'] }]) {
      expect(verifyIssues(TEXT, bad).issues).toEqual([]);
    }
  });
});

describe('numbers the source does not have', () => {
  const source = 'Meeting of 2026-10-01. 120 members attended.';
  it('are found without a model, at their place in the text', () => {
    const text = 'The meeting was on 2026-10-01 and 150 members came.';
    const doubts = addedNumberDoubts(text, source);
    expect(doubts.map((d) => d.span)).toEqual(['150']);
    expect(doubts[0]).toMatchObject({ kind: 'factual-doubt', fix: null });
    expect(text.slice(doubts[0]!.start, doubts[0]!.end)).toBe('150');
  });
  it('are not repeated inside an issue the model already raised', () => {
    const text = 'About 150 members came.';
    const verified = verifyIssues(
      text,
      raw({ span: '150 members', kind: 'factual-doubt', fix: '120 members' }),
      source,
    );
    expect(mergeIssues(text, verified, source).issues).toHaveLength(1);
  });
  it('are nothing without a source', () => {
    expect(addedNumberDoubts('150', '')).toEqual([]);
  });
});

describe('applying fixes', () => {
  it('changes a copy, only for the accepted issues, and not for a look-at-this', () => {
    const { issues } = mergeIssues(
      TEXT,
      verifyIssues(
        TEXT,
        raw(
          { span: 'Teh', kind: 'spelling', fix: 'The' },
          { span: 'closed', kind: 'wording', fix: 'ended' },
        ),
      ),
      '',
    );
    expect(applyFixes(TEXT, issues, new Set([1]))).toBe(TEXT.replace('Teh', 'The'));
    expect(applyFixes(TEXT, issues, new Set())).toBe(TEXT);
    expect(applyFixes(TEXT, issues, new Set([1, 2]))).toBe(
      TEXT.replace('Teh', 'The').replace('closed', 'ended'),
    );
    const doubt = {
      id: 1,
      kind: 'factual-doubt' as const,
      span: '450',
      start: 54,
      end: 57,
      fix: null,
    };
    expect(applyFixes(TEXT, [doubt], new Set([1]))).toBe(TEXT);
  });
});

describe('the review email', () => {
  const issues = verifyIssues(
    TEXT,
    raw(
      { span: 'Teh', kind: 'spelling', fix: 'The' },
      { span: 'closed', kind: 'wording', fix: 'ended' },
    ),
  ).issues;
  it('quotes every span with its page, and tells which the email left out', () => {
    const ranges = [
      { page: 1, start: 0, end: 60 },
      { page: 2, start: 62, end: 100 },
    ];
    const { material, spans } = feedbackMaterial(issues, ranges, (k) => k);
    expect(material).toBe(
      '1. spelling, page 1: "Teh" -> "The"\n2. wording, page 2: "closed" -> "ended"',
    );
    expect(pageOfOffset(ranges, 70)).toBe(2);
    expect(missingSpans('Please fix "Teh" soon.', spans)).toEqual(['closed']);
  });
});

describe('the shape of a task from a window', () => {
  const compose = {
    kind: 'compose-email',
    purpose: 'summary',
    material: 'x',
    recipient: '',
    notes: '',
    into: 'en-GB',
    tone: 'formal',
    overall: 'good',
    quotes: [],
  };
  it('is checked', () => {
    expect(isProofreadTask({ kind: 'proofread', text: 'a', source: '', into: 'sv-SE' })).toBe(true);
    expect(isProofreadTask({ kind: 'proofread', text: ' ', source: '', into: 'sv-SE' })).toBe(
      false,
    );
    expect(isProofreadTask({ kind: 'proofread', text: 'a', source: '', into: 'xx' })).toBe(false);
    expect(isComposeTask(compose)).toBe(true);
    expect(isComposeTask({ ...compose, purpose: 'other' })).toBe(false);
    expect(isComposeTask({ ...compose, material: 'x'.repeat(13_000) })).toBe(false);
  });
});
