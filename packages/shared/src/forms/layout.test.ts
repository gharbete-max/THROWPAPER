import { describe, expect, it } from 'vitest';
import { FormDefinition, FormLayout, LOGO_SLOTS, emptyDefinition } from './index.js';

/**
 * `docs/plan/CAVEATS.md` #33, `placement-slots-not-pixels`: a logo goes into one of six named
 * slots, and no coordinate can ever be stored — a position that is right on a laptop is wrong on a
 * phone and meaningless on paper.
 */
describe('the form layout', () => {
  it('is six named slots', () => {
    expect(LOGO_SLOTS).toEqual([
      'header-left',
      'masthead-centred',
      'corner-watermark',
      'footer-strip',
      'sidebar-rail',
      'card-top',
    ]);
    for (const logoSlot of LOGO_SLOTS) {
      expect(FormLayout.parse({ logoSlot })).toEqual({ logoSlot });
    }
  });

  it('stores no position, and no slot that is not one of the six', () => {
    expect(FormLayout.safeParse({ logoSlot: 'header-left', x: 12, y: 40 }).success).toBe(false);
    expect(FormLayout.safeParse({ logoSlot: { x: 12, y: 40 } }).success).toBe(false);
    expect(FormLayout.safeParse({ logoSlot: 'top-left' }).success).toBe(false);
  });

  it('is absent from a form that never chose one, which parses exactly as it always did', () => {
    const parsed = FormDefinition.parse(emptyDefinition);
    expect(parsed.settings).not.toHaveProperty('layout');
    expect(FormDefinition.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('travels with the form when chosen', () => {
    const chosen = FormDefinition.parse({
      ...emptyDefinition,
      settings: { ...emptyDefinition.settings, layout: { logoSlot: 'masthead-centred' } },
    });
    expect(chosen.settings.layout).toEqual({ logoSlot: 'masthead-centred' });
  });
});
