import { buildServer } from './server.js';
import { env } from './env.js';

if (!env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET must be set to at least 32 characters before the server can start. See .env.example.',
  );
}
if (!env.DOCUMENT_SIGNING_SECRET) {
  throw new Error(
    'DOCUMENT_SIGNING_SECRET must be set to at least 32 characters before the server can start. See .env.example.',
  );
}

const app = await buildServer({
  jwtSecret: env.JWT_SECRET,
  documentSigningSecret: env.DOCUMENT_SIGNING_SECRET,
  appUrl: env.APP_URL,
});
await app.listen({ port: env.API_FORMS_PORT, host: env.API_FORMS_HOST });

/**
 * A stop is a stop, not a crash. `docker stop` sends SIGTERM and Ctrl-C sends SIGINT; without
 * this, Node exits at once and the worker's timer, the upload sweeper and Chromium die
 * mid-whatever they were doing. `app.close()` runs the `onClose` hooks that stop them.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'stopping');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
