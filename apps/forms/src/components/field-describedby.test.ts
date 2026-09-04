import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Help text and errors have to be attached to the control they belong to.
 *
 * They were not. Both rendered as siblings of the input, referenced by nothing. Sighted people read
 * them because they sit underneath; a screen reader announces the label, the type and the required
 * state, and stops. So on a form that has just refused to submit, the field somebody is focused on
 * told them nothing about why — which is the single moment that message exists for.
 *
 * `aria-invalid` matters as much as the text: without it the control is not reported as being in an
 * error state at all, only as a field that happens to have a red sentence somewhere near it.
 *
 * Checked in the source rather than by rendering, because there is no DOM test setup in this
 * workspace and the failure is structural: an author adding a fourteenth field type copies the
 * branch above it, and the copy is what has to carry the attributes.
 */
const SOURCE = readFileSync(new URL('./FieldInput.tsx', import.meta.url), 'utf8');

/** Every element that takes an answer, and therefore owns a message when one is wrong. */
const CONTROLS = /<(input|textarea|select|fieldset)\b[^>]*>/gs;

describe('a field and its message', () => {
  it('points every control at its help and error text', () => {
    /**
     * Only the controls in the branches that render a message. The rating radios and the option
     * checkboxes inside a group are described by the `fieldset` around them, not individually —
     * repeating the error on each of five radios reads it five times.
     */
    const described = [...SOURCE.matchAll(CONTROLS)].filter((match) =>
      match[0].includes('aria-describedby'),
    );

    // The main input, textarea, both selects, and the choice fieldset.
    expect(described.length).toBeGreaterThanOrEqual(5);
  });

  it('reports the control as invalid, not merely adjacent to red text', () => {
    const invalid = [...SOURCE.matchAll(CONTROLS)].filter((match) =>
      match[0].includes('aria-invalid'),
    );
    expect(invalid.length).toBeGreaterThanOrEqual(5);
  });

  it('gives the help and error text ids to be referenced by', () => {
    // A `describedby` pointing at an id nothing carries is worse than none: it reads as empty.
    expect(SOURCE).toContain('id={helpId}');
    expect(SOURCE).toContain('id={errorId}');
    expect(SOURCE).toContain('`${field.id}-help`');
    expect(SOURCE).toContain('`${field.id}-error`');
  });

  it('describes nothing when there is nothing to say', () => {
    // An empty `aria-describedby` is a promise of information that is not there.
    expect(SOURCE).toContain("[helpId, errorId].filter(Boolean).join(' ') || undefined");
  });
});
