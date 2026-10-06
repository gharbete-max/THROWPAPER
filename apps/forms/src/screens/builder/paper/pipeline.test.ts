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
import { readDocument } from './pipeline.js';
import { NoWorker, readInWorker } from './read-in-worker.js';

/**
 * Stages 2 to 7 as the paper door runs them: `readDocument`, the function the worker runs. The
 * worker itself is pressed in `e2e/paper-import.spec.ts`.
 */

describe('reading a document', () => {
  it('reads a Word file through every stage, from layout to score', async () => {
    const raw = await readDocx(
      docxBytes({
        body: [paragraph('ANMÄLAN', '', '<w:b/>'), numbered('Namn', 1), numbered('Adress', 1)].join(
          '',
        ),
        numbering: numberingXml(abstractList(0, [['decimal', '%1.']]) + list(1, 0)),
      }),
    );
    const reading = readDocument({ kind: 'raw', raw });
    expect(layoutProblems(reading.layout)).toEqual([]);
    expect(reading.debug.map((d) => d.stage)).toEqual([
      'reassemble',
      'enumerate',
      'segment',
      'classify',
      'score',
    ]);
    expect(reading.lists.items.map((i) => [i.marker.raw, i.label])).toEqual([
      ['1.', 'Namn'],
      ['2.', 'Adress'],
    ]);
    expect(reading.segments.segments.map((s) => s.kind)).toEqual([
      'heading',
      'question',
      'question',
    ]);
    expect(reading.classified.classified.map((c) => c.kind)).toEqual(['short_text', 'address']);
    expect(reading.scored.counts.questions).toBe(2);
  });

  it('reads a paste from the list detector on, with no layout stage to run', async () => {
    const reading = readDocument({ kind: 'paste', text: '1. Namn\n2. Adress' });
    expect(reading.debug.map((d) => d.stage)).toEqual([
      'enumerate',
      'segment',
      'classify',
      'score',
    ]);
    expect(reading.lists.items).toHaveLength(2);
  });

  it('downloads as one JSON file holding everything that was read', async () => {
    const reading = readDocument({ kind: 'paste', text: 'a) Ja\nb) Nej' });
    const file = JSON.parse(readingFile(reading)) as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual([
      'classified',
      'debug',
      'fields',
      'layout',
      'lists',
      'readingVersion',
      'scored',
      'segments',
    ]);
    expect(file.readingVersion).toBe(2);
  });
});

describe('without a worker', () => {
  it('says so, and reads nothing on the page (the stages live in the worker only)', async () => {
    expect(typeof Worker).toBe('undefined');
    await expect(readInWorker({ kind: 'paste', text: '1. Namn' })).rejects.toBeInstanceOf(NoWorker);
  });
});
