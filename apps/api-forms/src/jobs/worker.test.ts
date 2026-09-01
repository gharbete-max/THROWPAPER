import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db/repositories/index.js';
import { testOrganisation } from '../test-support.js';
import { createWorker, type JobHandler } from './worker.js';

function setup(handlers: Record<string, JobHandler>, now = () => new Date()) {
  const repos = createMemoryRepositories({ organisations: [testOrganisation] });
  const worker = createWorker({ repos, handlers, now, backoffBaseMs: 1_000 });
  return { repos, worker };
}

function enqueue(repos: ReturnType<typeof createMemoryRepositories>, overrides = {}) {
  return repos.jobs.enqueue({
    organisationId: testOrganisation.id,
    kind: 'test.job',
    idempotencyKey: 'key-1',
    payload: {},
    progressTotal: 3,
    ...overrides,
  });
}

describe('enqueueing', () => {
  it('is idempotent on the key — the same request twice is one job', async () => {
    const { repos } = setup({});
    const first = await enqueue(repos);
    const second = await enqueue(repos);

    expect(second.id).toBe(first.id);
    expect(repos.state.jobs).toHaveLength(1);
  });

  it('treats a different key as a different job', async () => {
    const { repos } = setup({});
    await enqueue(repos);
    await enqueue(repos, { idempotencyKey: 'key-2' });
    expect(repos.state.jobs).toHaveLength(2);
  });
});

describe('running', () => {
  it('runs a queued job and records the result', async () => {
    const { repos, worker } = setup({ 'test.job': async () => ({ produced: 3 }) });
    const job = await enqueue(repos);

    expect(await worker.runOnce()).toBe(true);
    const finished = await repos.jobs.findById(testOrganisation.id, job.id);
    expect(finished?.status).toBe('done');
    expect(finished?.result).toEqual({ produced: 3 });
  });

  it('reports nothing to do on an empty queue', async () => {
    const { worker } = setup({});
    expect(await worker.runOnce()).toBe(false);
  });

  it('claims each job once, so two passes do not double-run it', async () => {
    let runs = 0;
    const { repos, worker } = setup({
      'test.job': async () => {
        runs += 1;
        return {};
      },
    });
    await enqueue(repos);

    await worker.drain();
    expect(runs).toBe(1);
  });

  it('records progress while a long job runs', async () => {
    const { repos, worker } = setup({
      'test.job': async ({ progress }) => {
        await progress(2);
        return {};
      },
    });
    const job = await enqueue(repos);
    await worker.runOnce();

    expect((await repos.jobs.findById(testOrganisation.id, job.id))?.progressDone).toBe(2);
  });
});

describe('failure', () => {
  it('re-queues with backoff while attempts remain', async () => {
    // Must be after the job is enqueued, or the worker correctly finds nothing to claim.
    const clock = new Date(Date.now() + 60_000);
    const { repos, worker } = setup(
      {
        'test.job': async () => {
          throw new Error('provider hiccup');
        },
      },
      () => clock,
    );
    const job = await enqueue(repos);

    await worker.runOnce();
    const afterFirst = await repos.jobs.findById(testOrganisation.id, job.id);
    expect(afterFirst?.status).toBe('queued');
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.error).toContain('provider hiccup');
    // Backoff: not runnable at the instant it failed.
    expect(afterFirst!.runAfter.getTime()).toBeGreaterThan(clock.getTime());
  });

  it('fails permanently once attempts run out', async () => {
    const { repos, worker } = setup({
      'test.job': async () => {
        throw new Error('still broken');
      },
    });
    const job = await enqueue(repos, { maxAttempts: 2 });

    // Each pass claims, fails and backs off; the backoff is cleared so the next pass can claim.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      repos.state.jobs = repos.state.jobs.map((j) =>
        j.id === job.id ? { ...j, runAfter: new Date(0) } : j,
      );
      await worker.runOnce();
    }

    const finished = await repos.jobs.findById(testOrganisation.id, job.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.attempts).toBe(2);
  });

  it('does not retry an unknown job kind — a deployment mistake is not a transient fault', async () => {
    const { repos, worker } = setup({});
    const job = await enqueue(repos);

    await worker.runOnce();
    const finished = await repos.jobs.findById(testOrganisation.id, job.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.error).toContain('No handler registered');
  });
});
