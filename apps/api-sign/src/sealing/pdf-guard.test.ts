import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { checkPdf } from './pdf-guard.js';
import { objectStreamBomb } from '../test-pdf-bomb.js';

describe('opening an uploaded PDF on a budget', () => {
  it('passes an ordinary document, with its page count', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    expect(await checkPdf(await doc.save())).toEqual({ ok: true, pages: 2 });
  });

  it('refuses what is not a PDF, or has no pages, as unreadable', async () => {
    expect(await checkPdf(Buffer.from('not a pdf'))).toEqual({ ok: false, reason: 'unreadable' });
    const empty = await PDFDocument.create();
    expect(await checkPdf(await empty.save({ addDefaultPage: false }))).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('refuses an object-stream bomb within the deadline, and the server keeps answering', async () => {
    const bomb = objectStreamBomb(400_000);
    expect(bomb.length).toBeLessThan(4_000_000);

    let ticks = 0;
    const heartbeat = setInterval(() => (ticks += 1), 50);
    const started = Date.now();
    const result = await checkPdf(bomb, { timeoutMs: 1_500, heapMb: 256 });
    clearInterval(heartbeat);

    expect(result).toEqual({ ok: false, reason: 'too-costly' });
    expect(Date.now() - started).toBeLessThan(3_000);
    // The main thread was free the whole time: the event loop kept ticking.
    expect(ticks).toBeGreaterThan(15);
  }, 20_000);
});
