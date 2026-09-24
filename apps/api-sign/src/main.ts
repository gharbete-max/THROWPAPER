import { buildServer } from './server.js';
import { identityProvidersFromEnv } from './identity/providers.js';
import { env, sealPems, signLinkSecret } from './env.js';
import { connect } from './db/client.js';
import { generateDevCertificate, loadSealer } from './sealing/certificate.js';

const { db } = connect(env.SIGN_DATABASE_URL);
const pems = sealPems();
const sealer = await loadSealer(pems === 'ephemeral' ? await generateDevCertificate() : pems);
const app = await buildServer({
  db,
  linkSecret: signLinkSecret(),
  publicUrl: env.SIGN_PUBLIC_URL,
  apiUrl: env.API_SIGN_PUBLIC_URL,
  sealer,
  ...(env.SIGN_SERVE_APP ? { serveAppFrom: env.SIGN_SERVE_APP } : {}),
  // None unless EID_PROVIDER names one; the development provider refuses production.
  identity: identityProvidersFromEnv(process.env, (message) => console.warn(message)),
});
await app.listen({ port: env.API_SIGN_PORT, host: '0.0.0.0' });
