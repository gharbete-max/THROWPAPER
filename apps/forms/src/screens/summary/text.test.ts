import { describe, expect, it } from 'vitest';
import { runsToText } from './text.js';

const run = (text: string, x: number, y: number, h = 0.02) => ({ text, x, y, w: 0.1, h });

describe('a PDF page as text', () => {
  it('reads left to right, top to bottom, and joins runs of one line', () => {
    expect(
      runsToText([run('world', 0.3, 0.1), run('Second line', 0.1, 0.13), run('Hello', 0.1, 0.1)]),
    ).toBe('Hello world\nSecond line');
  });

  it('starts a paragraph after a gap well over a line', () => {
    expect(runsToText([run('One', 0.1, 0.1), run('Two', 0.1, 0.2)])).toBe('One\n\nTwo');
  });

  it('has no text in nothing, so a scanned page can be told from a blank one', () => {
    expect(runsToText([])).toBe('');
    expect(runsToText([run('  ', 0.1, 0.1)])).toBe('');
  });
});
