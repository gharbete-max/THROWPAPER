import { describe, expect, it } from 'vitest';
import { blankRuns, halfWidth, isBlankWord, textHints } from './hints.js';

describe('what a line says of itself', () => {
  it('finds a blank and a closing colon in ASCII', () => {
    expect(textHints('Namn: ______')).toMatchObject({ blankRun: true, endsWithColon: true });
    expect(textHints('Namn ........')).toMatchObject({ blankRun: true });
    expect(textHints('Namn')).toMatchObject({ blankRun: false, endsWithColon: false });
  });

  // #144: Chinese and Japanese write them full-width.
  it('reads full-width blanks, colons and question marks as their ASCII forms', () => {
    expect(textHints('氏名：＿＿＿＿＿＿')).toMatchObject({ blankRun: true, endsWithColon: true });
    expect(textHints('ご意見：')).toMatchObject({ blankRun: false, endsWithColon: true });
    expect(textHints('氏名＿＿')).toMatchObject({ blankRun: false });
    expect(isBlankWord('＿＿＿＿')).toBe(true);
    expect(isBlankWord('：＿＿＿＿')).toBe(true);
    expect(halfWidth('是否需要发票？')).toBe('是否需要发票?');
  });

  it('keeps every position: a full-width blank is where its characters are', () => {
    const text = '電話番号：＿＿＿＿';
    expect(halfWidth(text)).toHaveLength(text.length);
    expect(blankRuns(text)).toEqual([{ start: 5, end: 9 }]);
  });
});
