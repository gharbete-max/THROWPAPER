import type { FastifyInstance } from 'fastify';

/**
 * Sign on this computer answers only to its own loopback name — a defence against DNS rebinding.
 *
 * The same reasoning as Forms' desktop server (`apps/api-forms/src/desktop/loopback-host.ts`; the
 * products never import each other, so the few lines live in each). A web page that points its own
 * hostname at 127.0.0.1 is same-origin to the browser, and CORS never stops it; the `Host` header
 * still names the page's site, and that is refused here before any route runs.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  return (
    value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`
  );
}

export function guardLoopbackHost(app: FastifyInstance, port: number): void {
  app.addHook('onRequest', async (request, reply) => {
    if (isLoopbackHost(request.headers.host, port)) return;
    return reply
      .code(421)
      .header('content-type', 'text/plain; charset=utf-8')
      .send('Misdirected request');
  });
}
