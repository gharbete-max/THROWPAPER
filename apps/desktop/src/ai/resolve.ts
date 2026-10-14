import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileNames, type FileSource, type ModelFile, type ModelManifest } from '@tp/shared/ai';

/**
 * Where a model file is looked for (docs/plan/AI-SYSTEM.md D7, ADR 0024), first match wins:
 *
 * 1. `LOPPA_AI_DIR`, if set: `<dir>/<name>` or `<dir>/<kind>/<name>`. Any build.
 * 2. `<repo>/local-models/<kind>/<name>`: Git-ignored, development only.
 * 3. `<repo>/<name>`: the repository root as the owner's files are laid out now. Development only.
 * 4. A location the person gave with "open from disk", then Loppa's own folder in the user-data
 *    directory. The only places a packaged app reads.
 *
 * "Development only" means an unpackaged build: `repoRoot` is null in a packaged app, and the
 * two tiers are not looked at. Every name a file goes by (`name` and its aliases) is tried in each
 * place. Finding a file proves nothing about it: the coordinator hashes it once against the
 * manifest before using it, whichever tier it came from.
 */
export interface ResolveContext {
  env: NodeJS.ProcessEnv;
  /** The checkout, in a development build; null when packaged. */
  repoRoot: string | null;
  /** Loppa's folder for downloaded model files. */
  userDataModels: string;
  /** File name to the path the person opened it from. */
  remembered: Readonly<Record<string, string>>;
}

export interface Located {
  path: string;
  source: FileSource;
}

const isFile = (path: string) =>
  stat(path).then(
    (info) => info.isFile(),
    () => false,
  );

/** The places to look, in order, as labelled directories. Exported for the test and the status panel. */
export function searchDirs(
  kind: string,
  context: ResolveContext,
): Array<{ dir: string; source: FileSource }> {
  const dirs: Array<{ dir: string; source: FileSource }> = [];
  const override = context.env.LOPPA_AI_DIR;
  if (override) {
    dirs.push({ dir: override, source: 'env' }, { dir: join(override, kind), source: 'env' });
  }
  if (context.repoRoot) {
    dirs.push(
      { dir: join(context.repoRoot, 'local-models', kind), source: 'local-models' },
      { dir: context.repoRoot, source: 'repo-root' },
    );
  }
  dirs.push({ dir: context.userDataModels, source: 'user-data' });
  return dirs;
}

export async function locateFile(
  file: ModelFile,
  kind: string,
  context: ResolveContext,
): Promise<Located | null> {
  const names = fileNames(file);
  const before = searchDirs(kind, context);
  const lastOwn = before.length - 1; // the user-data folder
  for (const [index, { dir, source }] of before.entries()) {
    if (index === lastOwn) {
      const given = context.remembered[file.name];
      if (given && (await isFile(given))) return { path: given, source: 'remembered' };
    }
    for (const name of names) {
      const path = join(dir, name);
      if (await isFile(path)) return { path, source };
    }
  }
  return null;
}

export async function locateModel(
  manifest: ModelManifest,
  context: ResolveContext,
): Promise<Array<{ file: ModelFile; found: Located | null }>> {
  return Promise.all(
    manifest.files.map(async (file) => ({
      file,
      found: await locateFile(file, manifest.kind, context),
    })),
  );
}
