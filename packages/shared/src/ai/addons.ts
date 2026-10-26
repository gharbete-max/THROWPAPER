import { z } from 'zod';
import type { AiConsent } from './catalogue.js';

/**
 * "Add-ons and updates" (ADR 0026, amended): everything optional that is not in the installer,
 * reachable from one page inside the app, so nobody has to go looking on GitHub. `window.loppaAddons`
 * is the desktop shell's side of it; the hosted edition has none.
 *
 * Nothing here fetches on its own. Every action that touches the network takes the {@link AiConsent}
 * the person confirmed (host, files, total size), and the shell checks it against what it would
 * fetch before a byte moves. Types and request schemas only.
 */

/** Where the project's releases live (the app's own repository). */
export const RELEASE_REPO = 'gharbete-max/THROWPAPER';
/** Release tags of the desktop app start with this; the AI pack's release has another prefix. */
export const DESKTOP_TAG_PREFIX = 'desktop-v';
/** A release asset larger than this is not an installer. */
export const MAX_INSTALLER_BYTES = 600 * 1000 * 1000;

/**
 * The consent as the three fields it is and nothing else: whatever else a window adds is dropped,
 * because the shell appends what it receives to the consent record.
 */
export const ConsentRequest = z.object({
  host: z.string().max(253),
  files: z.array(z.string().max(255)).max(32),
  totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** The three things that can be fetched or done from the page. */
export type AddonTask = 'program' | 'pack' | 'installer';

export type AddonsProblem =
  | 'busy'
  | 'consent-required'
  | 'unavailable'
  | 'download-failed'
  | 'no-disk-space'
  | 'cancelled'
  /** The file arrived and is not the one the release lists: it was deleted. */
  | 'not-the-listed-file'
  | 'failed';

/** What the update check says; also the reasons it could not. */
export type UpdateProblem =
  'offline' | 'no-release' | 'rate-limited' | 'failed' | 'consent-required' | 'busy';

export interface AddonsStatus {
  /** This app's version, as it ships. */
  version: string;
  platform: string;
  arch: string;
  /**
   * The program that runs the model. `included`: the installer carries it. `installed`: fetched or
   * placed by hand. `missing`: can be fetched. `unavailable`: none is pinned for this computer.
   */
  program: {
    state: 'included' | 'installed' | 'missing' | 'unavailable';
    name: string;
    bytes: number;
    /** False: run and checked by this project on another kind of computer only. */
    tested: boolean;
    /** What a download would ask the person to agree to; null unless the state is `missing`. */
    consent: AiConsent | null;
    folder: string;
  };
  /** The AI pack: the model's files from the published release, for offline installs. */
  pack: {
    state: 'present' | 'missing';
    bytes: number;
    consent: AiConsent | null;
  };
  /** The update check, which fetches nothing until pressed. */
  update: {
    consent: AiConsent;
    /** The portable Windows program: it is replaced, not installed over. */
    portable: boolean;
    /** The installer saved by an earlier press this session, if it is still there. */
    downloaded: string | null;
  };
}

export type UpdateCheck =
  | {
      ok: true;
      current: string;
      /** The newest desktop release; null when none is published. */
      latest: string | null;
      newer: boolean;
      /** The release notes as plain text, cut to a readable length. */
      notes: string;
      /** Where the release is on the web; shown, never opened by the app on its own. */
      page: string;
      /** The installer for this computer, or null: none in that release, or nothing to update to. */
      installer: { name: string; bytes: number; consent: AiConsent } | null;
    }
  | { ok: false; problem: UpdateProblem };

export type AddonsStart = { ok: true } | { ok: false; problem: AddonsProblem };

export type AddonsEvent =
  | { kind: 'progress'; task: AddonTask; done: number; total: number }
  | { kind: 'done'; task: AddonTask; status: AddonsStatus }
  | { kind: 'failed'; task: AddonTask; problem: AddonsProblem };

export interface AddonsBridge {
  status(): Promise<AddonsStatus>;
  /** Fetches the program that runs the model after the person agreed to `consent`; verifies it first. */
  installProgram(consent: AiConsent): Promise<AddonsStart>;
  /** Fetches the AI pack (all the model's files) from the published release. */
  installPack(consent: AiConsent): Promise<AddonsStart>;
  /** Asks the releases page which version is newest. Fetches nothing else. */
  checkUpdate(consent: AiConsent): Promise<UpdateCheck>;
  /** Saves the installer for this computer in the Downloads folder and checks it against the release's SHA256SUMS.txt. */
  downloadInstaller(consent: AiConsent): Promise<AddonsStart>;
  /** Opens the installer saved by {@link downloadInstaller}; the app never runs it by itself. */
  openInstaller(): Promise<{ ok: boolean }>;
  cancel(): Promise<void>;
  onEvent(listener: (event: AddonsEvent) => void): () => void;
}
