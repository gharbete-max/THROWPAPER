import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entriesShown } from './RepeatingGroup.js';

/**
 * A repeating block, as the person filling in the form meets it.
 *
 * Checked in the source rather than by rendering, for the reason `field-describedby.test.ts` gives:
 * there is no DOM test setup in this workspace, and what matters here is structural — a block of
 * six identical questions repeated four times is unusable with a screen reader unless each
 * repetition says which one it is.
 */
const SOURCE = readFileSync(new URL('./RepeatingGroup.tsx', import.meta.url), 'utf8');

describe('how many entries are on screen', () => {
  it('shows what has been answered when that is enough', () => {
    expect(entriesShown([{ name: 'Alva' }], 0)).toEqual([{ name: 'Alva' }]);
  });

  it('pads up to the minimum, so a required block is not an empty box with a button', () => {
    expect(entriesShown([], 2)).toEqual([{}, {}]);
    expect(entriesShown([{ name: 'Alva' }], 2)).toEqual([{ name: 'Alva' }, {}]);
  });

  it('never returns the array it was given', () => {
    const entries = [{ name: 'Alva' }];
    expect(entriesShown(entries, 0)).not.toBe(entries);
  });
});

describe('what a screen reader hears', () => {
  /**
   * Six inputs called "Name" are six inputs called "Name" unless something says whose.
   *
   * A `fieldset` with a `legend` is what makes a reader announce "Guest 2" before each question
   * inside it, and it is the whole reason an entry is not a plain `div`.
   */
  it('wraps each entry in a fieldset with a legend', () => {
    expect(SOURCE).toMatch(/<fieldset[^>]*className="repeating-group__entry"/);
    expect(SOURCE).toMatch(/<legend[^>]*className="repeating-group__legend"/);
  });

  it('names the remove button after the entry it removes', () => {
    // "Remove" on four buttons in a column says nothing about which one is which.
    expect(SOURCE).toMatch(/aria-label=\{labels\.removeEntry\(/);
  });
});

describe('the cap', () => {
  /** A disabled button with no explanation is the version of this people press repeatedly. */
  it('says what the limit is instead of showing a button that does nothing', () => {
    expect(SOURCE).not.toMatch(/disabled=\{!canAdd\}/);
    expect(SOURCE).toContain('labels.full');
  });
});

describe('the children', () => {
  /**
   * The same component the rest of the form uses.
   *
   * A second renderer for nested fields drifts, and the first thing anybody learns is not to trust
   * whichever one they are looking at.
   */
  it('renders each question with the ordinary field renderer', () => {
    expect(SOURCE).toContain("from './FieldInput.js'");
    expect(SOURCE).toMatch(/<FieldInput/);
  });

  /** An error has to land on the box it came from, not on the block as a whole. */
  it('looks an error up by its full path', () => {
    expect(SOURCE).toMatch(/issueFor\(entryIssueKey\(field\.key, index, child\.key\)\)/);
  });
});
