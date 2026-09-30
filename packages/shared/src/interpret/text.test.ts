import { describe, expect, it } from 'vitest';
import { compareCodePoints, fold, keyOf, probed, spanOf, tokenise } from './text.js';

/**
 * Normalisation — `docs/plan/INTENT-LADDER.md`, "Normalisation". What matters most is the way
 * back: every token and every span points at what was typed, however NFKC reshaped it.
 */

const words = (text: string) => tokenise(probed(text)).map((t) => t.text);
const typedAt = (text: string) => tokenise(probed(text)).map((t) => text.slice(t.start, t.end));

describe('normalisation', () => {
  it('lower-cases, folds quotes and dashes, and splits on anything but letters and digits', () => {
    expect(words('Side-by-side!')).toEqual(['side', 'by', 'side']);
    expect(words('It’s “NEEDED”')).toEqual(['it', 's', 'needed']);
    expect(keyOf('  Under the question,\tfull width.  ')).toBe('under the question full width');
  });

  it('keeps every token pointing at what was typed, through NFKC', () => {
    // ﬁ is one character that becomes two; ５ is a full-width digit; é is e and a combining mark.
    const typed = 'ﬁnal ５ café';
    expect(words(typed)).toEqual(['final', '5', 'café']);
    expect(typedAt(typed)).toEqual(['ﬁnal', '５', 'café']);
  });

  it('keeps a folded form beside the primary one, never instead of it', () => {
    expect(tokenise(probed('Öster')).map((t) => [t.text, t.folded])).toEqual([['öster', 'oster']]);
    expect(fold('ÅÄÖ é ñ ø')).toBe('AAO e n ø');
  });

  it('splits a number from the word it is glued to', () => {
    expect(words('4st')).toEqual(['4', 'st']);
    expect(words('4个')).toEqual(['4', '个']);
  });

  it('reads Chinese and Japanese as overlapping character bigrams', () => {
    expect(words('不要按钮')).toEqual(['不要', '要按', '按钮']);
    expect(words('ボタンなし')).toEqual(['ボタ', 'タン', 'ンな', 'なし']);
    expect(words('是')).toEqual(['是']);
    expect(tokenise(probed('按钮')).every((t) => t.cjk)).toBe(true);
    expect(typedAt('要按钮')).toEqual(['要按', '按钮']);
  });

  it('numbers clauses at punctuation and line breaks, in every script', () => {
    const clauses = (text: string) => tokenise(probed(text)).map((t) => t.clause);
    expect(clauses('no, buttons; yes')).toEqual([0, 1, 2]);
    expect(clauses('a\nb')).toEqual([0, 1]);
    expect(clauses('不要，按钮')).toEqual([0, 1]);
  });

  it('maps a span of the probed text back to the input', () => {
    const p = probed('ﬁx');
    expect(p.text).toBe('fix');
    expect(spanOf(p, 0, 1)).toEqual([0, 1]);
    expect(spanOf(p, 0, 3)).toEqual([0, 2]);
  });

  it('orders by code point, as JavaScript’s < does not beyond the BMP', () => {
    const astral = '\u{1F600}';
    const high = '～';
    expect(high < astral).toBe(false);
    expect(compareCodePoints(high, astral)).toBeLessThan(0);
    expect(['b', 'a', 'ab'].sort(compareCodePoints)).toEqual(['a', 'ab', 'b']);
  });
});
