import { describe, expect, it } from 'vitest';
import { foldText, linksIn } from './plain-text.js';

describe('foldText', () => {
  it('folds at spaces and keeps short lines and blank lines as they are', () => {
    const text = 'one two three four five six\n\nshort';
    expect(foldText(text, 12)).toBe('one two\nthree four\nfive six\n\nshort');
  });

  it('leaves a word longer than the width whole', () => {
    expect(foldText('see https://example.org/a/very/long/path ok', 10)).toBe(
      'see\nhttps://example.org/a/very/long/path\nok',
    );
  });
});

describe('linksIn', () => {
  it('lists each link once, without the punctuation around it', () => {
    const text =
      'Read https://example.org/a, or (https://example.org/b). Again https://example.org/a\nMail mailto:hej@example.org!';
    expect(linksIn(text)).toEqual([
      'https://example.org/a',
      'https://example.org/b',
      'mailto:hej@example.org',
    ]);
  });

  it('finds none in text without links', () => {
    expect(linksIn('No links, just example.org mentioned.')).toEqual([]);
  });
});
