/**
 * Recent documents: a short list of names, kept in this browser and nowhere else. No file bytes
 * are kept, so opening one means choosing the file again. The list is per signed-in person, so a
 * shared computer does not show one person's names to the next.
 */
export type RecentKind = 'pdf' | 'word' | 'photo';

export interface Recent {
  name: string;
  kind: RecentKind;
  size: number;
  /** ISO timestamp the file was opened. */
  at: string;
}

export const RECENT_MAX = 8;
const KINDS: readonly string[] = ['pdf', 'word', 'photo'];

/** Newest first; the same name and size is the same document, so it moves to the top. */
export function addRecent(list: readonly Recent[], entry: Recent, max = RECENT_MAX): Recent[] {
  const rest = list.filter((item) => !(item.name === entry.name && item.size === entry.size));
  return [entry, ...rest].slice(0, max);
}

/** Whatever was stored, trusted no further than its shape. */
export function parseRecent(raw: string | null): Recent[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is Recent =>
          typeof item?.name === 'string' &&
          KINDS.includes(item.kind) &&
          Number.isFinite(item.size) &&
          typeof item.at === 'string',
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

const keyOf = (userId: string) => `tp.recent-documents.${userId}`;

export function loadRecent(userId: string): Recent[] {
  try {
    return parseRecent(localStorage.getItem(keyOf(userId)));
  } catch {
    return [];
  }
}

export function saveRecent(userId: string, list: readonly Recent[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(keyOf(userId));
    else localStorage.setItem(keyOf(userId), JSON.stringify(list));
  } catch {
    // Storage can be blocked; the list is a convenience.
  }
}

export function remember(userId: string, file: File, kind: RecentKind, now = new Date()): void {
  saveRecent(
    userId,
    addRecent(loadRecent(userId), {
      name: file.name,
      kind,
      size: file.size,
      at: now.toISOString(),
    }),
  );
}
