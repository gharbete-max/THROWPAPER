import { describe, expect, it } from 'vitest';
import type { AiBridge, AiEvent, AiProblem, AiTask, StructuredPage } from '@tp/shared/ai';
import { emailAboutFromState, emailAboutWith } from '../../../lib/email-about-handoff.js';
import { summaryTextFromState, summaryWithText } from '../../../lib/documents-handoff.js';
import { readPages, type ReadablePage } from './read-document.js';

/**
 * Reading a document page by page (docs/plan/AI-SYSTEM.md D4) against a bridge that answers as the
 * shell does: one page per task, in order, a failed page listed and the rest read, a problem that
 * would fail every page stopping the run, the page's own text layer deciding "uncertain".
 */
function page(text: string, status = 'ok', reason: string | null = null) {
  return JSON.stringify({
    page: 1,
    status,
    reason,
    blocks:
      status === 'failed'
        ? []
        : [{ type: 'paragraph', text, page: 1, box: null, language: 'en', confidence: 0.7 }],
  });
}

function bridgeAnswering(answer: (task: AiTask, n: number) => string | AiProblem) {
  const listeners = new Set<(event: AiEvent) => void>();
  const tasks: AiTask[] = [];
  const cancelled: string[] = [];
  const bridge = {
    onEvent(listener: (event: AiEvent) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    run(id: string, task: AiTask) {
      tasks.push(task);
      const result = answer(task, tasks.length);
      setTimeout(() => {
        for (const listener of listeners) {
          if (result.startsWith('{')) {
            listener({ id, kind: 'text', mode: 'replace', text: result });
            listener({ id, kind: 'done', warnings: [], seconds: 1 });
          } else {
            listener({ id, kind: 'error', problem: result as AiProblem });
          }
        }
      }, 0);
      return Promise.resolve({ ok: true as const, id });
    },
    cancel(id: string) {
      cancelled.push(id);
      return Promise.resolve();
    },
  } as unknown as AiBridge;
  return { bridge, tasks, cancelled };
}

const source = (n: number, layer: string | null = null): ReadablePage => ({
  fileSha256: 'e'.repeat(64),
  pageInFile: n,
  turn: 0,
  language: null,
  picture: () =>
    Promise.resolve({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), longEdge: 1200 }),
  layer: () => Promise.resolve(layer),
});

async function read(
  pages: ReadablePage[],
  bridge: AiBridge,
  signal = new AbortController().signal,
) {
  const done = new Map<number, StructuredPage>();
  const order: string[] = [];
  const outcome = await readPages({
    bridge,
    pages,
    indexes: pages.map((_, i) => i),
    quality: 'normal',
    signal,
    onPage: (index, state, result) => {
      order.push(`${index}:${state}`);
      if (result) done.set(index + 1, result);
    },
  });
  return { done, order, outcome };
}

describe('reading pages', () => {
  it('reads them one at a time in order, each as the page it is in the document', async () => {
    const { bridge, tasks } = bridgeAnswering((_task, n) => page(`text ${n}`));
    const { done, order, outcome } = await read([source(1), source(2), source(3)], bridge);
    expect(outcome.stopped).toBeNull();
    expect(order).toEqual(['0:reading', '0:done', '1:reading', '1:done', '2:reading', '2:done']);
    expect([...done.values()].map((p) => [p.page, p.blocks[0]!.page])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(tasks.map((t) => (t.kind === 'read-page' ? t.page : 0))).toEqual([1, 2, 3]);
  });

  it('lists a page that failed and a page that cannot be understood, and reads on', async () => {
    const { bridge } = bridgeAnswering((_t, n) =>
      n === 1 ? 'failed' : n === 2 ? '{"nonsense":1}' : page('ok'),
    );
    const { done } = await read([source(1), source(2), source(3)], bridge);
    expect(done.get(1)).toMatchObject({ status: 'failed', reason: 'failed' });
    expect(done.get(2)).toMatchObject({ status: 'failed', reason: 'unreadable-output' });
    expect(done.get(3)).toMatchObject({ status: 'ok' });
  });

  it('stops at a problem that would fail every page, leaving the rest unread', async () => {
    const { bridge, tasks } = bridgeAnswering(() => 'too-little-memory');
    const { done, outcome } = await read([source(1), source(2)], bridge);
    expect(outcome.stopped).toBe('too-little-memory');
    expect(done.size).toBe(0);
    expect(tasks).toHaveLength(1);
  });

  it('marks a page uncertain when its own text layer says something else', async () => {
    const layer =
      'Invoice number 20260412 date 2026-10-01 due 2026-10-31 total 1250 kr bank giro 5555 1234 reference 99887766 customer Demo AB thank you';
    const { bridge } = bridgeAnswering((_t, n) =>
      page(
        n === 1
          ? layer
          : 'Something else entirely written here that shares nothing with the layer at all today',
      ),
    );
    const { done } = await read([source(1, layer), source(2, layer)], bridge);
    expect(done.get(1)).toMatchObject({ status: 'ok' });
    expect(done.get(2)).toMatchObject({ status: 'uncertain', reason: 'mismatch' });
  });

  it('cancels the page under way and goes no further when stopped', async () => {
    const abort = new AbortController();
    const { bridge, tasks, cancelled } = bridgeAnswering(() => {
      abort.abort();
      return 'cancelled';
    });
    const { outcome } = await read([source(1), source(2)], bridge, abort.signal);
    expect(outcome.stopped).toBe('cancelled');
    expect(tasks).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
  });

  it('lists a page that could not be drawn instead of dropping it', async () => {
    const { bridge, tasks } = bridgeAnswering(() => page('x'));
    const broken: ReadablePage = {
      ...source(1),
      picture: () => Promise.reject(new Error('no canvas')),
    };
    const { done } = await read([broken, source(2)], bridge);
    expect(done.get(1)).toMatchObject({ status: 'failed' });
    expect(tasks).toHaveLength(1);
  });
});

describe('what is handed to the next screen', () => {
  it('travels in memory as state and comes back only when it is the right shape', () => {
    const [route, { state }] = emailAboutWith({
      purpose: 'feedback',
      material: '1. spelling: "x"',
      quotes: ['x'],
      recipient: 'Anna',
      overall: 'mixed',
    });
    expect(route).toBe('/send');
    expect(emailAboutFromState(state)).toMatchObject({
      purpose: 'feedback',
      quotes: ['x'],
      overall: 'mixed',
    });
    for (const bad of [null, {}, { emailAbout: { material: '  ' } }, { emailAbout: 'x' }]) {
      expect(emailAboutFromState(bad)).toBeNull();
    }
    expect(summaryTextFromState(summaryWithText('Page 1\nhello')[1].state)).toBe('Page 1\nhello');
    expect(summaryTextFromState({ summaryText: ' ' })).toBeNull();
  });
});
