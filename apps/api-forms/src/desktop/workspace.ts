import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { organisations, users } from '../db/schema.js';
import type { Db } from '../db/types.js';
import type { Repositories } from '../db/repositories/index.js';
import { MAGIC_LINK_TTL_SECONDS, expiryFrom, generateSecret, hashSecret } from '../auth/tokens.js';

/**
 * The desktop edition's data directory, and the two things about it that are not rows.
 *
 * Everything a desktop user owns lives under one folder — the database, the documents, the
 * uploads, the outbox, the settings and the secrets — so "back up Loppa" is "copy this folder",
 * and `DEPLOY.md`'s rule that one dataset is the database *plus* the document volume becomes one
 * thing rather than two that can be separated.
 */
export interface WorkspacePaths {
  root: string;
  database: string;
  documents: string;
  uploads: string;
  assets: string;
  /** Test-mode mail: every message written here as an `.eml` file instead of being sent. */
  outbox: string;
  settings: string;
  secrets: string;
}

export function workspacePaths(root: string): WorkspacePaths {
  return {
    root,
    database: join(root, 'database'),
    documents: join(root, 'documents'),
    uploads: join(root, 'documents', 'uploads'),
    assets: join(root, 'documents', 'assets'),
    outbox: join(root, 'outbox'),
    settings: join(root, 'settings.json'),
    secrets: join(root, 'secrets.json'),
  };
}

export async function ensureWorkspace(paths: WorkspacePaths): Promise<void> {
  for (const dir of [paths.root, paths.documents, paths.uploads, paths.assets, paths.outbox]) {
    await mkdir(dir, { recursive: true });
  }
}

const Secrets = z.object({
  jwtSecret: z.string().min(32),
  documentSigningSecret: z.string().min(32),
});
export type Secrets = z.infer<typeof Secrets>;

/**
 * Generated on first start and kept, never a constant.
 *
 * Demo mode draws fresh ones every boot because its data dies with the process. The desktop's
 * data does not, and a download link or a session that stopped working at every restart would be
 * a bug. So they are written once, beside the data they protect, and read back after that. The
 * server's own rules still hold: at least 32 characters, and never the same string twice.
 */
export async function loadOrCreateSecrets(path: string): Promise<Secrets> {
  try {
    return Secrets.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const secrets: Secrets = {
    jwtSecret: randomBytes(48).toString('base64url'),
    documentSigningSecret: randomBytes(48).toString('base64url'),
  };
  // 0o600: readable by the account that owns the data, and nobody else on a shared machine.
  await writeFile(path, JSON.stringify(secrets, null, 2), { encoding: 'utf8', mode: 0o600 });
  return secrets;
}

export const WorkspaceOwner = z.object({
  organisationName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  locale: z.string().min(2).default('sv-SE'),
});
export type WorkspaceOwner = z.input<typeof WorkspaceOwner>;

/**
 * The first organisation and its administrator, on a machine that has neither.
 *
 * ADR 0002 refuses a first-run *endpoint*: an unauthenticated write guarded only by "nobody is
 * here yet" is a race an attacker can observe. This is not that. It runs in-process, before the
 * server listens, on the say-so of whoever launched the program on their own machine — the same
 * position as whoever runs `pnpm db:seed` against a database they hold. Nothing reachable over
 * HTTP can call it.
 *
 * Returns `false`, and writes nothing, when an organisation already exists.
 */
export async function bootstrapWorkspace(db: Db, input: WorkspaceOwner): Promise<boolean> {
  const owner = WorkspaceOwner.parse(input);
  const existing = await db.select({ id: organisations.id }).from(organisations).limit(1);
  if (existing.length > 0) return false;

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: owner.organisationName,
      slug: 'local',
      defaultLocale: owner.locale,
      supportedLocales: [owner.locale],
    })
    .returning();
  if (!organisation) throw new Error('could not create the local organisation');

  await db.insert(users).values({
    organisationId: organisation.id,
    email: owner.email,
    name: owner.name,
    role: 'admin',
  });
  return true;
}

/**
 * A sign-in link for the person at the keyboard, through the ordinary magic-link exchange.
 *
 * On a desktop the mail that would carry a magic link may not be configured at all, and the user
 * is already the owner of every byte in the data directory. So the shell mints the link itself and
 * opens it — but as a real login token: hashed at rest, single use, fifteen minutes, consumed by
 * the same `/auth/callback` every other sign-in goes through. There is no bypass route, unlike
 * demo mode's `/demo/sign-in`; the only new thing is who delivers the link.
 *
 * `null` when there is nobody to sign in as — the shell then shows its first-run screen.
 */
export async function mintLocalSignInLink(
  repos: Repositories,
  appUrl: string,
  now: Date = new Date(),
): Promise<string | null> {
  const organisation = await repos.organisations.first();
  if (!organisation) return null;
  const people = await repos.users.list(organisation.id);
  const admin = people.find((person) => person.role === 'admin' && !person.disabledAt);
  if (!admin) return null;

  const secret = generateSecret();
  await repos.tokens.createLoginToken({
    userId: admin.id,
    tokenHash: hashSecret(secret),
    redirectTo: null,
    expiresAt: expiryFrom(now, MAGIC_LINK_TTL_SECONDS),
    requestedIp: '127.0.0.1',
  });
  return `${appUrl.replace(/\/$/, '')}/auth/callback?token=${secret}`;
}
