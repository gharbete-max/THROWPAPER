import { describe, expect, it } from 'vitest';
import { parseRichText, parseRichTextBlock, toggleMarker } from './rich-text.js';

const plain = (text: string) => ({ text, bold: false, italic: false, underline: false });

describe('rich text', () => {
  it('leaves unmarked text alone', () => {
    expect(parseRichText('Hello there')).toEqual([plain('Hello there')]);
  });

  it.each([
    ['bold', '*loud*', 'bold'],
    ['italic', '/leaning/', 'italic'],
    ['underline', '_underlined_', 'underline'],
  ])('marks %s', (_label, source, flag) => {
    const spans = parseRichText(source);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ [flag]: true });
  });

  it('combines markers', () => {
    const spans = parseRichText('*/both/*');
    expect(spans[0]).toMatchObject({ bold: true, italic: true });
  });

  it('splits a line into marked and unmarked spans', () => {
    expect(parseRichText('a *b* c')).toEqual([
      plain('a '),
      { text: 'b', bold: true, italic: false, underline: false },
      plain(' c'),
    ]);
  });

  /**
   * A lone asterisk in "2 * 3" is arithmetic far more often than it is somebody forgetting to
   * close a bold, so an unpaired marker stays literal text rather than swallowing the rest of the
   * line into a style.
   */
  it('treats an unclosed marker as ordinary text', () => {
    expect(parseRichText('2 * 3 = 6')).toEqual([plain('2 * 3 = 6')]);
    expect(parseRichText('half_way')).toEqual([plain('half_way')]);
  });

  /**
   * The whole reason this is a markup string rather than stored HTML: an author cannot produce an
   * element, so there is nothing to sanitise and nothing to keep sanitising.
   */
  it('cannot produce markup', () => {
    const spans = parseRichText('<script>alert(1)</script>');
    expect(spans).toEqual([plain('<script>alert(1)</script>')]);
  });

  it('keeps blank lines as gaps', () => {
    expect(parseRichTextBlock('one\n\ntwo')).toHaveLength(3);
  });
});

describe('the formatting toolbar', () => {
  it('wraps a selection', () => {
    expect(toggleMarker('make me bold', 5, 7, '*')).toEqual({
      value: 'make *me* bold',
      start: 6,
      end: 8,
    });
  });

  it('unwraps a selection that is already marked', () => {
    expect(toggleMarker('make *me* bold', 6, 8, '*')).toEqual({
      value: 'make me bold',
      start: 5,
      end: 7,
    });
  });

  it('does nothing without a selection', () => {
    expect(toggleMarker('nothing selected', 4, 4, '*')).toMatchObject({
      value: 'nothing selected',
    });
  });
});
