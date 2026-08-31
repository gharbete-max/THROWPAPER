import { buildServer } from './server.js';
import { env } from './env.js';

if (!env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET must be set to at least 32 characters before the server can start. See .env.example.',
  );
}

const app = await buildServer({ jwtSecret: env.JWT_SECRET, appUrl: env.APP_URL });
await app.listen({ port: env.API_FORMS_PORT, host: '0.0.0.0' });
