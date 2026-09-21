import type { Repositories } from '../db/repositories/index.js';
import type { PrivateUploadStore } from './private-store.js';

/**
 * How long an anonymous upload may sit unclaimed, and what happens after that.
 *
 * Somebody attaches a file and closes the tab. A row in `form_uploads` says when the bytes
 * arrived and that no submission took them; `form_uploads_unclaimed_idx` was cut for exactly
 * this sweep, and this is the sweep.
 *
 * **The window is the resume window, deliberately.** A saved-and-resumed draft can still claim
 * its upload for as long as its resume link lives, and nothing else can claim one later than
 * that. So the cutoff is not a retention period chosen here — that decision is the owner's, and
 * open — it is the one the code already makes for drafts, read back. The submit path refuses to
 * claim past the same window (`findUnclaimed`), which is what makes the sweep safe against a
 * claim: they never want the same row, whatever the timing.
 *
 * **Bytes go last, and only when nothing names them.** The store is content-addressed, so one
 * file may back several rows, and a form imported from paper keeps its pages in the same store
 * with no row at all. A key still held by any row, or listed as a paper source in any draft or
 * published version, keeps its bytes.
 */
export const UPLOAD_CLAIM_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export interface SweepResult {
  rowsDeleted: number;
  filesDeleted: number;
  /** Rows went, bytes stayed: another row or a paper source still names the key. */
  filesKept: number;
}

export async function sweepExpiredUploads(
  deps: { repos: Repositories; uploadStore: PrivateUploadStore },
  options: { now?: Date; limit?: number } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  // ponytail: one batch per tick; a backlog drains over a few ticks rather than one long one.
  const limit = options.limit ?? 200;
  const before = new Date(now.getTime() - UPLOAD_CLAIM_WINDOW_SECONDS * 1000);

  const keys = await deps.repos.uploads.sweepExpired(before, limit);

  let filesDeleted = 0;
  let filesKept = 0;
  for (const key of new Set(keys)) {
    const held =
      (await deps.repos.uploads.isReferenced(key)) ||
      (await deps.repos.forms.referencesUpload(key));
    if (held) {
      filesKept += 1;
      continue;
    }
    await deps.uploadStore.delete(key);
    filesDeleted += 1;
  }

  return { rowsDeleted: keys.length, filesDeleted, filesKept };
}
