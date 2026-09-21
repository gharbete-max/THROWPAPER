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
