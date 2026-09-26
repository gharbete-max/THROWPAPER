import { describe, expect, it } from 'vitest';
import { BUILDER_GRAPH, answer, begin, type Conversation } from '@tp/shared/builder';
import { emptyDefinition, type FormDefinition } from '@tp/shared/forms';
import { Saver, type SaveStatus, type SaverApi } from './saver.js';

/**
 * Autosave — `CAVEATS.md` #45 (`never-lose-work`), the screen's half: every step saved, in order,
 * the draft before the session, and a second tab never overwritten.
 */

const G = BUILDER_GRAPH;
const first = begin(G, { definition: emptyDefinition, title: {} });
const next = (c: Conversation, optionId: string) =>
  answer(G, c, { kind: 'option', optionId }, { locale: 'sv-SE' });

/** A fake server whose answers the test releases one at a time. */
function server() {
  const calls: string[] = [];
  const gates: (() => void)[] = [];
  let version = 0;
  let fail: 'conflict' | 'down' | null = null;
  const wait = () => new Promise<void>((resolve) => gates.push(resolve));
  const api: SaverApi = {
    async saveDraft(_id: string, definition: FormDefinition) {
      calls.push(`draft ${definition.fields.length}`);
      await wait();
      if (fail === 'down') throw new Error('offline');
    },
    async saveBuilderSession(_id, read, session) {
      calls.push(`session v${read} log ${session.log.length}`);
      await wait();
      if (fail === 'conflict') throw Object.assign(new Error('conflict'), { status: 409 });
      if (fail === 'down') throw new Error('offline');
      version = read + 1;
      return { version };
    },
  };
  const flush = async () => {
    // Release every pending request, including those the releases start.
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
      gates.shift()?.();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    api,
    calls,
    flush,
    failWith: (how: typeof fail) => {
      fail = how;
    },
  };
}

function saverFor(s: ReturnType<typeof server>) {
  const statuses: SaveStatus[] = [];
  const saver = new Saver(s.api, G, 'form-1', { version: 0, draft: emptyDefinition }, (status) =>
    statuses.push(status),
  );
  return { saver, statuses };
}

describe('the saver', () => {
  it('saves the draft, then the session over the version it read', async () => {
    const s = server();
    const { saver, statuses } = saverFor(s);
    const c = next(first, 'signup');
    const done = saver.save(c);
    await s.flush();
    await done;
    expect(s.calls).toEqual(['draft 1', 'session v0 log 1']);
    expect(statuses).toEqual(['saving', 'saved']);
  });

  it('never overlaps saves, and saves only the newest of the steps taken meanwhile', async () => {
    const s = server();
    const { saver } = saverFor(s);
    const one = next(first, 'signup');
    const two = next(one, 'later');
    const three = answer(G, two, { kind: 'text', value: 'Dag?' }, { locale: 'sv-SE' });
    const saving = saver.save(one);
    void saver.save(two);
    void saver.save(three);
    await s.flush();
    await saving;
    expect(s.calls).toEqual(['draft 1', 'session v0 log 1', 'draft 2', 'session v1 log 3']);
  });

  it('does not save a draft that has not changed', async () => {
    const s = server();
    const { saver } = saverFor(s);
    const one = next(first, 'signup');
    const two = next(one, 'later'); // the brand question writes no field
    void saver.save(one);
    await s.flush();
    void saver.save(two);
    await s.flush();
    expect(s.calls).toEqual(['draft 1', 'session v0 log 1', 'session v1 log 2']);
  });

  it('stops at a conflict, and saves nothing more over the other tab', async () => {
    const s = server();
    const { saver, statuses } = saverFor(s);
    s.failWith('conflict');
    void saver.save(next(first, 'signup'));
    await s.flush();
    expect(statuses.at(-1)).toBe('conflict');
    void saver.save(next(next(first, 'signup'), 'later'));
    await s.flush();
    expect(s.calls).toEqual(['draft 1', 'session v0 log 1']);
  });

  it('says when nothing is left saving', async () => {
    const s = server();
    const { saver } = saverFor(s);
    let settled = false;
    void saver.save(next(first, 'signup'));
    void saver.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await s.flush();
    expect(settled).toBe(true);
    expect(saver.status).toBe('saved');
  });

  it('keeps a failed step, and saves it on retry', async () => {
    const s = server();
    const { saver, statuses } = saverFor(s);
    s.failWith('down');
    void saver.save(next(first, 'signup'));
    await s.flush();
    expect(saver.status).toBe('failed');
    s.failWith(null);
    void saver.retry();
    await s.flush();
    expect(statuses.at(-1)).toBe('saved');
    expect(s.calls).toEqual(['draft 1', 'draft 1', 'session v0 log 1']);
  });
});
