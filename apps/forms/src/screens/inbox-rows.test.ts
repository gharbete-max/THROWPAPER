import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages } from '../lib/messages/all.js';

/**
 * A row on Responses says what differs, in the product's own date format.
 *
 * Forty-one rows wore forty-one identical "Submitted" badges: a mark on everything marks
 * nothing. The badge is for the exception — a response still in progress — and only that. The
 * arrival time was `toLocaleString`, which carries seconds and its own idea of the format; the
 * door formats the same moment with `formatDateTime`, and a product that shows one time two ways
 * reads as two products.
 *
 * Checked in the source, as the other screen tests are: there is no DOM in this workspace.
 */
const SOURCE = readFileSync(new URL('./Inbox.tsx', import.meta.url), 'utf8');

describe('a Responses row', () => {
  it('formats the arrival like the rest of the product', () => {
    expect(SOURCE).not.toContain('toLocaleString');
    expect(SOURCE).toMatch(/formatDateTime\(locale, entry\.submittedAt \?\? entry\.createdAt\)/);
  });

  it('wears a badge only when something is still in progress', () => {
    expect(SOURCE).toMatch(/entry\.status !== 'complete' && \(/);
    expect(SOURCE).not.toContain("'inbox.complete'");
    // The key goes with it: a catalogue entry nothing asks for is a translation nobody checks.
    expect((messages as Record<string, unknown>)['inbox.complete']).toBeUndefined();
  });
});
