import { describe, expect, it } from 'vitest';
import { readDraft, type DraftFormTask } from '@tp/shared/ai';
import { runJob, type Sink } from './pipeline.js';
import { FakeTextEngine } from './fake-text-engine.js';
import { JobError } from './text-engine.js';

/** "Draft a form" (docs/plan/EASY.md, E4): the request is data, a contract is refused, the answer reads as fields. */
const task = (request: string): DraftFormTask => ({ kind: 'draft-form', request, into: 'en-GB' });

async function run(request: string) {
  let text = '';
  const sink: Sink = {
    step: () => undefined,
    text: (mode, piece) => {
      text = mode === 'replace' ? piece : text + piece;
    },
    selected: () => undefined,
  };
  await runJob(new FakeTextEngine(), task(request), sink, new AbortController().signal);
  return text;
}

describe('draft-form', () => {
  it('answers with JSON that reads as a form', async () => {
    const draft = readDraft(await run('sign-up for a football camp'), 'en-GB');
    expect(draft?.fields.map((field) => field.type)).toEqual([
      'short_text',
      'email',
      'single_select',
    ]);
  });

  it('refuses a contract: such a form is a person’s to write', async () => {
    await expect(run('a consent form for surgery')).rejects.toBeInstanceOf(JobError);
  });
});
