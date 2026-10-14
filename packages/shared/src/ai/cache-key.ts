/**
 * The key a page's result is cached under (docs/plan/AI-SYSTEM.md D4):
 * `sha256(file) + page + pipelineVersion + modelId + settings`.
 *
 * Any of them changing is a different result, so any of them changing is a different key: a new
 * model, a new pipeline, a new render size, a different file. The settings are written in a fixed
 * order so the same settings always give the same key. The file's hash is computed by the caller
 * (a window has no `node:crypto` and the shell does), which is why it arrives as a string.
 */
export type CacheSetting = string | number | boolean | null;

export interface CacheKeyParts {
  fileSha256: string;
  /** 1-based. */
  page: number;
  pipelineVersion: number | string;
  modelId: string;
  settings: Readonly<Record<string, CacheSetting>>;
}

export function cacheKey(parts: CacheKeyParts): string {
  if (!/^[0-9a-f]{64}$/.test(parts.fileSha256)) throw new Error('fileSha256 is a SHA-256');
  if (!Number.isInteger(parts.page) || parts.page < 1) throw new Error('page counts from 1');
  const settings = Object.keys(parts.settings)
    .sort()
    .map(
      (name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(parts.settings[name]))}`,
    )
    .join('&');
  return [
    parts.fileSha256,
    parts.page,
    encodeURIComponent(String(parts.pipelineVersion)),
    encodeURIComponent(parts.modelId),
    settings,
  ].join('|');
}
