import { describe, expect, it } from 'vitest';
import { AiError } from '../engine.js';
import type { FromWorker, ToWorker } from '../text/worker-core.js';
import { NodeLlamaEngine, type WorkerHandle } from './node-llama-engine.js';

/** A worker the test speaks for, message by message. */
function scripted() {
  const posted: ToWorker[] = [];
  const messages: Array<(m: FromWorker) => void> = [];
  const exits: Array<() => void> = [];
  let killed = 0;
  const handle: WorkerHandle = {
    post: (m) => posted.push(m),
    onMessage: (l) => messages.push(l),
    onExit: (l) => exits.push(l),
    kill: () => void (killed += 1),
  };
  return {
    handle,
    posted,
    say: (m: FromWorker) => messages.forEach((l) => l(m)),
    exit: () => exits.forEach((l) => l()),
    killed: () => killed,
  };
}

const JOB = { kind: 'translate', text: 'Hi', into: 'sv-SE' } as const;
const never = new AbortController().signal;

async function loaded() {
  const worker = scripted();
  const engine = new NodeLlamaEngine(() => worker.handle, '/models/m.gguf');
  const loading = engine.load(never);
  worker.say({ type: 'loaded' });
  await loading;
  return { worker, engine };
}

describe('the text engine around its utility process', () => {
  it('asks the worker to load the weights path, and resolves when it has', async () => {
    const worker = scripted();
    const engine = new NodeLlamaEngine(() => worker.handle, '/models/m.gguf');
    const loading = engine.load(never);
    expect(worker.posted).toEqual([{ type: 'load', path: '/models/m.gguf' }]);
    worker.say({ type: 'loaded' });
    await loading;
  });

  it('rejects a load the worker could not do, with its problem', async () => {
    const worker = scripted();
    const engine = new NodeLlamaEngine(() => worker.handle, 'x');
    const loading = engine.load(never);
    worker.say({ type: 'load-failed', problem: 'cannot-start', detail: 'no binary' });
    await expect(loading).rejects.toMatchObject({ problem: 'cannot-start' });
  });

  it('stops waiting for a load when aborted', async () => {
    const worker = scripted();
    const engine = new NodeLlamaEngine(() => worker.handle, 'x');
    const abort = new AbortController();
    const loading = engine.load(abort.signal);
    abort.abort();
    await expect(loading).rejects.toMatchObject({ problem: 'cancelled' });
  });

  it('relays a run: events without the worker id, then done with its warnings', async () => {
    const { worker, engine } = await loaded();
    const seen: unknown[] = [];
    const run = engine.run(JOB, (e) => seen.push(e), never);
    const { id } = worker.posted.at(-1) as { type: 'run'; id: string };
    worker.say({ type: 'event', event: { id, kind: 'text', mode: 'append', text: 'Hej' } });
    worker.say({
      type: 'event',
      event: { id: 'someone-else', kind: 'text', mode: 'append', text: 'no' },
    });
    worker.say({
      type: 'event',
      event: { id, kind: 'done', warnings: [{ kind: 'repetition' }], seconds: 1 },
    });
    expect(await run).toEqual({ warnings: [{ kind: 'repetition' }] });
    expect(seen).toEqual([{ kind: 'text', mode: 'append', text: 'Hej' }]);
  });

  it('turns the worker error into the problem', async () => {
    const { worker, engine } = await loaded();
    const run = engine.run(JOB, () => undefined, never);
    const { id } = worker.posted.at(-1) as { id: string };
    worker.say({ type: 'event', event: { id, kind: 'error', problem: 'quote-only' } });
    await expect(run).rejects.toMatchObject({ problem: 'quote-only' });
  });

  it('posts a cancel to the worker when aborted, so generation stops at the next token', async () => {
    const { worker, engine } = await loaded();
    const abort = new AbortController();
    const run = engine.run(JOB, () => undefined, abort.signal);
    const { id } = worker.posted.at(-1) as { id: string };
    abort.abort();
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', id });
    worker.say({ type: 'event', event: { id, kind: 'error', problem: 'cancelled' } });
    await expect(run).rejects.toMatchObject({ problem: 'cancelled' });
  });

  it('fails the task, as cannot-start, when the process exits under it', async () => {
    const { worker, engine } = await loaded();
    const run = engine.run(JOB, () => undefined, never);
    worker.exit();
    await expect(run).rejects.toBeInstanceOf(AiError);
    await expect(run).rejects.toMatchObject({ problem: 'cannot-start' });
  });

  it('refuses a task that is not text, and a second task while one runs', async () => {
    const { engine } = await loaded();
    await expect(
      engine.run(
        {
          kind: 'read-page',
          fileSha256: 'a'.repeat(64),
          page: 1,
          png: new Uint8Array(),
          language: null,
        },
        () => undefined,
        never,
      ),
    ).rejects.toMatchObject({ problem: 'not-available' });
    void engine.run(JOB, () => undefined, never);
    await expect(engine.run(JOB, () => undefined, never)).rejects.toMatchObject({
      problem: 'busy',
    });
  });

  it('ends the process on dispose, which is how the memory comes back', async () => {
    const { worker, engine } = await loaded();
    await engine.dispose();
    expect(worker.posted.at(-1)).toEqual({ type: 'dispose' });
    expect(worker.killed()).toBe(1);
    await engine.dispose();
    expect(worker.killed()).toBe(1);
  });
});
