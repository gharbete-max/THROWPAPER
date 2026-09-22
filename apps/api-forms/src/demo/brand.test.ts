import { describe, expect, it } from 'vitest';
import { BOUNDARY_CONTRAST, checkContrast, contrastRatio } from '@tp/tokens';
import { DEMO_BRAND } from './dataset.js';

/**
 * The demo palette, held to the same bar as a customer's.
 *
 * `packages/tokens` has owned a contrast guard since phase 1, and it was pointed at the shipped
 * presets and at whatever a customer saves — but never at this. So the one palette every "Open the
 * demo" visitor actually sees was the only one nobody checked, and its border sat at **1.28:1**
 * against the page for months, on a bar of 3.
 *
 * `LAUNCH-CHECKLIST.md` §2.2 carried that as a row. A row is a reminder; this is a mechanism, and
 * the row is closed because the mechanism exists rather than because somebody edited a hex value.
 */
describe('the demo brand kit', () => {
  it('passes the same contrast guard a customer palette has to', () => {
    const findings = checkContrast(DEMO_BRAND);
    expect(
      findings,
      findings
        .map((f) => `${f.token} is ${f.ratio}:1 against ${f.against}, needs ${f.required}`)
        .join('; '),
    ).toEqual([]);
  });

  /**
   * Named separately from the sweep above, because this is the one that was actually wrong and a
   * regression here should say so by name rather than as "some finding".
   */
  it('draws a border somebody can see', () => {
    const ratio = contrastRatio(DEMO_BRAND.colour.border, DEMO_BRAND.colour.background);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST);
  });
});
