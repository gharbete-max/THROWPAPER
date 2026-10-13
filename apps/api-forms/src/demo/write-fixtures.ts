import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demoArrangedPdf, demoFormPdf } from './documents.js';

/**
 * Rewrites the PDFs in `fixtures/demo/`. The text and CSV there are written by hand; the picture is
 * `svStandard` from `fixtures/invoices/invoices.ts` drawn by the browser, as `e2e/invoice-scan.spec.ts`
 * does it (a screenshot of `invoiceHtml`), and is not rebuilt here.
 */
const directory = fileURLToPath(new URL('../../../../fixtures/demo/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(`${directory}form-to-fill.pdf`, await demoFormPdf(false));
await writeFile(`${directory}form-filled.pdf`, await demoFormPdf(true));
await writeFile(`${directory}arrange-me.pdf`, await demoArrangedPdf());
console.log(`wrote the demo PDFs to ${directory}`);
