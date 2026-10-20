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
  // `window.loppaAi` (ADR 0025): the one model the shell registers, with its projector, and the
  // program that runs it. Installing is the same state as above.
  const model = () => ({
    id: 'qwen2.5-vl-7b-instruct-q4_k_m',
    name: 'Qwen2.5-VL-7B-Instruct (Q4_K_M)',
    capabilities: ['text', 'vision'],
    state: state.installed ? 'installed' : 'missing',
    available: true,
    licence: 'Apache-2.0',
    licenceUrl: 'https://example.test/licence',
    distributable: true,
    evaluationOnly: false,
    label: null,
    bytes,
    requiredMemoryBytes: 10e9,
    files: [
      {
        role: 'weights',
        name: 'qwen-vl.gguf',
        bytes,
        path: state.installed ? 'C:\\Models\\fake.gguf' : null,
        source: state.installed ? 'remembered' : null,
        hash: state.installed ? 'verified' : 'missing',
      },
      {
        role: 'projector',
        name: 'mmproj.gguf',
        bytes: 1354162912,
        path: state.installed ? 'C:\\Models\\mmproj.gguf' : null,
        source: state.installed ? 'remembered' : null,
        hash: state.installed ? 'verified' : 'missing',
      },
    ],
    downloadBlocked: 'the release has not been cut yet',
    folder: 'C:\\Users\\me\\AppData\\Roaming\\Loppa\\models',
    resident: false,
    tier: 'full',
    support: { state: 'working', evidence: 'fake' },
    requiredMemoryVerified: true,
    consent: null,
    selected: true,
    recommended: true,
  });
  const aiStatus = () => ({
    models: [model()],
    freeMemoryBytes: 16e9,
    totalMemoryBytes: 32e9,
    freeDiskBytes: 500e9,
    activity: 'idle',
    queued: 0,
    runtime: {
      role: 'runtime',
      name: 'llama.cpp llama-server b11741',
      bytes: 19708452,
      path: 'C:\\Loppa\\ai-pack',
      source: 'ai-pack',
      hash: 'verified',
    },
    cache: { entries: 0, bytes: 0, maxBytes: 64e6 },
  });
  // The email reply helper's four kinds, answered like the real pipeline would: a draft with a
  // marked gap, and for a `received` containing INVENT a draft that carries a date nobody gave it.
  // Every task is kept in `__fake.replies`, so a test can look at exactly what the window sent.
  const aiListeners: Array<(event: unknown) => void> = [];
  const aiEmit = (event: unknown) => aiListeners.forEach((listener) => listener(event));
  const replies: Array<Record<string, string>> = [];
  (state as unknown as Record<string, unknown>).replies = replies;
  const REPLY_KINDS = ['draft-reply', 'shorten-reply', 'translate-reply', 'revise-reply'];
  const replyText = (task: Record<string, string>): string => {
    if (task.kind === 'shorten-reply')
      return (task.draft ?? '').split(/\n+/).slice(0, 2).join('\n');
    if (task.kind === 'translate-reply') return `[${task.into}] ${task.draft}`;
    if (task.kind === 'revise-reply') return `${task.draft}\n\n(${task.instruction})`;
    const when = (task.received ?? '').includes('INVENT') ? 'on 2027-01-05' : 'on [date?]';
    return `Hello,\n\nThank you for your message. I can meet ${when}.\n\nKind regards`;
  };
  w.loppaAi = {
    status: () => Promise.resolve(aiStatus()),
    install: () => Promise.resolve({ ok: false, problem: 'download-unavailable' }),
    select: () => Promise.resolve(aiStatus()),
    openFromDisk: () => Promise.resolve({ ok: false, problem: 'cancelled' }),
    remove: () => Promise.resolve(aiStatus()),
    run: (id: string, task: Record<string, string>) => {
      if (!REPLY_KINDS.includes(task.kind ?? '')) {
        return Promise.resolve({ ok: false, problem: 'not-available' });
      }
      if (!state.installed) return Promise.resolve({ ok: false, problem: 'not-installed' });
      replies.push(task);
      const go = async () => {
        await new Promise((r) => setTimeout(r, 30));
        aiEmit({ id, kind: 'step', step: 'writing', done: 0, total: 1 });
        const pieces = replyText(task).match(/\S+\s*/g) ?? [];
        let shown = '';
        for (const piece of pieces) {
          if (state.cancelled.has(id)) {
            aiEmit({ id, kind: 'error', problem: 'cancelled' });
            return;
          }
          shown += piece;
          aiEmit({ id, kind: 'text', mode: 'replace', text: shown });
          await new Promise((r) => setTimeout(r, task.received === 'slow' ? 300 : 10));
        }
        aiEmit({ id, kind: 'done', warnings: [], seconds: 1 });
      };
      void go();
      return Promise.resolve({ ok: true, id });
    },
    cancel: (id: string) => {
      state.cancelled.add(id);
      return Promise.resolve();
    },
    clearCache: () => Promise.resolve(aiStatus()),
    onEvent: (listener: (event: unknown) => void) => {
      aiListeners.push(listener);
      return () => aiListeners.splice(aiListeners.indexOf(listener), 1);
    },
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
