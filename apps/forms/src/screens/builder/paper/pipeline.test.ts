import { describe, expect, it } from 'vitest';
import { layoutProblems } from '@tp/shared/import';
import {
  abstractList,
  docxBytes,
  list,
  numbered,
  numberingXml,
  paragraph,
} from './docx.fixture.js';
import { readDocx } from './docx.js';
import { readingFile } from './reading.js';
import { readInWorker } from './read-in-worker.js';

/**
 * Stages 2 and 3 as the paper door runs them. Here there is no `Worker`, so `readInWorker` runs
 * the same function on the page; the worker itself is pressed in `e2e/paper-import.spec.ts`.
 */

describe('reading a document', () => {
  it('reads a Word file through the layout stage and the list detector', async () => {
    const raw = await readDocx(
      docxBytes({
        body: [paragraph('ANMÄLAN', '', '<w:b/>'), numbered('Namn', 1), numbered('Adress', 1)].join(
          '',
        ),
        numbering: numberingXml(abstractList(0, [['decimal', '%1.']]) + list(1, 0)),
      }),
    );
    const reading = await readInWorker({ kind: 'raw', raw });
    expect(layoutProblems(reading.layout)).toEqual([]);
    expect(reading.debug.map((d) => d.stage)).toEqual(['reassemble', 'enumerate']);
    expect(reading.lists.items.map((i) => [i.marker.raw, i.label])).toEqual([
      ['1.', 'Namn'],
      ['2.', 'Adress'],
    ]);
  });

  it('reads a paste through the list detector alone', async () => {
    const reading = await readInWorker({ kind: 'paste', text: '1. Namn\n2. Adress' });
    expect(reading.debug.map((d) => d.stage)).toEqual(['enumerate']);
    expect(reading.lists.items).toHaveLength(2);
  });

  it('downloads as one JSON file holding everything that was read', async () => {
    const reading = await readInWorker({ kind: 'paste', text: 'a) Ja\nb) Nej' });
    const file = JSON.parse(readingFile(reading)) as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual(['debug', 'layout', 'lists', 'readingVersion']);
  });
});
