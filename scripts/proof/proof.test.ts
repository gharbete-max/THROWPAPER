/**
 * The phase 1 gate — START-HERE.md §Checkpoints:
 *
 *   "If one token change does not reach web, PDF and email, stop and solve that.
 *    Everything downstream assumes it."
 *
 * One token changes here, and all three targets have to move. This is the slow test in the
 * suite: it launches Chromium and renders a real PDF, on purpose. Asserting on the compiler
 * output alone would prove the strings are right, not that a renderer honours them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { renderWeb } from './render-web.js';
import { renderEmail } from './render-email.js';
import { renderPdf } from './render-pdf.js';
import { NORDIC_PROBE, proofCard } from './card.js';

const PRIMARY = '#ff0000';
const tokens: TokenSet = {
  ...defaultTokens,
  colour: { ...defaultTokens.colour, primary: PRIMARY },
};

let web: string;
let email: string;
let headingColour: string;
let pdfText: string;

beforeAll(async () => {
  web = renderWeb(tokens);
  email = await renderEmail(tokens);
  const result = await renderPdf(tokens);
  headingColour = result.headingColour;
  pdfText = await extractText(result.pdf);
}, 120_000);

describe('a single token change reaches every target', () => {
  it('reaches web, as a custom property', () => {
    expect(web).toContain(`--tp-colour-primary: ${PRIMARY};`);
    expect(web).toContain('var(--tp-colour-primary)');
  });

  it('reaches email, resolved to a literal', () => {
    expect(email.toLowerCase()).toContain(PRIMARY);
  });

  it('reaches the PDF — Chromium computes the heading in the new colour', () => {
    expect(headingColour).toBe('rgb(255, 0, 0)');
  });
});

describe('email output stays email-safe', () => {
  it('carries no custom properties, which no email client resolves', () => {
    expect(email).not.toContain('var(--');
  });

  it('lays out with tables', () => {
    expect(email).toContain('<table');
  });
});

describe('the PDF renders Nordic text', () => {
  it('keeps å ä ö intact through the embedded font', () => {
    expect(squash(pdfText)).toContain(NORDIC_PROBE);
    expect(squash(pdfText)).toContain(squash(proofCard.title));
  });

  it('prints the running header and page numbers Chromium supplies', () => {
    expect(squash(pdfText)).toContain('DemoAB');
    expect(squash(pdfText)).toContain('1/1');
  });
});

/** PDF text extraction spaces glyphs by position, so compare without whitespace. */
function squash(value: string): string {
  return value.replace(/\s+/g, '');
}

async function extractText(pdf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  let text = '';
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  }
  return text;
}
