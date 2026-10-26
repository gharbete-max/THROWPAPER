import { RELEASE_REPO, type AiConsent, type ModelFile, type ModelManifest } from '@tp/shared/ai';
import { downloadFile, type OnProgress } from '../ai/download.js';
import { PACK_FILE, PackError, isPlainFileName, parsePackManifest } from '../ai/pack.js';
import { fetchText } from './net.js';
import { isUpdateHost, plainName } from './release.js';

/**
 * The AI pack from its published release (ADR 0025 section 4, ADR 0026 decision 8, amended): the
 * model's files cut in parts, on GitHub, for offline installs and for computers that cannot reach
 * Hugging Face. The default way to get a model stays the download from Hugging Face; this is the
 * other one, behind its own button and its own confirmation.
 *
 * The machinery is the model download's: resumable parts (`<name>.partN.partial`), every part's
 * size and SHA-256 as it arrives, the joined file against the app's own manifest, a rename only
 * when it matches. What is new is only where the parts are listed: `PACK.json` on the release.
 * It is read as untrusted: its file names must be the manifest's, its sizes and hashes must agree
 * with the manifest's (the app's code is the authority, `PACK.json` a convenience), its part names
 * must be that file's `.partN`, and the addresses are built here from the tag and those names.
 */
export const packTag = (model: ModelManifest) => `ai-pack-${model.id}`;

/** What the whole pack is: every file of the model, the optional lighter projector too. */
export function packTotalBytes(model: ModelManifest): number {
  return model.files.reduce((sum, file) => sum + file.bytes, 0);
}

/** The disk the pack needs at its peak: all of it, and the largest file again while parts are joined. */
export function packPeakBytes(model: ModelManifest): number {
  return packTotalBytes(model) + Math.max(...model.files.map((file) => file.bytes));
}

export function packConsent(model: ModelManifest): AiConsent {
  return {
    host: 'github.com',
    files: model.files.map((file) => file.name),
    totalBytes: packTotalBytes(model),
  };
}

const PACK_JSON_CAP = 64 * 1024;

/** The pack's files as `downloadFile` takes them: the parts from the release, the hashes from the app. */
export async function planPack(options: {
  model: ModelManifest;
  fetch: typeof fetch;
  signal?: AbortSignal;
}): Promise<ModelFile[]> {
  const { model } = options;
  const tag = packTag(model);
  const base = `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}`;
  const text = await fetchText(`${base}/${PACK_FILE}`, {
    fetch: options.fetch,
    allowHost: isUpdateHost,
    cap: PACK_JSON_CAP,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const pack = parsePackManifest(text);
  if (pack.id !== model.id) throw new PackError('hash', `the pack is for ${pack.id}`);

  return model.files.map((file): ModelFile => {
    const listed = pack.files.find((f) => f.name === file.name);
    if (!listed || !file.sha256) throw new PackError('missing', `${file.name} is not in the pack`);
    if (listed.bytes !== file.bytes || listed.sha256 !== file.sha256) {
      throw new PackError('hash', `${file.name} in the pack is not the file in the manifest`);
    }
    const whole = listed.parts.reduce((sum, part) => sum + part.bytes, 0);
    if (whole !== file.bytes) throw new PackError('size', `${file.name}: the parts do not add up`);
    for (const part of listed.parts) {
      const ours = part.name === file.name || part.name.startsWith(`${file.name}.part`);
      if (!ours || !isPlainFileName(part.name) || !plainName(part.name)) {
        throw new PackError('io', `${part.name} is not a part of ${file.name}`);
      }
    }
    return {
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256,
      role: file.role,
      parts: listed.parts.map((part) => ({
        name: part.name,
        bytes: part.bytes,
        sha256: part.sha256,
        url: `${base}/${encodeURIComponent(part.name)}`,
      })),
    };
  });
}

/**
 * Fetches the pack into `dir` (Loppa's models folder, where the model is looked for). A file
 * already there and right is skipped, which is how an interrupted pack resumes at the file it
 * stopped in. Reports bytes of the whole pack. Called only after the confirmation.
 */
export async function fetchPack(options: {
  model: ModelManifest;
  dir: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { model, dir } = options;
  const plan = await planPack(options);
  const total = packTotalBytes(model);
  let before = 0;
  for (const file of plan) {
    const report: OnProgress = (p) => options.onProgress?.(before + p.done, total);
    // A file whose size and hash are already right is returned at once by downloadFile.
    await downloadFile({
      file,
      dir,
      fetch: options.fetch,
      allowHost: isUpdateHost,
      onProgress: report,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    before += file.bytes;
    options.onProgress?.(before, total);
  }
}
