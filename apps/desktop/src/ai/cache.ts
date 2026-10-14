import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The local result cache (docs/plan/AI-SYSTEM.md D4, ADR 0024): what a model made for one page of
 * one file, kept in the user-data directory so a repeat read, a summary and a question reuse it
 * without touching an image again. Keyed by `cacheKey()` from `@tp/shared/ai`.
 *
 * One JSON file, held in memory, written whole (to a temporary file and renamed) after a change.
 * Capped in bytes: when a new entry would go over, the least recently *used* entries go first. A
 * counter and not the clock says which that is, so the order never depends on the time. Clearable
 * by the person, which deletes the file. An unreadable or foreign file is an empty cache, never an
 * error: a cache is always allowed to be empty.
 */
export const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;

interface Entry {
  value: unknown;
  bytes: number;
  used: number;
}

interface Stored {
  version: 1;
  counter: number;
  entries: Record<string, Entry>;
}

export class ResultCache {
  private entries = new Map<string, Entry>();
  private counter = 0;
  private total = 0;
  private loaded: Promise<void> | null = null;

  constructor(
    private readonly file: string,
    readonly maxBytes: number = DEFAULT_CACHE_BYTES,
  ) {}

  private load(): Promise<void> {
    this.loaded ??= readFile(this.file, 'utf8').then(
      (text) => {
        try {
          const stored = JSON.parse(text) as Stored;
          if (stored.version !== 1) return;
          this.counter = stored.counter;
          for (const [key, entry] of Object.entries(stored.entries)) {
            this.entries.set(key, entry);
            this.total += entry.bytes;
          }
        } catch {
          // Not ours: start empty.
        }
      },
      () => undefined,
    );
    return this.loaded;
  }

  private async save(): Promise<void> {
    const stored: Stored = {
      version: 1,
      counter: this.counter,
      entries: Object.fromEntries(this.entries),
    };
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), 'utf8');
    await rename(temporary, this.file);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.load();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.used = ++this.counter;
    // The new order is saved with the next change; a read does not rewrite a file.
    return entry.value as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.load();
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8') + key.length;
    const old = this.entries.get(key);
    if (old) this.total -= old.bytes;
    // A value larger than the whole cache is not kept, and does not push everything else out.
    if (bytes > this.maxBytes) {
      this.entries.delete(key);
      await this.save();
      return;
    }
    this.entries.set(key, { value, bytes, used: ++this.counter });
    this.total += bytes;
    while (this.total > this.maxBytes) {
      let oldest: [string, Entry] | null = null;
      for (const pair of this.entries) if (!oldest || pair[1].used < oldest[1].used) oldest = pair;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.total -= oldest[1].bytes;
    }
    await this.save();
  }

  async clear(): Promise<void> {
    await this.load();
    this.entries.clear();
    this.total = 0;
    await rm(this.file, { force: true });
  }

  async stats(): Promise<{ entries: number; bytes: number; maxBytes: number }> {
    await this.load();
    return { entries: this.entries.size, bytes: this.total, maxBytes: this.maxBytes };
  }
}
