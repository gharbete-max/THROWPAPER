import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AiError } from '../engine.js';
import { childEnv, startServer, type ProcessHandle, type SpawnFn } from './llama-server.js';

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** Something listening where the child was told to listen, answering every request. */
function listenWhereTold(args: string[], seen: Array<string | undefined> = []) {
  const port = Number(args[args.indexOf('--port') + 1]);
  const http = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.end('ok');
  });
  servers.push(http);
  http.listen(port, '127.0.0.1');
}

const options = (spawn: SpawnFn, readyTimeoutMs = 5_000) => ({
  entry: 'x',
  files: { weights: 'w' },
  settings: { contextTokens: 1, threads: 1, imageMaxTokens: 1 },
  spawn,
  readyTimeoutMs,
  signal: new AbortController().signal,
});

describe('the environment of the llama-server child', () => {
  it('carries what a program needs and none of the shell’s secrets', () => {
    const env = childEnv({
      PATH: '/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      LANG: 'sv_SE.UTF-8',
      GITHUB_TOKEN: 'x',
      AWS_SECRET_ACCESS_KEY: 'x',
      DOCUMENT_SIGNING_SECRET: 'x',
      HTTPS_PROXY: 'http://proxy',
      LOPPA_AI_DIR: 'C:\\models',
      NODE_OPTIONS: '--require evil.js',
    });
    expect(Object.keys(env).sort()).toEqual(['LANG', 'PATH', 'SystemRoot', 'TEMP']);
  });
});

describe('stopping the child', () => {
  it('escalates to the uncatchable kill when the polite one is ignored', async () => {
    const kills: boolean[] = [];
    const exits: Array<(code: number | null) => void> = [];
    const spawn: SpawnFn = (_command, args): ProcessHandle => {
      listenWhereTold(args);
      return {
        pid: 1,
        onLog: () => undefined,
        onExit: (l) => exits.push(l),
        kill: (force) => {
          kills.push(Boolean(force));
          if (force) exits.forEach((l) => l(null)); // only SIGKILL works
        },
      };
    };
    const server = await startServer(options(spawn));
    await server.kill();
    expect(kills).toEqual([false, true]);
    expect(server.exited).toBe(true);
  }, 20_000);
});

describe('a port somebody else took', () => {
  it('is refused, and the key is never sent to whoever answers there', async () => {
    const seen: Array<string | undefined> = [];
    const spawn: SpawnFn = (_command, args): ProcessHandle => {
      listenWhereTold(args, seen); // not the child: the program that won the race for the port
      const logs: Array<(line: string) => void> = [];
      setTimeout(() => logs.forEach((l) => l("couldn't bind HTTP server socket")), 20);
      return { pid: 1, onLog: (l) => logs.push(l), onExit: () => undefined, kill: () => undefined };
    };
    const result = await startServer(options(spawn, 3_000)).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AiError);
    expect((result as AiError).problem).toBe('cannot-start');
    expect(seen.filter((auth) => auth !== undefined)).toEqual([]);
  }, 20_000);
});
