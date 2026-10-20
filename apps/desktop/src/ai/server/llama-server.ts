import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { AiError } from '../engine.js';

/**
 * The supervised `llama-server` child process (ADR 0025, docs/plan/AI-SYSTEM.md D1).
 *
 * - Listens on `127.0.0.1`, an ephemeral port, behind a bearer key made for this one run. No web
 *   UI, `--offline` (it may not fetch anything), the prompt cache in RAM off.
 * - CPU only. Threads are physical cores minus one, between 2 and 8.
 * - `kill()` ends the process and resolves when it has gone. That is how memory comes back: a
 *   process exit gives RAM back deterministically, which unloading inside a long-lived process
 *   does not promise.
 * - A start that fails says why in terms the coordinator knows: no AVX2 or a crash is
 *   `cannot-start`, running out of memory is `too-little-memory`.
 *
 * The process is started through {@link SpawnFn} so the tests can run a stand-in that speaks the
 * same HTTP.
 */
export interface ProcessHandle {
  /** For diagnostics only (the real-model suite measures the process's memory). */
  readonly pid?: number | undefined;
  onLog(listener: (line: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** Ends the process; `force` is the uncatchable kind (SIGKILL), for one that ignored the first. */
  kill(force?: boolean): void;
}
export type SpawnFn = (command: string, args: string[], cwd: string) => ProcessHandle;

export interface Connection {
  baseUrl: string;
  apiKey: string;
}

export interface ServerSettings {
  contextTokens: number;
  threads: number;
  /** Largest number of tokens a picture may take; bounds a page's time and memory. */
  imageMaxTokens: number;
  /** Layers kept on the graphics card; 0, the CPU only. Unset on the Vulkan build: the program fits as many as the free memory holds. */
  gpuLayers?: number;
  /** The graphics card to use, as the program names it (`Vulkan0`): set only for the Vulkan build. */
  device?: string;
}

export const DEFAULT_SETTINGS = { contextTokens: 8192, imageMaxTokens: 2560 } as const;

/**
 * Threads: physical cores minus one, between 2 and 8. Node reports logical processors; on a
 * machine with two threads to a core that is twice the physical count (spike S1 measured eight
 * threads only on eight performance cores, and a laptop with efficiency cores is not that).
 */
export function chooseThreads(
  logical: number = availableParallelism(),
  platform: string = process.platform,
): number {
  const physical = platform === 'darwin' ? logical : Math.round(logical / 2);
  return Math.min(8, Math.max(2, physical - 1));
}

export function serverArgs(
  files: { weights: string; projector?: string },
  settings: ServerSettings,
  port: number,
  apiKey: string,
): string[] {
  return [
    '-m',
    files.weights,
    ...(files.projector
      ? ['--mmproj', files.projector, '--image-max-tokens', `${settings.imageMaxTokens}`]
      : []),
    '--host',
    '127.0.0.1',
    '--port',
    `${port}`,
    '--api-key',
    apiKey,
    '--no-webui',
    '--offline',
    '-c',
    `${settings.contextTokens}`,
    '-t',
    `${settings.threads}`,
    '-ngl',
    `${settings.gpuLayers ?? (settings.device ? 'auto' : 0)}`,
    // One card, chosen by Loppa (never a split with the integrated chip), and the log that names it.
    ...(settings.device ? ['--device', settings.device, '-lv', '4'] : []),
    '-np',
    '1',
    '-fa',
    'on',
    '--cache-ram',
    '0',
    '--no-warmup',
  ];
}

/** `llama-server` prints its CPU features at start: `CPU : SSE3 = 1 | AVX2 = 1 | ...`. */
export function lacksAvx2(line: string, arch: string = process.arch): boolean {
  return (
    arch === 'x64' &&
    /\bCPU\s*:/.test(line) &&
    /\bAVX\b/.test(line) &&
    !/\bAVX2\s*=\s*1\b/.test(line)
  );
}

/**
 * The environment the child gets: what a program needs to find its libraries and temporary folder
 * and nothing else. The shell's own environment may hold tokens, proxies or `LOPPA_*` switches that
 * a model server has no use for.
 */
const CHILD_ENV =
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LANG|LC_[A-Z]+|LD_LIBRARY_PATH|DYLD_LIBRARY_PATH)$/i;

export function childEnv(env: NodeJS.ProcessEnv, pass: readonly string[] = []): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => CHILD_ENV.test(key) || pass.includes(key)),
  );
}

/** The program could not take its port: somebody else got it between our probe and its bind. */
const BIND_FAILURE =
  /address already in use|couldn't bind|could not bind|failed to bind|EADDRINUSE/i;

const MEMORY_FAILURE =
  /out of memory|failed to allocate|bad_alloc|cudaMalloc|insufficient memory|OutOfDeviceMemory|Device memory allocation/i;

/** The Vulkan build says how much of the model went to the card: `offloaded 29/29 layers to GPU`. */
const OFFLOADED = /offloaded (\d+)\/(\d+) layers to GPU/;

/** `pass`: extra variable names a test stand-in needs; production passes none. */
export function defaultSpawn(
  env: NodeJS.ProcessEnv = process.env,
  pass: readonly string[] = [],
): SpawnFn {
  return (command, args, cwd) => {
    const child = nodeSpawn(command, args, {
      cwd, // the DLLs sit beside the program
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(env, pass),
    });
    // A shell that ends without closing the model (app.exit, an uncaught error) must not leave a
    // process holding the model's memory. A hard kill of the shell itself cannot be caught.
    const reap = () => void child.kill('SIGKILL');
    process.once('exit', reap);
    child.once('exit', () => process.removeListener('exit', reap));
    const listeners = {
      log: [] as Array<(line: string) => void>,
      exit: [] as Array<(c: number | null) => void>,
    };
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop() ?? '';
        for (const line of lines) listeners.log.forEach((l) => l(line));
      });
    }
    child.on('exit', (code) => listeners.exit.forEach((l) => l(code)));
    child.on('error', (error) => {
      listeners.log.forEach((l) => l(`could not start: ${error.message}`));
      listeners.exit.forEach((l) => l(null));
    });
    return {
      pid: child.pid,
      onLog: (l) => listeners.log.push(l),
      onExit: (l) => listeners.exit.push(l),
      kill: (force) => void child.kill(force ? 'SIGKILL' : undefined),
    };
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export interface RunningServer {
  connection: Connection;
  readonly pid: number | undefined;
  /** Layers on the graphics card, as the program reported; null before it did or on the CPU build. */
  readonly offloaded: { layers: number; total: number } | null;
  /** True once the process has ended, however it ended. */
  readonly exited: boolean;
  /** True if the process is, or within `ms` becomes, gone: a broken connection often comes first. */
  exitedWithin(ms: number): Promise<boolean>;
  /** Ends the process and resolves when it is gone. Safe to call twice. */
  kill(): Promise<void>;
}

export interface StartOptions {
  entry: string;
  files: { weights: string; projector?: string };
  settings: ServerSettings;
  spawn?: SpawnFn;
  /** How long the model may take to load. */
  readyTimeoutMs?: number;
  arch?: string;
  signal: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const port = await freePort();
  const apiKey = randomBytes(24).toString('hex');
  const args = serverArgs(options.files, options.settings, port, apiKey);
  const handle = (options.spawn ?? defaultSpawn())(options.entry, args, dirname(options.entry));
  const connection: Connection = { baseUrl: `http://127.0.0.1:${port}`, apiKey };

  let exited = false;
  let exitCode: number | null = null;
  let noAvx2 = false;
  let memory = false;
  let portTaken = false;
  let offloaded: { layers: number; total: number } | null = null;
  const tail: string[] = [];
  const gone = new Promise<void>((resolve) => {
    handle.onExit((code) => {
      exited = true;
      exitCode = code;
      resolve();
    });
  });
  handle.onLog((line) => {
    tail.push(line);
    if (tail.length > 40) tail.shift();
    if (lacksAvx2(line, options.arch)) {
      noAvx2 = true;
      handle.kill();
    }
    if (MEMORY_FAILURE.test(line)) memory = true;
    const layers = OFFLOADED.exec(line);
    if (layers) offloaded = { layers: Number(layers[1]), total: Number(layers[2]) };
    if (BIND_FAILURE.test(line)) portTaken = true;
  });

  const server: RunningServer = {
    connection,
    pid: handle.pid,
    get offloaded() {
      return offloaded;
    },
    get exited() {
      return exited;
    },
    exitedWithin: (ms) => Promise.race([gone.then(() => true), sleep(ms).then(() => exited)]),
    async kill() {
      if (exited) return;
      handle.kill();
      await Promise.race([gone, sleep(5_000)]);
      // Asked politely and ignored: no process may outlive its session holding gigabytes.
      if (!exited) {
        handle.kill(true);
        await Promise.race([gone, sleep(5_000)]);
      }
    },
  };

  const fail = async (problem: ConstructorParameters<typeof AiError>[0], why: string) => {
    await server.kill();
    throw new AiError(problem, `${why}\n${tail.slice(-8).join('\n')}`);
  };

  const deadline = Date.now() + (options.readyTimeoutMs ?? 300_000);
  for (;;) {
    if (options.signal.aborted) return fail('cancelled', 'cancelled while the model loaded');
    if (noAvx2) {
      return fail(
        'cannot-start',
        'this computer cannot run the on-device model: its processor has no AVX2',
      );
    }
    if (portTaken) {
      // Whatever answers on that port is not our child; nothing is sent to it, least of all the key.
      return fail('cannot-start', 'the port chosen for llama-server was taken by another program');
    }
    if (exited) {
      return memory
        ? fail('too-little-memory', 'llama-server ran out of memory while loading')
        : fail('cannot-start', `llama-server ended with code ${exitCode} before it was ready`);
    }
    if (Date.now() > deadline)
      return fail('cannot-start', 'llama-server did not become ready in time');
    try {
      const response = await fetch(`${connection.baseUrl}/health`, {
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(2000)]),
      });
      if (response.ok) {
        // A health check alone proves only that something answers on the port. A real child
        // answers after its model has loaded, long after a failed bind was logged; an answer that
        // comes at once, from a child that then reports the bind or ends, is somebody else's.
        await sleep(300);
        if (!exited && !portTaken) return server;
        continue;
      }
    } catch {
      // not listening yet, or still loading
    }
    await sleep(250);
  }
}
