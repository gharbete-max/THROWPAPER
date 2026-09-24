import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateDevCertificate } from './certificate.js';

/**
 * `pnpm --filter @tp/api-sign seal:dev-cert` — a self-issued seal pair for local development,
 * appended to the repository's `.env` (which git ignores). Refuses to overwrite a pair that is
 * already there: replacing it silently would make every earlier local seal look foreign.
 */
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
if (/^SIGN_SEAL_(KEY|CERT)=/m.test(existing)) {
  console.error(`${envFile} already has SIGN_SEAL_KEY/SIGN_SEAL_CERT; remove them to replace.`);
  process.exit(1);
}

const pair = await generateDevCertificate();
// Double-quoted, newlines as \n: dotenv expands them back.
const line = (pem: string) => JSON.stringify(pem);
appendFileSync(
  envFile,
  `${existing && !existing.endsWith('\n') ? '\n' : ''}# Development seal — self-issued, never for production\n` +
    `SIGN_SEAL_KEY=${line(pair.keyPem)}\nSIGN_SEAL_CERT=${line(pair.certPem)}\n`,
);
console.log(`Wrote a development seal pair to ${envFile}`);
