import { describe, expect, it } from 'vitest';

/**
 * `CLAUDE.md` rule 6: locale-aware sorting. ICU collation, not code points.
 *
 * The responses grid sorted text with TanStack's default comparison, which is `<` on UTF-16 code
 * units — nothing in the codebase implemented this rule until an audit went looking for it. This
 * test states what the rule actually means, so "we used a collator" cannot quietly become "we used
 * a collator with the wrong locale".
 */
describe('sorting names the way the language does', () => {
  const sorted = (locale: string, names: string[]) =>
    [...names].sort(new Intl.Collator(locale, { numeric: true }).compare);

  it('is not case-sensitive the way a code-point comparison is', () => {
    // "Zebra" < "apple" by code point, because every capital letter is below every lower-case one.
    expect(['apple', 'Zebra'].sort()).toEqual(['Zebra', 'apple']);
    expect(sorted('sv-SE', ['apple', 'Zebra'])).toEqual(['apple', 'Zebra']);
  });

  it('puts å ä ö after z in Swedish', () => {
    expect(sorted('sv-SE', ['Öberg', 'Ångström', 'Zetterberg', 'Ekström'])).toEqual([
      'Ekström',
      'Zetterberg',
      'Ångström',
      'Öberg',
    ]);
  });

  /**
   * The case a code-point sort cannot get right by luck.
   *
   * Swedish orders å ä ö; Danish and Norwegian order æ ø å. The code points run å(E5) ä(E4) ö(F6),
   * so no single fixed order satisfies both — which is the whole reason the rule names ICU.
   */
  it('orders æ ø å for Danish, not by code point', () => {
    expect(sorted('da-DK', ['Åberg', 'Østergaard', 'Ærø', 'Bruun'])).toEqual([
      'Bruun',
      'Ærø',
      'Østergaard',
      'Åberg',
    ]);
  });

  it('reads digits inside text as numbers', () => {
    // Reference codes and "Room 2" / "Room 10" both read wrong without this.
    expect(sorted('sv-SE', ['Room 10', 'Room 2'])).toEqual(['Room 2', 'Room 10']);
  });
});
