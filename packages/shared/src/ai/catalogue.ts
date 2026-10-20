import { isAllowedHost, totalBytes, type ModelFile, type ModelManifest } from './manifest.js';

/**
 * The catalogue's rules (ADR 0025, ADR 0026): which host a model may come from, what the person
 * agrees to before a byte is fetched, and which model suits a computer. Pure: no clock, no disk.
 *
 * AI is optional. Nothing here is called at start-up, and no model is ever fetched without the
 * person pressing the button and confirming the consent below.
 */

/** The files a download fetches: all but the optional ones. */
export function downloadFiles(manifest: ModelManifest): ModelFile[] {
  return manifest.files.filter((file) => !file.optional);
}

/** The host every file comes from, or null if they come from several or none is published. */
export function downloadHost(manifest: ModelManifest): string | null {
  const hosts = new Set(
    downloadFiles(manifest).flatMap((file) =>
      file.parts.map((part) => (part.url.startsWith('https://') ? new URL(part.url).host : '')),
    ),
  );
  const [only] = [...hosts];
  return hosts.size === 1 && only ? only : null;
}

/**
 * What the person agrees to: the host, the files and the total size. It is shown, confirmed, sent,
 * checked against the manifest by the coordinator and recorded; it cannot be used for a different
 * download than the one it names.
 */
export interface AiConsent {
  host: string;
  files: string[];
  totalBytes: number;
}

export function consentFor(manifest: ModelManifest): AiConsent | null {
  const host = downloadHost(manifest);
  return host && isAllowedHost(host)
    ? {
        host,
        files: downloadFiles(manifest).map((file) => file.name),
        totalBytes: totalBytes(manifest),
      }
    : null;
}

export function consentMatches(manifest: ModelManifest, given: unknown): boolean {
  const wanted = consentFor(manifest);
  if (!wanted || typeof given !== 'object' || given === null) return false;
  const c = given as Partial<AiConsent>;
  return (
    c.host === wanted.host &&
    c.totalBytes === wanted.totalBytes &&
    Array.isArray(c.files) &&
    c.files.length === wanted.files.length &&
    wanted.files.every((name, index) => c.files?.[index] === name)
  );
}

/** Total memory a computer needs to hold a model: its working set plus the system's own share. */
export function minTotalMemoryBytes(manifest: ModelManifest): number {
  return Math.round(manifest.requiredMemoryBytes * 1.15);
}

/**
 * The best model this computer can hold: the first, in tier order, whose total memory suffices and
 * whose working set is free now. If none, the smallest one, so the list still has an answer.
 * Never downloads anything; the list marks it and the person decides.
 */
export function recommendModel(
  models: readonly ModelManifest[],
  memory: { totalBytes: number; freeBytes: number },
): string | null {
  const usable = models.filter((m) => !m.evaluationOnly && m.support.state !== 'not-working-yet');
  const fits = usable.find(
    (m) => memory.totalBytes >= minTotalMemoryBytes(m) && memory.freeBytes >= m.requiredMemoryBytes,
  );
  if (fits) return fits.id;
  return [...usable].sort((a, b) => a.requiredMemoryBytes - b.requiredMemoryBytes)[0]?.id ?? null;
}
