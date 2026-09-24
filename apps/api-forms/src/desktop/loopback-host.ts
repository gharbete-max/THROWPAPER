import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';

/**
 * The desktop's servers answer only to their own loopback name — a defence against DNS rebinding.
 *
 * Binding to 127.0.0.1 keeps other machines out; it does not keep out a web page in the person's
 * own browser. A site can point its hostname at 127.0.0.1 after the page has loaded and then call
 * `http://evil.example:47017/...` — same origin as far as the browser is concerned, so CORS never
 * applies — and reach this server. Nothing behind a sign-in is exposed that way (the bearer token
 * is not the page's to send), but the public routes are: submit a published form ten times a
 * minute and every submission queues a confirmation email, through the person's own Outlook.
 *
 * What the rebinding page cannot change is the `Host` header: it is the attacker's hostname. So
 * anything not addressed to `127.0.0.1:<port>` or `localhost:<port>` is refused before a route
 * runs. The LAN relay for phone scanning forwards with an explicit loopback host (see
 * `phone-relay.ts`), and its own allow-list is what decides what a phone may reach.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  return (
    value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`
  );
}

/** Adds the check to a server that is about to listen. Call before `listen`, after routes. */
export function guardLoopbackHost(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const address = app.server.address() as AddressInfo | null;
    const port = address?.port;
    if (port !== undefined && isLoopbackHost(request.headers.host, port)) return;
    // 421 Misdirected Request: this server is not the one that name refers to.
    return reply
      .code(421)
      .header('content-type', 'text/plain; charset=utf-8')
      .send('Misdirected request');
  });
}
