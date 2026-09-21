import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where focus goes after a scan.
 *
 * The door refocused the reference field after every check-in, whichever way the code arrived.
 * On a phone that is the keyboard: a scan decoded from the camera put focus in the field, the
 * keyboard rose, and it rose over the viewfinder that sits below the form — so the second guest
 * in the queue was scanned into a screen that had just hidden the camera.
 *
 * The policy is one sentence: while the camera runs, the camera is the input, and focus is left
 * where it is. When it does not, typing is the input, and the field takes focus back after a
 * check-in or an undo — a keyboard-wedge scanner on a laptop keeps working as it always did, and
 * so does the field when the camera cannot start.
 *
 * Checked in the source: focusing needs a document, and this workspace has no DOM.
 */
const SOURCE = readFileSync(new URL('./CheckIn.tsx', import.meta.url), 'utf8');

describe('focus at the door', () => {
  it('moves focus to the field in exactly one place, and that place asks about the camera', () => {
    const focuses = SOURCE.match(/inputRef\.current\?\.focus\(\)/g) ?? [];
    expect(focuses).toHaveLength(1);
    expect(SOURCE).toMatch(/if \(!controlsRef\.current\) inputRef\.current\?\.focus\(\);/);
  });

  it('never refocuses unconditionally after a check-in or an undo', () => {
    // The two `finally` blocks go through the policy, not around it.
    const finallyBlocks = SOURCE.match(/finally \{[\s\S]*?\}/g) ?? [];
    expect(finallyBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of finallyBlocks) {
      expect(block).not.toContain('inputRef.current');
      expect(block).toContain('refocus()');
    }
  });
});
