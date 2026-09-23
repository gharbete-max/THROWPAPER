import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db/repositories/index.js';
import { testOrganisation } from '../test-support.js';
import { createWorker, type JobHandler } from './worker.js';

/**
 * One clock for the worker and the repository both. They used to take different ones — the worker
 * the test's, the repository the wall — which is how two tests below passed only before 10:00 UTC
 * on the day they were written.
 */
function setup(handlers: Record<string, JobHandler>, now = () => new Date()) {
  const repos = createMemoryRepositories({ organisations: [testOrganisation] }, now);
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

  /**
   * The worker runs on a timer. An unhandled rejection there kills the API process, which is
   * exactly what a Date bound into a raw SQL fragment did in CI: the server died a second after
   * boot, every time, against a real database.
   */
  it('survives the claim itself failing, rather than taking the process down', async () => {
    const repos = createMemoryRepositories({ organisations: [testOrganisation] });
    const failures: unknown[] = [];
    repos.jobs.claim = async () => {
      throw new Error('database went away mid-claim');
    };

    const worker = createWorker({
      repos,
      handlers: {},
      onError: (error) => failures.push(error),
    });

    // Neither the direct call nor the timer path may reject.
    await expect(worker.runOnce()).rejects.toThrow('database went away');

    worker.start(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    worker.stop();

    expect(failures.length).toBeGreaterThan(0);
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

/**
 * A worker that dies mid-job leaves the row `running`, and `claim()` never looks at `running`.
 * Without recovery the export somebody asked for never arrives, and nothing says why.
 */
describe('a job the last worker never finished', () => {
  const HOUR = 60 * 60 * 1000;

  it('is taken back once it is older than the lease, and runs again', async () => {
    let runs = 0;
    // The very literal that used to expire at 10:00 UTC that day. Safe for good now the clock is
    // shared — which is the proof that the cause is gone, not merely stepped around.
    const clock = { at: new Date('2026-09-22T10:00:00Z') };
    const { repos, worker } = setup(
      {
        'test.job': async () => {
          runs += 1;
          return { ok: true };
        },
      },
      () => clock.at,
    );
    const job = await enqueue(repos);
    // Claimed by a worker that then died.
    expect((await repos.jobs.claim(clock.at))?.id).toBe(job.id);

    // Not yet: a job that started a minute ago may simply be long.
    clock.at = new Date(clock.at.getTime() + 60 * 1000);
    await worker.runOnce();
    expect(runs).toBe(0);
    expect((await repos.jobs.findById(testOrganisation.id, job.id))?.status).toBe('running');

    clock.at = new Date(clock.at.getTime() + HOUR);
    await worker.runOnce();
    expect(runs).toBe(1);
    const finished = await repos.jobs.findById(testOrganisation.id, job.id);
    expect(finished?.status).toBe('done');
    expect(finished?.attempts).toBe(2);
  });

  it('fails for good when its attempts are spent', async () => {
    const clock = { at: new Date('2026-09-22T10:00:00Z') };
    const { repos, worker } = setup({ 'test.job': async () => ({}) }, () => clock.at);
    const job = await enqueue(repos, { maxAttempts: 1 });
    await repos.jobs.claim(clock.at);

    clock.at = new Date(clock.at.getTime() + HOUR);
    expect(await worker.runOnce()).toBe(false);
    const dead = await repos.jobs.findById(testOrganisation.id, job.id);
    expect(dead?.status).toBe('failed');
    expect(dead?.error).toContain('worker');
  });
});
