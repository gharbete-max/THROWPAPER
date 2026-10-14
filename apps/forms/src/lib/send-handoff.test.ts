import { describe, expect, it } from 'vitest';
import { addressesOf, isSendable, sendFileFromState, sendWith, subjectOf } from './send-handoff.js';

const pdf = new File(['%PDF-1.7'], 'Lease 2027.pdf', { type: 'application/pdf' });

describe('handing a document to Send', () => {
  it('goes to the Send screen with the file in route state, not in the address', () => {
    const [to, options] = sendWith(pdf);
    expect(to).toBe('/send');
    expect(to).not.toContain('Lease');
    expect(sendFileFromState(options.state)).toBe(pdf);
  });

  it('finds nothing in state that is not a file', () => {
    expect(sendFileFromState(null)).toBeNull();
    expect(sendFileFromState({ sendFile: 'x.pdf' })).toBeNull();
    expect(sendFileFromState({})).toBeNull();
  });

  it('sends a PDF or a Word file, and nothing else', () => {
    expect(isSendable(pdf)).toBe(true);
    expect(isSendable(new File([''], 'Offert.DOCX'))).toBe(true);
    expect(isSendable(new File([''], 'bild.png', { type: 'image/png' }))).toBe(false);
    expect(isSendable(new File([''], 'old.doc'))).toBe(false);
  });

  it('starts the subject from the file name', () => {
    expect(subjectOf(pdf)).toBe('Lease 2027');
  });

  it('reads addresses from lines, commas and semicolons, once each', () => {
    expect(addressesOf('a@x.se, b@x.se;\nc@x.se  a@x.se\n')).toEqual([
      'a@x.se',
      'b@x.se',
      'c@x.se',
    ]);
    expect(addressesOf('  ')).toEqual([]);
    expect(addressesOf('Asa@x.se asa@X.se')).toEqual(['Asa@x.se']);
  });
});
