import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildServer } from '../server.js';
import { openLocalSignDatabase } from '../db/pglite.js';
import { declarations, serviceTokens } from '../db/schema.js';
import { DEMO_DECLARATION } from '../db/demo-declaration.js';
import { generateDevCertificate, loadSealer } from '../sealing/certificate.js';

/**
 * Sign on one computer — the desktop edition's copy of the product (ADR 0016, ADR 0009).
 *
 * The same `buildServer` a hosted Sign runs, on PGlite in a directory of its own, serving the
 * signer's page from its own origin, bound to 127.0.0.1. Nothing is shared with the Forms
 * workspace but the folder they are backed up in: Forms reaches it over CONTRACT §5 with a
 * service token, exactly as it would reach a Sign on the internet.
 *
 * Per install, generated at the first start and kept `0600` beside the data: the link secret, the
 * seal's key and certificate (a **self-issued** one — it proves a file was not changed, not who
 * sealed it; LAUNCH-CHECKLIST §6), and one service token per organisation that calls it.
 */
export interface LocalSign {
  url: string;
  app: FastifyInstance;
  /** The token an organisation's Forms presents; made the first time it is asked for. */
  tokenFor(organisationId: string, allowedOrigins: string[]): Promise<string>;
  close(): Promise<void>;
}

const Secrets = z.object({
  linkSecret: z.string().min(32),
  sealKeyPem: z.string(),
  sealCertPem: z.string(),
  /** organisationId → the plain token its Forms presents. Sign itself stores only the hash. */
  callers: z.record(z.string()).default({}),
});
type Secrets = z.infer<typeof Secrets>;

async function loadOrCreateSecrets(path: string): Promise<Secrets> {
  try {
    return Secrets.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pair = await generateDevCertificate();
  const secrets: Secrets = {
    linkSecret: randomBytes(32).toString('base64url'),
    sealKeyPem: pair.keyPem,
    sealCertPem: pair.certPem,
    callers: {},
  };
  await save(path, secrets);
  return secrets;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function save(path: string, secrets: Secrets): Promise<void> {
  // Written aside and renamed, so a crash mid-write never leaves a half file where the key was.
  await writeFile(`${path}.tmp`, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export async function startLocalSign(options: {
  dataDir: string;
  migrationsFolder: string;
  /** The built signing page (`apps/sign/dist`). */
  webDir?: string;
  /** 47018 in the shell; 0 in tests for any free port. */
  port?: number;
}): Promise<LocalSign> {
  await mkdir(options.dataDir, { recursive: true });
  const secretsPath = join(options.dataDir, 'secrets.json');
  const secrets = await loadOrCreateSecrets(secretsPath);
  const local = await openLocalSignDatabase({
    dataDir: join(options.dataDir, 'database'),
    migrationsFolder: options.migrationsFolder,
  });

  const [existing] = await local.db
    .select({ key: declarations.key })
    .from(declarations)
    .where(eq(declarations.key, DEMO_DECLARATION.key))
    .limit(1);
  if (!existing) await local.db.insert(declarations).values(DEMO_DECLARATION);

  // Fixed in the shell, so signing links stay valid across restarts. A test asks for 0, and gets
  // a free port found first — the links Sign hands out must name the port it listens on.
  const port = options.port === 0 ? await freePort() : (options.port ?? 47018);
  const url = `http://127.0.0.1:${port}`;
  let app: FastifyInstance;
  try {
    app = await buildServer({
      db: local.db,
      linkSecret: secrets.linkSecret,
      publicUrl: url,
      apiUrl: url,
      sealer: await loadSealer({ keyPem: secrets.sealKeyPem, certPem: secrets.sealCertPem }),
      ...(options.webDir ? { serveAppFrom: options.webDir } : {}),
    });
    await app.listen({ port, host: '127.0.0.1' });
  } catch (error) {
    await local.close();
    throw error;
  }

  return {
    url,
    app,
    async tokenFor(organisationId, allowedOrigins) {
      const known = secrets.callers[organisationId];
      if (known) {
        const hash = createHash('sha256').update(known).digest('hex');
        const [row] = await local.db
          .select({ id: serviceTokens.id })
          .from(serviceTokens)
          .where(eq(serviceTokens.tokenSha256, hash));
        if (row) return known;
      }
      const token = `svc_local_${randomBytes(24).toString('base64url')}`;
      await local.db.insert(serviceTokens).values({
        organisationId,
        name: 'desktop forms',
        tokenSha256: createHash('sha256').update(token).digest('hex'),
        allowedOrigins,
      });
      secrets.callers[organisationId] = token;
      await save(secretsPath, secrets);
      return token;
    },
    async close() {
      await app.close();
      await local.close();
    },
  };
}
