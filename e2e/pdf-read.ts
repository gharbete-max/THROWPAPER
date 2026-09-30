import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * A PDF read the way a person sees it: drawn with pdf.js in the page, its text runs and where they
 * are, and the ink inside given boxes. Shared by the paper journeys (`paper-roundtrip.spec.ts`, and
 * the paper twin from an import, `paper-twin.spec.ts`).
 */

/** A box as fractions of the page as it is seen: left, top, right, bottom. */
export interface SeenBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Seen {
  runs: Array<{ text: string; x: number; y: number }>;
  /** Dark pixels inside each box (inset, so a border drawn around it is not counted). */
  ink: number[];
}

/** Draws page 1 of a PDF with pdf.js in the page, and reads it back as a person would see it. */
export async function see(page: Page, pdf: Buffer, boxes: SeenBox[]): Promise<Seen> {
  const read = (relative: string) =>
    readFileSync(new URL(`../apps/forms/node_modules/${relative}`, import.meta.url));
  for (const [route, file] of [
    ['**/__e2e/pdf.mjs', 'pdfjs-dist/legacy/build/pdf.min.mjs'],
    ['**/__e2e/pdf.worker.mjs', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'],
  ] as const) {
    await page.route(route, (r) =>
      r.fulfill({ body: read(file), contentType: 'text/javascript; charset=utf-8' }),
    );
  }
  return page.evaluate(
    async ({ bytes, boxes }) => {
      const load = new Function('url', 'return import(url)') as (u: string) => Promise<unknown>;
      type Viewport = {
        width: number;
        height: number;
        convertToViewportPoint: (x: number, y: number) => number[];
      };
      type TextItem = { str?: string; transform: number[] };
      type PdfPage = {
        getViewport: (o: { scale: number }) => Viewport;
        render: (o: unknown) => { promise: Promise<void> };
        getTextContent: () => Promise<{ items: TextItem[] }>;
      };
      const pdfjs = (await load('/__e2e/pdf.mjs')) as {
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (o: unknown) => {
          promise: Promise<{ getPage: (n: number) => Promise<PdfPage> }>;
        };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = '/__e2e/pdf.worker.mjs';
      const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      const first = await doc.getPage(1);
      const viewport = first.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d')!;
      await first.render({ canvasContext: context, viewport, canvas }).promise;

      const content = await first.getTextContent();
      const runs = content.items
        .filter((item) => typeof item.str === 'string' && item.str.trim())
        .map((item) => {
          const [x = 0, y = 0] = viewport.convertToViewportPoint(
            item.transform[4] ?? 0,
            item.transform[5] ?? 0,
          );
          return { text: item.str!, x: x / viewport.width, y: y / viewport.height };
        });

      const ink = boxes.map((box) => {
        const insetX = (box.x2 - box.x1) * 0.08;
        const insetY = (box.y2 - box.y1) * 0.08;
        const x = Math.round((box.x1 + insetX) * canvas.width);
        const y = Math.round((box.y1 + insetY) * canvas.height);
        const w = Math.round((box.x2 - box.x1 - 2 * insetX) * canvas.width);
        const h = Math.round((box.y2 - box.y1 - 2 * insetY) * canvas.height);
        const data = context.getImageData(x, y, w, h).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! + data[i + 1]! + data[i + 2]! < 384 && data[i + 3]! > 0) dark += 1;
        }
        return dark;
      });
      return { runs, ink };
    },
    { bytes: Array.from(pdf), boxes },
  );
}

/** The run from which the following runs spell `answer` (Chromium may split a word). */
export function findAnswer(runs: Seen['runs'], answer: string) {
  return runs.find((_, i) =>
    runs
      .slice(i)
      .map((run) => run.text)
      .join('')
      .replace(/\s+/g, '')
      .startsWith(answer.replace(/\s+/g, '')),
  );
}
