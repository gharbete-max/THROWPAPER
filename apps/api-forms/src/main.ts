import { buildServer } from './server.js';
import { env } from './env.js';

const app = await buildServer();
await app.listen({ port: env.API_FORMS_PORT, host: '0.0.0.0' });
