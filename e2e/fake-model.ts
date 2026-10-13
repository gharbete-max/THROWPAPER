/**
 * The desktop shell's `window.loppaModel`, faked: same interface, no model. Installed with
 * `page.addInitScript(fakeBridge)`, so it has to stand alone (no imports, no closures).
 */
export function fakeBridge() {
  const listeners: Array<(event: unknown) => void> = [];
  const emit = (event: unknown) => listeners.forEach((listener) => listener(event));
  const bytes = 2497281120;
  const w = window as unknown as Record<string, unknown>;
  const state = {
    installed: false,
    jobs: 0,
    cancelled: new Set<string>(),
    requests: [] as unknown[],
  };
  w.__fake = state;
  const status = () => ({
    id: 'fake',
    licence: 'Apache-2.0',
    bytes,
    installed: state.installed,
    location: state.installed ? 'C:\\Models\\fake.gguf' : null,
    verified: state.installed,
    damaged: false,
    downloadBlocked: 'the release has not been cut yet',
    freeMemoryBytes: 16e9,
    requiredMemoryBytes: 5e9,
    activity: 'idle',
  });
  w.loppaModel = {
    status: () => Promise.resolve(status()),
    install: () => Promise.resolve({ ok: false, problem: 'download-unavailable' }),
    openFromDisk: () => {
      setTimeout(() => {
        emit({ id: 'install', kind: 'install', phase: 'verify', done: bytes / 2, total: bytes });
        state.installed = true;
        setTimeout(() => emit({ id: 'install', kind: 'installed', status: status() }), 50);
      }, 20);
      return Promise.resolve({ ok: true, id: 'install' });
    },
    remove: () => {
      state.installed = false;
      return Promise.resolve(status());
    },
    start: (
      id: string,
      job: { kind: string; text?: string; passages?: string[]; into?: string },
    ) => {
      state.requests.push(job);
      state.jobs += 1;
      const run = async () => {
        await new Promise((r) => setTimeout(r, 30));
        emit({ id, kind: 'step', step: 'loading', done: 1, total: 1 });
        if (job.kind === 'select') {
          emit({ id, kind: 'selected', numbers: [2] });
          emit({ id, kind: 'done', warnings: [], seconds: 1 });
          return;
        }
        const pieces =
          job.kind === 'translate'
            ? [`[${job.into}] `, job.text ?? '']
            : ['- First point. ', '- Second point 2027. '];
        let shown = '';
        for (const piece of pieces) {
          if (state.cancelled.has(id)) {
            emit({ id, kind: 'error', problem: 'cancelled' });
            return;
          }
          shown += piece;
          emit({ id, kind: 'text', mode: 'replace', text: shown });
          await new Promise((r) => setTimeout(r, job.text === 'slow' ? 400 : 20));
        }
        emit({
          id,
          kind: 'done',
          warnings: job.kind === 'summarise' ? [{ kind: 'numbers-added', numbers: ['2027'] }] : [],
          seconds: 2,
        });
      };
      void run();
      return Promise.resolve({ ok: true, id });
    },
    cancel: (id: string) => {
      state.cancelled.add(id);
      return Promise.resolve();
    },
    onEvent: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
}
