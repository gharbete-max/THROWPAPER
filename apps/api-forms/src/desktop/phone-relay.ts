import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { FastifyInstance } from 'fastify';

/**
 * The one door from the local network into the desktop app: a phone scanning pages for it.
 *
 * The desktop server listens on 127.0.0.1 only (ADR 0016). A phone cannot reach that, so while a
 * scan is open this relay listens on the LAN and passes through **only**:
 *
 * - the scan page itself, `GET /phone-scan/<token>`, and the app's static files it needs;
 * - the phone's two endpoints, `GET /api/v1/phone-scan/<token>` and
 *   `POST /api/v1/phone-scan/<token>/pages`.
 *
 * Every other path answers 404 without reaching the app — no sign-in, no forms, no documents, no
 * download links. The token is 256 random bits and dies with its session (fifteen minutes, or when
 * the computer closes it); the relay stops once no session is open. Plain HTTP: anyone on the same
 * network who can see the traffic could see the photographed pages in transit, which is the same
 * exposure as the phone's own upload to any local device, and is said in the screen's hint.
 */
const TOKEN = '[A-Za-z0-9_-]{43}';
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: 'GET', path: new RegExp(`^/phone-scan/${TOKEN}$`) },
  { method: 'GET', path: new RegExp(`^/api/v1/phone-scan/${TOKEN}$`) },
  { method: 'POST', path: new RegExp(`^/api/v1/phone-scan/${TOKEN}/pages$`) },
  // The built app: hashed bundles, the icons and the manifest. Public files, no data.
  { method: 'GET', path: /^\/assets\/[\w.-]+$/ },
  { method: 'GET', path: /^\/(favicon\.svg|manifest\.webmanifest|icon-\d+\.png)$/ },
  { method: 'GET', path: /^\/mark-[\w-]+\.(png|webp)$/ },
];
const MAX_BODY = 9 * 1024 * 1024;
/** How often the relay checks whether any scan is still open. */
const IDLE_CHECK_MS = 30_000;

export function isRelayed(method: string, url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return ALLOWED.some((rule) => rule.method === method && rule.path.test(path));
}

/** A private IPv4 address of this machine, the kind a phone on the same Wi-Fi can reach. */
export function lanAddress(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string | null {
  const candidates: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) {
        candidates.push(entry.address);
      }
    }
  }
  // Home and office Wi-Fi is almost always 192.168; 10.x and 172.x are as often VPNs and VMs.
  return candidates.find((a) => a.startsWith('192.168.')) ?? candidates[0] ?? null;
}

export interface PhoneRelay {
  /** Starts listening if it is not, and answers the origin a phone should open. */
  open(): Promise<string | null>;
  close(): Promise<void>;
}

export function createPhoneRelay(options: {
  app: () => FastifyInstance;
  /** Open scan sessions; at zero, the relay stops. */
  active: () => number;
  address?: () => string | null;
  port?: number;
}): PhoneRelay {
  let server: Server | null = null;
  let origin: string | null = null;
  let idle: NodeJS.Timeout | null = null;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? 'GET';
    const url = request.url ?? '/';
    if (!isRelayed(method, url)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end();
      request.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) {
        response.writeHead(413, { 'content-type': 'text/plain' }).end();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const answer = await options.app().inject({
      method: method as 'GET' | 'POST',
      // The app calls `/api/v1/...`; the routes are `/v1/...` (server.ts strips it the same way).
      url: url.startsWith('/api/') ? url.slice('/api'.length) : url,
      headers: {
        ...(request.headers['content-type']
          ? { 'content-type': request.headers['content-type'] }
          : {}),
        ...(request.headers['accept-language']
          ? { 'accept-language': request.headers['accept-language'] }
          : {}),
        ...(request.headers['accept-encoding']
          ? { 'accept-encoding': request.headers['accept-encoding'] }
          : {}),
      },
      ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}),
      remoteAddress: request.socket.remoteAddress ?? '0.0.0.0',
    });
    const headers = { ...answer.headers };
    // Written for a TLS origin; on plain HTTP they would send the phone to an https:// that is
    // not there.
    delete headers['strict-transport-security'];
    const csp = headers['content-security-policy'];
    if (typeof csp === 'string') {
      headers['content-security-policy'] = csp
        .split(';')
        .filter((part) => part.trim() !== 'upgrade-insecure-requests')
        .join(';');
    }
    delete headers['transfer-encoding'];
    delete headers['connection'];
    response.writeHead(answer.statusCode, headers as Record<string, string>);
    response.end(answer.rawPayload);
  }

  async function close() {
    if (idle) clearInterval(idle);
    idle = null;
    const closing = server;
    server = null;
    origin = null;
    if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
  }

  return {
    async open() {
      if (origin) return origin;
      const address = (options.address ?? lanAddress)();
      if (!address) return null;
      const listening = createServer((request, response) => {
        handle(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500).end();
        });
      });
      await new Promise<void>((resolve, reject) => {
        listening.once('error', reject);
        // The LAN address only, not every interface: a VPN or a public adapter gets nothing.
        listening.listen(options.port ?? 0, address, () => resolve());
      });
      const port = (listening.address() as { port: number }).port;
      server = listening;
      origin = `http://${address}:${port}`;
      idle = setInterval(() => {
        if (options.active() === 0) void close();
      }, IDLE_CHECK_MS);
      idle.unref();
      return origin;
    },
    close,
  };
}
