import { describe, expect, it } from 'vitest';
import { documentNameOf, pdfFromState, signingWith } from './sign-handoff.js';

const pdf = new File(['%PDF-1.7'], 'Lease 2027.pdf', { type: 'application/pdf' });

describe('handing a PDF to Signing', () => {
  it('goes to the Signing screen with the file in route state, not in the address', () => {
    const [to, options] = signingWith(pdf);
    expect(to).toBe('/signing');
    expect(to).not.toContain('Lease');
    expect(pdfFromState(options.state)).toBe(pdf);
  });

  it('finds nothing in state that is not a file', () => {
    expect(pdfFromState(null)).toBeNull();
    expect(pdfFromState({ signPdf: 'x.pdf' })).toBeNull();
    expect(pdfFromState({})).toBeNull();
  });

  it('names the document without its extension', () => {
    expect(documentNameOf(pdf)).toBe('Lease 2027');
  });
});
