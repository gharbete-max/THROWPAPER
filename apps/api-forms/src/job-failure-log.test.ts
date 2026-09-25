import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, testOrganisation, type TestHarness } from './test-support.js';
import { MAIL_SEND_JOB } from './mail/send-job.js';

/**
 * A job that fails says why in the log.
 *
 * pino serializes an Error only under `err`; under any other key it is written as `{}`. The worker's
 * failures were logged as `{ error }`, so every failed job — a refused SMTP login, a missing
 * submission — read `"error":{},"msg":"job failed"` and nothing else. Found in the e2e server's log.
 */
let harness: TestHarness;

afterEach(async () => {
  await harness?.close();
});

describe('a failed job in the log', () => {
  it('carries the error itself, under the key the logger serializes', async () => {
    harness = await createTestHarness();
    const logged = vi.spyOn(harness.app.log, 'error');
    await harness.repos.jobs.enqueue({
      organisationId: testOrganisation.id,
      kind: MAIL_SEND_JOB,
      idempotencyKey: 'job-failure-log',
      payload: { templateKey: 'registration.confirmation', submissionId: 'nobody' },
      progressTotal: 1,
    });

    await harness.app.worker.drain();

    const [detail, message] = logged.mock.calls.at(-1) as [Record<string, unknown>, string];
    expect(message).toBe('job failed');
    expect(detail['err']).toBeInstanceOf(Error);
    expect((detail['err'] as Error).message).toContain('nobody');
    expect(detail).not.toHaveProperty('error');
  });
});
