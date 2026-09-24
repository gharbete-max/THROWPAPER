import { buildServer } from './server.js';
import { env, sealPems, signLinkSecret } from './env.js';
import { connect } from './db/client.js';
import { loadSealer } from './sealing/certificate.js';

const { db } = connect(env.SIGN_DATABASE_URL);
const app = await buildServer({
  db,
  linkSecret: signLinkSecret(),
  publicUrl: env.SIGN_PUBLIC_URL,
  apiUrl: env.API_SIGN_PUBLIC_URL,
  sealer: await loadSealer(sealPems()),
});
await app.listen({ port: env.API_SIGN_PORT, host: '0.0.0.0' });
