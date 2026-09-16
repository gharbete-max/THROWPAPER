import { describe, expect, it } from 'vitest';
import { labelNear } from './extract.js';
import { tessLangs, toRuns } from './ocr.js';

describe('reading a photographed page', () => {
  it('turns recognised lines into page fractions the label finder reads', () => {
    const runs = toRuns({
      width: 1200,
      height: 1600,
      lines: [
        { text: 'Full name\n', bbox: { x0: 100, y0: 128, x1: 220, y1: 152 } },
        { text: '   ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
        { text: 'Member?', bbox: { x0: 100, y0: 208, x1: 210, y1: 232 } },
      ],
    });
    expect(runs).toEqual([
      { text: 'Full name', x: 100 / 1200, y: 0.08, w: 0.1, h: 0.015 },
      { text: 'Member?', x: 100 / 1200, y: 0.13, w: 110 / 1200, h: 0.015 },
    ]);
    // A box drawn to the right of "Member?" is offered exactly those words.
    expect(labelNear({ x: 0.2, y: 0.125, w: 0.3, h: 0.025 }, runs)).toBe('Member?');
  });

  it('reads English alongside the interface language, and English alone for the rest', () => {
    expect(tessLangs('sv-SE')).toEqual(['eng', 'swe']);
    expect(tessLangs('zh-CN')).toEqual(['eng', 'chi_sim']);
    expect(tessLangs('en-GB')).toEqual(['eng']);
    expect(tessLangs('pt-BR')).toEqual(['eng']);
  });
});
