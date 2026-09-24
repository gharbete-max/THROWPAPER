import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPdfRenderer, type PdfRenderer } from './render.js';

/**
 * If an escape is ever missed, the renderer must turn it into nothing: no script runs, and nothing
 * is fetched — not from the internet, not from the machine's own metadata address.
 */
let renderer: PdfRenderer;
let hits = 0;
const server = createServer((_request, response) => {
  hits += 1;
  response.end('x');
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  renderer = createPdfRenderer();
}, 60_000);

afterAll(async () => {
  await renderer?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function text(pdf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

describe('the PDF renderer, given something it should never have been given', () => {
  it('runs no script and fetches nothing', async () => {
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const pdf = await renderer.render(`<!doctype html><html><body>
      <p>Before</p>
      <script>document.body.innerHTML = '<p>INJECTED</p>'</script>
      <img src="${origin}/pixel.png">
      <iframe src="${origin}/frame"></iframe>
      <link rel="stylesheet" href="${origin}/style.css">
    </body></html>`);
    const written = await text(pdf);
    expect(written).toContain('Before');
    expect(written).not.toContain('INJECTED');
    expect(hits).toBe(0);
  });
});
