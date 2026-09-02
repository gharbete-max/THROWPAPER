import { describe, expect, it } from 'vitest';
import { Field, definitionProblems, emptyDefinition, isDangerousPattern } from './index.js';
import { validateSubmission } from './validate.js';
import type { FormDefinition } from './index.js';

/**
 * A `pattern` rule is written by a customer and executed by our server on a stranger's text.
 *
 * JavaScript backtracks, so a quantifier applied to a group that also quantifies takes exponential
 * time on input that nearly matches. That is not a slow request — it is a synchronous loop with no
 * yield, on a single-threaded server, stalling every other tenant in the process for as long as it
 * runs. The old guard capped the pattern at 200 characters, which has nothing to do with it.
 */
describe('spotting a pattern that can hang the server', () => {
  it.each([
    ['(a+)+', 'the textbook case'],
    ['(a*)*', 'star inside star'],
    ['([a-z]+)*', 'a class quantified inside a quantified group'],
    ['(\\d+)+', 'an escape class inside'],
    ['(x|y|a+)+', 'one dangerous branch is enough'],
    ['(a{2,}){3,}', 'open-ended braces are quantifiers too'],
    ['((a+))+', 'nested groups'],
  ])('refuses %s — %s', (pattern) => {
    expect(isDangerousPattern(pattern)).toBe(true);
  });

  it.each([
    ['[0-9]{3} ?[0-9]{2}', 'the Swedish postcode preset'],
    ['[\\p{L} .\\-]+', 'the letters preset'],
    ['https?://\\S+', 'the web address preset'],
    ['(cat|dog)+', 'alternation of literals, no inner repeat'],
    ['(ab){2,5}', 'a bounded repeat of a bounded group'],
    ['[+*]+', 'quantifier characters inside a class are literals'],
    ['\\(a+\\)+', 'escaped parentheses are not a group'],
    ['', 'no pattern at all'],
  ])('allows %s — %s', (pattern) => {
    expect(isDangerousPattern(pattern)).toBe(false);
  });
});

const formWith = (pattern: string): FormDefinition => ({
  schemaVersion: 1,
  fields: [
    Field.parse({
      id: 'f1',
      key: 'code',
      type: 'short_text',
      label: { 'sv-SE': 'Kod' },
      pattern,
    }),
  ],
  settings: emptyDefinition.settings,
});

describe('what happens to one that exists anyway', () => {
  it('refuses to publish it, where a person is there to be told', () => {
    expect(definitionProblems(formWith('(a+)+'))).toContainEqual(
      expect.objectContaining({ code: 'unsafe-pattern', fieldId: 'f1' }),
    );
    expect(definitionProblems(formWith('[0-9]{5}'))).toEqual([]);
  });

  /**
   * Skipped, not failed.
   *
   * A form written through the API before the publish check existed would otherwise reject every
   * answer — a live public page nobody can complete, and no way for the visitor to work out why.
   * Skipping one rule leaves the field validated by its type and its length limits; failing it
   * breaks the form outright.
   */
  it('skips the rule rather than rejecting every answer', () => {
    const result = validateSubmission(formWith('(a+)+'), { code: 'anything at all' });
    expect(result.ok).toBe(true);
    expect(result.values.code).toBe('anything at all');
  });

  it('finishes promptly on the input that would otherwise hang it', () => {
    // 40 a's followed by a `!` is the classic trigger: ~2^40 backtracking steps unguarded.
    const started = Date.now();
    const result = validateSubmission(formWith('(a+)+'), { code: `${'a'.repeat(40)}!` });
    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('still enforces a safe pattern', () => {
    const good = validateSubmission(formWith('[0-9]{5}'), { code: '12345' });
    expect(good.ok).toBe(true);
    const bad = validateSubmission(formWith('[0-9]{5}'), { code: 'abcde' });
    expect(bad.issues).toEqual([{ key: 'code', code: 'validation.pattern' }]);
  });
});
