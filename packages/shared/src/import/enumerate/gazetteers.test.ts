import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONT_MAX,
  GAZETTEERS,
  gazetteerForm,
  isContinuationNotice,
  isMonth,
  isUnitWord,
} from './gazetteers.js';

/**
 * The word lists are data (`gazetteers.json`) and a specification (`NUMBERING-RULES.md` §9). This
 * holds the two to each other, so the document never describes a list the code does not use, and
 * checks that every entry is written in the form it is matched in — an entry that can never match
 * is a behaviour nobody reviewed.
 */

const RULES = new URL('../../../../../docs/plan/NUMBERING-RULES.md', import.meta.url);

/** The code blocks of §9, in order: UNIT_WORDS, MONTHS, CONTINUATION. */
function section9Blocks(): string[] {
  const text = readFileSync(RULES, 'utf8');
  const section = text.slice(text.indexOf('## 9. Gazetteers'), text.indexOf('## 10.'));
  return [...section.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
}

describe('the gazetteers', () => {
  const [units = '', months = '', continuation = ''] = section9Blocks();

  it('are the lists NUMBERING-RULES.md §9 prints, in its order', () => {
    expect(GAZETTEERS.unitWords).toEqual(units.split(/\s+/).filter(Boolean));
    expect(GAZETTEERS.months).toEqual(months.split(/\s+/).filter(Boolean));
    const byLanguage = continuation
      .trim()
      .split('\n')
      .map((line) => {
        const [, language = '', phrases = ''] = /^(\w+)\s+(.*)$/.exec(line) ?? [];
        return { language, phrases: phrases.split(' · ') };
      });
    expect(GAZETTEERS.continuation.map(({ language, phrases }) => ({ language, phrases }))).toEqual(
      byLanguage,
    );
  });

  it('match CJK anywhere and every other language by whole words', () => {
    for (const { language, match } of GAZETTEERS.continuation) {
      expect(match, language).toBe(['zh', 'ja'].includes(language) ? 'substring' : 'word');
    }
  });

  it('are written in the form they are matched in, once each', () => {
    const entries = [
      ...GAZETTEERS.unitWords,
      ...GAZETTEERS.months,
      ...GAZETTEERS.continuation.flatMap((l) => l.phrases),
    ];
    for (const word of [...GAZETTEERS.unitWords, ...GAZETTEERS.months]) {
      expect(gazetteerForm(word), word).toBe(word);
    }
    for (const phrase of entries) expect(phrase.toLowerCase(), phrase).toBe(phrase);
    expect(new Set(GAZETTEERS.unitWords).size).toBe(GAZETTEERS.unitWords.length);
    expect(new Set(GAZETTEERS.months).size).toBe(GAZETTEERS.months.length);
  });
});

describe('matching', () => {
  it('reads a unit or a month through the same folding as the marker', () => {
    expect(isUnitWord(gazetteerForm('Miljoner,'))).toBe(true);
    expect(isUnitWord(gazetteerForm('KR.'))).toBe(true);
    expect(isMonth(gazetteerForm('Mai'))).toBe(true);
    // No time words, on purpose: "4. Dagar du deltar" is a real label.
    expect(isUnitWord(gazetteerForm('Dagar'))).toBe(false);
    // No English months: "1. May we contact you?" is a real question.
    expect(isMonth(gazetteerForm('May'))).toBe(false);
  });

  it.each([
    ['Forts. på nästa sida', true],
    ['– forts. –', true],
    ['Continued overleaf', true],
    ['PTO', true],
    ['Vänd!', true],
    ['Fortsetzung auf der nächsten Seite', true],
    ['次ページへ続く', true],
    ['（続く）', true],
    ['Vändningen sker i maj', false], // "vänd" inside a word
    ['Discontinued products', false],
    ['Kontinuerlig uppföljning', false],
    ['suite2', false], // a digit touches it
    [`${'x'.repeat(CONT_MAX)} continued`, false], // too long to be a notice
  ])('%s → %s', (text, expected) => {
    expect(isContinuationNotice(text)).toBe(expected);
  });

  it('finds a whole word after an earlier occurrence inside a word', () => {
    expect(isContinuationNotice('Vändningar: vänd')).toBe(true);
  });
});
