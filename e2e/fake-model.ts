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
  // `window.loppaAi` (ADR 0024): the same two models the shell registers, one text and one
  // evaluation-only vision model that nothing can run yet. Installing is the same state as above.
  const model = (id: string, name: string, vision: boolean) => ({
    id,
    name,
    capabilities: [vision ? 'vision' : 'text'],
    state: vision ? 'evaluation-only' : state.installed ? 'installed' : 'missing',
    available: !vision,
    licence: vision ? 'Qwen-Research' : 'Apache-2.0',
    licenceUrl: 'https://example.test/licence',
    distributable: !vision,
    evaluationOnly: vision,
    label: vision ? 'unverified-licence' : null,
    bytes: vision ? 2774658784 : bytes,
    requiredMemoryBytes: 5e9,
    files: vision
      ? [
          {
            role: 'weights',
            name: 'Qwen2.5-VL.gguf',
            bytes: 1929901056,
            path: 'C:\\repo\\Qwen2.5-VL.gguf',
            source: 'repo-root',
            hash: 'unchecked',
          },
          {
            role: 'projector',
            name: 'mmproj.gguf',
            bytes: 844757728,
            path: null,
            source: null,
            hash: 'missing',
          },
        ]
      : [
          {
            role: 'weights',
            name: 'qwen3.gguf',
            bytes,
            path: state.installed ? 'C:\\Models\\fake.gguf' : null,
            source: state.installed ? 'remembered' : null,
            hash: state.installed ? 'verified' : 'missing',
          },
        ],
    downloadBlocked: vision ? 'evaluation-only' : 'the release has not been cut yet',
    folder: 'C:\\Users\\me\\AppData\\Roaming\\Loppa\\models',
    resident: false,
  });
  const aiStatus = () => ({
    models: [model('qwen3', 'Qwen3-4B', false), model('qwen-vl', 'Qwen2.5-VL-3B', true)],
    freeMemoryBytes: 16e9,
    activity: 'idle',
    queued: 0,
    cache: { entries: 0, bytes: 0, maxBytes: 64e6 },
  });
  w.loppaAi = {
    status: () => Promise.resolve(aiStatus()),
    install: () => Promise.resolve({ ok: false, problem: 'download-unavailable' }),
    openFromDisk: () => Promise.resolve({ ok: false, problem: 'cancelled' }),
    remove: () => Promise.resolve(aiStatus()),
    run: () => Promise.resolve({ ok: false, problem: 'not-available' }),
    cancel: () => Promise.resolve(),
    clearCache: () => Promise.resolve(aiStatus()),
    onEvent: () => () => undefined,
  };
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
