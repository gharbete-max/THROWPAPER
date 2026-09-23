import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from './index.js';
import { testOrganisation } from '../../test-support.js';

/**
 * The in-memory repositories keep the time a test gives them.
 *
 * `claim(now)` has always taken the clock as an argument, and `enqueue` stamped `runAfter` from
 * the wall clock. So a test could hand the worker a fake clock and silently leave the repository
 * on the real one — which is exactly what two lease tests in `jobs/worker.test.ts` did, and why
 * they passed only before 10:00 UTC on the day they were written (`docs/PROGRESS.md` § Phase 1).
 *
 * The tests were fixed by following the row's own instant. This fixes the thing that allowed it:
 * the double takes one clock, and every timestamp it writes comes from that clock.
 */
describe('the in-memory repositories', () => {
  /*
   * In the past, deliberately. The original failure was a clock *earlier* than the wall clock:
   * `runAfter` came out in the claim's future and nothing was claimable. A future instant here
   * would let the claim succeed against the wall clock by accident — the claim test passed without
   * the fix until this date moved backwards, which is the whole bug in miniature.
   */
  const at = new Date('2020-01-01T09:00:00Z');

  it('stamp a queued job from the clock they were given', async () => {
    const repos = createMemoryRepositories({ organisations: [testOrganisation] }, () => at);
    const job = await repos.jobs.enqueue({
      organisationId: testOrganisation.id,
      kind: 'test.job',
      idempotencyKey: 'clock',
      payload: {},
      progressTotal: 1,
    });

    expect(job.runAfter).toEqual(at);
    expect(job.createdAt).toEqual(at);
  });

  it('let a job queued at that instant be claimed at that instant', async () => {
    // The shape of the original failure: one clock, and the claim finds the job.
    const repos = createMemoryRepositories({ organisations: [testOrganisation] }, () => at);
    const job = await repos.jobs.enqueue({
      organisationId: testOrganisation.id,
      kind: 'test.job',
      idempotencyKey: 'claimable',
      payload: {},
      progressTotal: 1,
    });

    expect((await repos.jobs.claim(at))?.id).toBe(job.id);
  });

  it('still use the wall clock when nobody passes one', async () => {
    const before = Date.now();
    const repos = createMemoryRepositories({ organisations: [testOrganisation] });
    const job = await repos.jobs.enqueue({
      organisationId: testOrganisation.id,
      kind: 'test.job',
      idempotencyKey: 'wall',
      payload: {},
      progressTotal: 1,
    });

    expect(job.runAfter.getTime()).toBeGreaterThanOrEqual(before);
  });
});
