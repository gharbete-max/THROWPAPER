import { buildServer } from './server.js';
import { env } from './env.js';

const app = await buildServer({ jwtSecret: env.JWT_SECRET, appUrl: env.APP_URL });
await app.listen({ port: env.API_FORMS_PORT, host: '0.0.0.0' });
