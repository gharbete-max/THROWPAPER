import { appendFile, mkdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LLAMA_SERVER,
  RELEASE_REPO,
  TEXT_MODEL,
  runtimeAssetFor,
  type AddonTask,
  type AddonsEvent,
  type AddonsProblem,
  type AddonsStart,
  type AddonsStatus,
  type AiConsent,
  type AiStatus,
  type ModelManifest,
  type RuntimeAsset,
  type RuntimeManifest,
  type UpdateCheck,
  type UpdateProblem,
} from '@tp/shared/ai';
import { WeightsError, downloadFile, verifyFile } from '../ai/download.js';
import { PackError } from '../ai/pack.js';
import { fetchRuntime } from '../ai/runtime-fetch.js';
import type { createRuntimeChecker } from '../ai/runtime.js';
import { ExtractError } from './extract.js';
import { HttpError, fetchText } from './net.js';
import { fetchPack, packConsent, packPeakBytes } from './pack-download.js';
import {
  RELEASES_URL,
  SUMS_NAME,
  UPDATE_CHECK_CONSENT,
  chooseInstaller,
  compareVersions,
  installerConsent,
  isUpdateHost,
  newestDesktop,
  parseReleases,
  parseSha256Sums,
  parseVersion,
  plainNotes,
  releaseFileUrl,
  sameConsent,
  type Release,
  type ReleaseAsset,
} from './release.js';

/**
 * Add-ons and updates (ADR 0026, amended): the optional things that are not in the installer,
 * fetched from inside the app so nobody has to look for files on GitHub.
 *
 * - **The program that runs the model** (`llama-server`) for computers whose installer does not
 *   carry it (macOS, and any other system): the pinned release asset, its archive hashed against
 *   the manifest before it is opened, unpacked by `extract.ts`, put where the resolver already looks.
 * - **The AI pack** from its published release, by the model download's own machinery.
 * - **The update check** and **the installer download**: a question to GitHub's release list, an
 *   installer saved in the Downloads folder and checked against the release's `SHA256SUMS.txt`, and
 *   a button that opens it. The app never runs an installer by itself.
 *
 * Rules that live here: nothing fetches without a consent that equals what would be fetched
 * (host, files, total size), which the person saw and confirmed and which is written to the consent
 * record; one thing at a time, and never beside a model download or a task; nothing automatic;
 * nothing a window sends names a path, a URL or a file (the consent is compared, never used).
 */
export interface AddonsDeps {
  version: string;
  platform: string;
  arch: string;
  /** The Windows portable program: it is replaced, not installed over. */
  portable: boolean;
  /** Loppa's models folder: the program goes in `runtime/`, the pack beside the model's files, the consent record here. */
  dir: string;
  /** The person's Downloads folder. */
  downloads: string;
  /** What the models and the coordinator are doing. */
  models: {
    status(): Promise<AiStatus>;
    busy(): boolean;
  };
  runtime: Pick<ReturnType<typeof createRuntimeChecker>, 'status' | 'forget'>;
  fetch: typeof fetch;
  /** Opens a file with the system, as a person double-clicking it would: Electron's `shell.openPath`. */
  openPath(path: string): Promise<string>;
  emit(event: AddonsEvent): void;
  manifest?: RuntimeManifest;
  model?: ModelManifest;
  freeDisk?(dir: string): Promise<number | null>;
  now?(): number;
}

const DISK_MARGIN_BYTES = 256 * 1024 * 1024;
const RELEASES_CAP = 2 * 1024 * 1024;
const SUMS_CAP = 64 * 1024;

export function createAddons(deps: AddonsDeps) {
  const manifest = deps.manifest ?? LLAMA_SERVER;
  const model = deps.model ?? TEXT_MODEL;
  const now = deps.now ?? Date.now;
  const consentLog = join(deps.dir, 'consents.jsonl');
  const programDir = join(deps.dir, 'runtime');
  const freeDisk =
    deps.freeDisk ??
    (async (dir: string) => {
      const info = await statfs(dir).catch(() => null);
      return info ? Number(info.bavail) * Number(info.bsize) : null;
    });

  let busy = false;
  let abort: AbortController | null = null;
  let last: {
    tag: string;
    version: string;
    release: Release;
    installer: ReleaseAsset | null;
  } | null = null;
  let downloaded: { path: string; bytes: number; sha256: string } | null = null;

  const asset = (): RuntimeAsset | undefined => runtimeAssetFor(deps.platform, deps.arch, manifest);

  async function status(): Promise<AddonsStatus> {
    const wanted = asset();
    const runtime = wanted ? await deps.runtime.status() : null;
    const found = runtime?.path != null;
    const programState: AddonsStatus['program']['state'] = !wanted
      ? 'unavailable'
      : found
        ? runtime?.source === 'ai-pack'
          ? 'included'
          : 'installed'
        : 'missing';
    const ai = await deps.models.status().catch(() => null);
    const there = ai?.models.find((m) => m.id === model.id)?.state;
    const packThere = there === 'installed' || there === 'busy';
    const stillThere = downloaded
      ? (await stat(downloaded.path).catch(() => null))?.isFile()
        ? downloaded.path
        : null
      : null;
    return {
      version: deps.version,
      platform: deps.platform,
      arch: deps.arch,
      program: {
        state: programState,
        name: `${manifest.name} ${manifest.tag}`,
        bytes: wanted?.bytes ?? 0,
        tested: wanted?.verified ?? false,
        consent:
          programState === 'missing' && wanted
            ? { host: new URL(wanted.url).hostname, files: [wanted.name], totalBytes: wanted.bytes }
            : null,
        folder: programDir,
      },
      pack: {
        state: packThere ? 'present' : 'missing',
        bytes: packConsent(model).totalBytes,
        consent: packThere ? null : packConsent(model),
      },
      update: { consent: UPDATE_CHECK_CONSENT, portable: deps.portable, downloaded: stillThere },
    };
  }

  // --- the work every fetch shares -------------------------------------------------------------

  /** Refuses unless idle; takes the one slot; keeps the consent; returns the signal. */
  async function begin(
    task: AddonTask,
    given: AiConsent,
    wanted: AiConsent | null,
    needBytes: number,
    where: string,
  ): Promise<{ ok: true; signal: AbortSignal } | { ok: false; problem: AddonsProblem }> {
    if (!wanted || !sameConsent(given, wanted)) return { ok: false, problem: 'consent-required' };
    if (busy || deps.models.busy()) return { ok: false, problem: 'busy' };
    await mkdir(where, { recursive: true });
    const room = await freeDisk(where);
    if (room !== null && room < needBytes + DISK_MARGIN_BYTES) {
      return { ok: false, problem: 'no-disk-space' };
    }
    busy = true;
    abort = new AbortController();
    // When, what, from where. Never anything else.
    await mkdir(deps.dir, { recursive: true });
    await appendFile(
      consentLog,
      `${JSON.stringify({ at: new Date(now()).toISOString(), modelId: `addon:${task}`, ...wanted })}\n`,
      'utf8',
    ).catch(() => undefined);
    return { ok: true, signal: abort.signal };
  }

  function problemOf(error: unknown, signal: AbortSignal): AddonsProblem {
    if (signal.aborted) return 'cancelled';
    if (error instanceof WeightsError) {
      if (error.failure === 'disk') return 'no-disk-space';
      if (error.failure === 'hash' || error.failure === 'size') return 'not-the-listed-file';
    }
    if (error instanceof ExtractError) return 'not-the-listed-file';
    if (error instanceof PackError && (error.failure === 'hash' || error.failure === 'size')) {
      return 'not-the-listed-file';
    }
    return 'download-failed';
  }

  /** Runs `work` in the background; reports its end; frees the slot. */
  function run(
    task: AddonTask,
    signal: AbortSignal,
    work: (progress: (done: number, total: number) => void) => Promise<void>,
  ): void {
    let at = 0;
    const progress = (done: number, total: number) => {
      const t = now();
      if (t - at < 250 && done < total) return;
      at = t;
      deps.emit({ kind: 'progress', task, done, total });
    };
    void (async () => {
      try {
        await work(progress);
        busy = false;
        deps.emit({ kind: 'done', task, status: await status() });
      } catch (error) {
        busy = false;
        deps.emit({ kind: 'failed', task, problem: problemOf(error, signal) });
      } finally {
        abort = null;
      }
    })();
  }

  // --- the program that runs the model --------------------------------------------------------

  async function installProgram(given: AiConsent): Promise<AddonsStart> {
    const wanted = asset();
    if (!wanted) return { ok: false, problem: 'unavailable' };
    if (((await deps.runtime.status()).path ?? null) !== null) {
      return { ok: false, problem: 'unavailable' };
    }
    const start = await begin(
      'program',
      given,
      { host: new URL(wanted.url).hostname, files: [wanted.name], totalBytes: wanted.bytes },
      wanted.bytes * 8,
      deps.dir,
    );
    if (!start.ok) return start;
    run('program', start.signal, async (progress) => {
      await fetchRuntime({
        asset: wanted,
        dir: programDir,
        fetch: deps.fetch,
        signal: start.signal,
        onProgress: (p) => progress(p.done, p.total),
      });
      deps.runtime.forget();
    });
    return { ok: true };
  }

  // --- the AI pack ----------------------------------------------------------------------------

  async function installPack(given: AiConsent): Promise<AddonsStart> {
    const ai = await deps.models.status();
    const there = ai.models.find((m) => m.id === model.id)?.state;
    if (there === 'installed' || there === 'busy') return { ok: false, problem: 'unavailable' };
    const start = await begin('pack', given, packConsent(model), packPeakBytes(model), deps.dir);
    if (!start.ok) return start;
    run('pack', start.signal, (progress) =>
      fetchPack({
        model,
        dir: deps.dir,
        fetch: deps.fetch,
        signal: start.signal,
        onProgress: progress,
      }),
    );
    return { ok: true };
  }

  // --- the update check and the installer -----------------------------------------------------

  async function checkUpdate(given: AiConsent): Promise<UpdateCheck> {
    const fail = (problem: UpdateProblem): UpdateCheck => ({ ok: false, problem });
    if (!sameConsent(given, UPDATE_CHECK_CONSENT)) return fail('consent-required');
    if (busy || deps.models.busy()) return fail('busy');
    busy = true;
    const controller = new AbortController();
    abort = controller;
    await mkdir(deps.dir, { recursive: true });
    await appendFile(
      consentLog,
      `${JSON.stringify({ at: new Date(now()).toISOString(), modelId: 'addon:update-check', ...UPDATE_CHECK_CONSENT })}\n`,
      'utf8',
    ).catch(() => undefined);
    try {
      const text = await fetchText(RELEASES_URL, {
        fetch: deps.fetch,
        allowHost: isUpdateHost,
        cap: RELEASES_CAP,
        accept: 'application/vnd.github+json',
        signal: controller.signal,
      });
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return fail('failed');
      }
      const releases = parseReleases(json);
      if (!releases) return fail('failed');
      const newest = newestDesktop(releases);
      if (!newest) {
        last = null;
        return {
          ok: true,
          current: deps.version,
          latest: null,
          newer: false,
          notes: '',
          page: `https://github.com/${RELEASE_REPO}/releases`,
          installer: null,
        };
      }
      const newer =
        parseVersion(deps.version) !== null && compareVersions(newest.version, deps.version) > 0;
      const installer = newer
        ? chooseInstaller(newest.release.assets, deps.platform, deps.arch, deps.portable)
        : null;
      last = {
        tag: newest.release.tag_name,
        version: newest.version,
        release: newest.release,
        installer,
      };
      return {
        ok: true,
        current: deps.version,
        latest: newest.version,
        newer,
        notes: plainNotes(newest.release.body),
        page: releasePage(newest.release),
        installer: installer
          ? { name: installer.name, bytes: installer.size, consent: installerConsent(installer) }
          : null,
      };
    } catch (error) {
      if (error instanceof HttpError) {
        return fail(error.status === 403 || error.status === 429 ? 'rate-limited' : 'failed');
      }
      if (error instanceof WeightsError) return fail('failed');
      return fail('offline');
    } finally {
      busy = false;
      abort = null;
    }
  }

  async function downloadInstaller(given: AiConsent): Promise<AddonsStart> {
    const installer = last?.installer;
    if (!last || !installer) return { ok: false, problem: 'unavailable' };
    const { tag, version, release } = last;
    const start = await begin(
      'installer',
      given,
      installerConsent(installer),
      installer.size,
      deps.downloads,
    );
    if (!start.ok) return start;
    run('installer', start.signal, async (progress) => {
      // The checksums come from the same release, and the file has to be listed in them.
      if (!release.assets.some((a) => a.name === SUMS_NAME)) {
        throw new WeightsError('hash', `${SUMS_NAME} is not on the release`);
      }
      const sums = parseSha256Sums(
        await fetchText(releaseFileUrl(tag, SUMS_NAME), {
          fetch: deps.fetch,
          allowHost: isUpdateHost,
          cap: SUMS_CAP,
          signal: start.signal,
        }),
      );
      const sha256 = sums.get(installer.name);
      if (!sha256) throw new WeightsError('hash', `${installer.name} is not in ${SUMS_NAME}`);
      // When GitHub has hashed the file too, the two have to agree.
      const digest = installer.digest?.startsWith('sha256:') ? installer.digest.slice(7) : null;
      if (digest && digest.toLowerCase() !== sha256) {
        throw new WeightsError('hash', 'the release page and the checksum list disagree');
      }
      // A version in the name, so that an older installer in Downloads is not written over.
      const dot = installer.name.lastIndexOf('.');
      const name = `${installer.name.slice(0, dot)}-${version}${installer.name.slice(dot)}`;
      const path = await downloadFile({
        file: {
          name,
          bytes: installer.size,
          sha256,
          role: 'runtime',
          parts: [
            { name, bytes: installer.size, sha256, url: releaseFileUrl(tag, installer.name) },
          ],
        },
        dir: deps.downloads,
        fetch: deps.fetch,
        allowHost: isUpdateHost,
        signal: start.signal,
        onProgress: (p) => progress(p.done, p.total),
      });
      downloaded = { path, bytes: installer.size, sha256 };
    });
    return { ok: true };
  }

  async function openInstaller(): Promise<{ ok: boolean }> {
    if (!downloaded) return { ok: false };
    // Checked again just before it is opened: it has sat in a folder other programs can write to.
    const same = await verifyFile(downloaded.path, downloaded);
    if (same !== 'ok') return { ok: false };
    return { ok: (await deps.openPath(downloaded.path)) === '' };
  }

  return {
    status,
    installProgram,
    installPack,
    checkUpdate,
    downloadInstaller,
    openInstaller,
    /** Something is being fetched or checked: the models must not start a download beside it. */
    working: (): boolean => busy,
    async cancel(): Promise<void> {
      abort?.abort();
    },
    close(): void {
      abort?.abort();
    },
  };
}

export type Addons = ReturnType<typeof createAddons>;

function releasePage(release: Release): string {
  const page = release.html_url;
  return page && page.startsWith('https://github.com/')
    ? page
    : `https://github.com/${RELEASE_REPO}/releases`;
}
