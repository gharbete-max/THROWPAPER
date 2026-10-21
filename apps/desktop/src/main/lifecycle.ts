/**
 * Two small rules for the shell's life-cycle, kept out of `main.ts` so they are tested without Electron.
 *
 * `createLock`: the operations that stop and start the servers (a backup, a restore of keys, a save
 * of settings, first-run set-up, a restart) run one at a time. A backup copies the database folder
 * only while the servers are stopped; a second operation that restarted them in the middle of the
 * copy made a backup that restores to a corrupt database. A dialog left open is not a reason to
 * wait, so a caller takes the lock only around the part that touches the servers.
 *
 * `closeAll`: quitting waits for the databases to close, but not for ever. A close that never ends
 * would leave an invisible process holding the single-instance lock, and the person could not start
 * Loppa again without the task manager.
 */
export type Exclusive = <T>(job: () => Promise<T>) => Promise<T>;

export function createLock(): Exclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

export async function closeAll(
  closers: ReadonlyArray<() => Promise<unknown> | undefined>,
  timeoutMs: number,
): Promise<'closed' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  // A closer that throws at once is a failed close like any other.
  const started = closers.map((close) => Promise.resolve().then(close));
  const closed = Promise.allSettled(started).then(() => 'closed' as const);
  try {
    return await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
