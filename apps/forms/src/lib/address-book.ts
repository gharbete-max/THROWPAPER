/**
 * The address book: the people this browser has recently sent a document to, offered as you type.
 *
 * It lives in this browser's own storage and nowhere else — it is never sent to the server or
 * anywhere. Every access is wrapped: storage can be missing, full, blocked or hold something
 * unexpected (a private window, cleared site data), and then the book is simply empty.
 */
export interface BookEntry {
  address: string;
  /** When it was last used, in milliseconds. */
  last: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const BOOK_KEY = 'loppa.addressBook.v1';
/** The most addresses kept; the least recently used go first. */
export const BOOK_LIMIT = 200;

const browserStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Most recent first. */
export function loadBook(store: Store | null = browserStore()): BookEntry[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(BOOK_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is BookEntry =>
          typeof entry?.address === 'string' && typeof entry?.last === 'number',
      )
      .sort((a, b) => b.last - a.last);
  } catch {
    return [];
  }
}

function save(book: readonly BookEntry[], store: Store | null) {
  try {
    if (book.length === 0) store?.removeItem(BOOK_KEY);
    else store?.setItem(BOOK_KEY, JSON.stringify(book));
  } catch {
    // Nowhere to keep it: the book is a convenience, so the send goes on.
  }
}

const key = (address: string) => address.trim().toLowerCase();

/** Adds addresses used just now (or moves them to the front). Returns the new book. */
export function remember(
  addresses: readonly string[],
  now: number = Date.now(),
  store: Store | null = browserStore(),
): BookEntry[] {
  const used = new Set(addresses.map(key).filter((address) => address.includes('@')));
  const kept = loadBook(store).filter((entry) => !used.has(entry.address));
  const book = [...[...used].map((address) => ({ address, last: now })), ...kept].slice(
    0,
    BOOK_LIMIT,
  );
  save(book, store);
  return book;
}

export function forget(address: string, store: Store | null = browserStore()): BookEntry[] {
  const book = loadBook(store).filter((entry) => entry.address !== key(address));
  save(book, store);
  return book;
}

export function clearBook(store: Store | null = browserStore()): void {
  save([], store);
}

/**
 * What to offer for what is being typed: addresses that contain it (those that start with it
 * first), most recent first, never the one already typed in full.
 */
export function suggest(book: readonly BookEntry[], typed: string, limit = 5): string[] {
  const needle = key(typed);
  if (needle === '') return [];
  const matches = book.filter(
    (entry) => entry.address.includes(needle) && entry.address !== needle,
  );
  const starts = matches.filter((entry) => entry.address.startsWith(needle));
  return [...starts, ...matches.filter((entry) => !starts.includes(entry))]
    .slice(0, limit)
    .map((entry) => entry.address);
}
