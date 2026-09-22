import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `docker stop` sends SIGTERM and Ctrl-C sends SIGINT; Node's default for both is to exit at
 * once. The entry point installed no handler, so a stop never ran `app.close()` — the worker's
 * timer, the sweeper and Chromium all died mid-whatever they were doing, and a job in flight was
 * left `running` for the recovery in `jobs/worker.ts` to find a quarter of an hour later.
 *
 * Checked in the source: the entry point listens on a port and cannot be imported by a test, and
 * on Windows a signal to a child is always a hard kill, so the restart spec cannot observe this
 * either. What it asserts is that both signals reach `app.close()` and exit afterwards.
 */
const SOURCE = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('stopping the server', () => {
  it('closes the app on SIGTERM and SIGINT, then exits', () => {
    expect(SOURCE).toContain("'SIGTERM'");
    expect(SOURCE).toContain("'SIGINT'");
    expect(SOURCE).toMatch(/process\.once\(signal,[\s\S]*?app\.close\(\)[\s\S]*?process\.exit\(/);
  });
});
