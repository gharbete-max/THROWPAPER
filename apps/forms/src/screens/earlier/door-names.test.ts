import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the door's controls are called when they cannot be seen.
 *
 * Five arrivals, five buttons, one name: "Undo". A screen reader lists them and nothing tells
 * them apart, so the operator taking back a mis-scan is guessing which row they are on. The
 * visible word stays "Undo" — the row already shows who — and the person's name follows it in
 * visually hidden text, so each button is announced as "Undo Göran Häggkvist".
 *
 * The count carried its sentence in `aria-label` on a `<p>`, which browsers do not reliably
 * expose on a paragraph. The same sentence is now text on the page, hidden from sight, with the
 * two visual fragments hidden from the reader — the number is read once, as a sentence.
 *
 * Checked in the source, as the field tests are: there is no DOM in this workspace.
 */
const SOURCE = readFileSync(new URL('./CheckIn.tsx', import.meta.url), 'utf8');

describe('the door, unseen', () => {
  it('names each undo after its arrival', () => {
    const undo =
      /<button[^>]*onClick=\{\(\) => void undo\(arrival\)\}[^>]*>[\s\S]*?<\/button>/.exec(
        SOURCE,
      )?.[0];
    expect(undo, 'the undo button').toBeTruthy();
    expect(undo).toContain("t('checkin.undo')");
    expect(undo).toMatch(/className="visually-hidden">[\s\S]*?\{who\}/);
  });

  it('keys each arrival by its card, not its registration', () => {
    // A member and their guest share a submission id; the reference is per card.
    expect(SOURCE).toContain('key={arrival.attendee.reference}');
  });

  it('never prints the browser’s own camera error on the screen', () => {
    // `error.message` is English on a Swedish door; the catalogue sentence is what is shown.
    expect(SOURCE).not.toMatch(/\{cameraError\}/);
    expect(SOURCE).toContain("t('checkin.cameraUnavailable')");
  });

  it('puts no aria-label on a paragraph', () => {
    expect(SOURCE).not.toMatch(/<p\b[^>]*aria-label/);
  });

  it('reads the count as one sentence', () => {
    expect(SOURCE).toMatch(/visually-hidden">\s*\{t\('checkin\.counts'/);
    // The visual fragments would otherwise be read a second time, out of order.
    expect(SOURCE).toMatch(/door__countIn"[^>]*aria-hidden="true"/);
    expect(SOURCE).toMatch(/door__countOf[^>]*aria-hidden="true"/);
  });
});
