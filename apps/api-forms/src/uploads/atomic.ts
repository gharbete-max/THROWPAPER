import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

/**
 * Puts `content` at `target` so that the name is never a half-written file, and says whether the
 * same bytes were already there.
 *
 * The stores name a file by the hash of its bytes, so "a file of this name exists" is taken to
 * mean "these bytes are stored". A write straight to the name breaks that twice: a crash or a full
 * disk mid-write leaves a short file that every later upload of the same bytes then "deduplicates"
 * onto, and a second upload arriving during the write is told "already stored" while a reader
 * could get half of it. So: compare the bytes (they are in memory anyway), write beside the name
 * and rename into it. A rename is atomic on a local disk, and the last of two identical writers
 * wins with identical bytes.
 */
export async function storeAtomically(target: string, content: Buffer): Promise<boolean> {
  const existing = await readFile(target).catch(() => null);
  if (existing?.equals(content)) return true;

  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    // Windows refuses to rename over a file a reader has open; if the winner left the same bytes,
    // that is as good as ours.
    const now = await readFile(target).catch(() => null);
    if (!now?.equals(content)) throw error;
  }
  return false;
}
