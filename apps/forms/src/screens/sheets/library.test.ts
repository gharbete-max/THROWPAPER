import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS, matches, pick, SCRIPT_NAME } from './library.js';

const SCRIPT = readFileSync(
  new URL('../../../../../packs/spreadsheets/Loppa-Sheets.ps1', import.meta.url),
  'utf8',
);

/** The command words the script accepts, read from its own ValidateSet. */
const SCRIPT_COMMANDS = [
  ...(/ValidateSet\(([^)]*)\)\]\s*\[string\]\$Command/.exec(SCRIPT)?.[1] ?? '').matchAll(
    /'([a-z]+)'/g,
  ),
].map((m) => m[1]!);

describe('the Library holds the script to its word', () => {
  it('has an entry for every command the script takes, and none it does not', () => {
    expect(SCRIPT_COMMANDS.length).toBeGreaterThanOrEqual(12);
    expect(COMMANDS.map((c) => c.id).sort()).toEqual([...SCRIPT_COMMANDS].sort());
  });

  it('gives each entry a usage line that runs its own command', () => {
    for (const c of COMMANDS) {
      expect(c.usage.startsWith(`.\\${SCRIPT_NAME} ${c.id} `), c.id).toBe(true);
    }
  });

  it('has English for every title and summary, and no entry twice', () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    for (const c of COMMANDS) {
      expect(c.title.en.length, c.id).toBeGreaterThan(3);
      expect(c.summary.en.length, c.id).toBeGreaterThan(10);
    }
  });
});

describe('pick and matches', () => {
  it('uses Swedish where it exists, English otherwise, and says which', () => {
    const t = { en: 'Hello', sv: 'Hej' };
    expect(pick(t, 'sv')).toEqual({ text: 'Hej', fallback: false });
    expect(pick(t, 'en')).toEqual({ text: 'Hello', fallback: false });
    expect(pick(t, 'de')).toEqual({ text: 'Hello', fallback: true });
    expect(pick({ en: 'Only' }, 'sv')).toEqual({ text: 'Only', fallback: true });
  });

  it('finds by any word of the id, title or summary, in either language', () => {
    const ids = (q: string) => COMMANDS.filter((c) => matches(c, q)).map((c) => c.id);
    expect(ids('')).toHaveLength(COMMANDS.length);
    expect(ids('vlookup')).toEqual(['lookup']);
    expect(ids('dubbletter')).toEqual([]);
    expect(ids('upprepade')).toContain('dupes');
    expect(ids('invoice gaps')).toEqual(['gaps']);
    expect(ids('zzz')).toEqual([]);
  });
});

describe('the sheets screens are their own catcher', () => {
  it('import nothing from the Documents parts or another catcher', () => {
    const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const forbidden = /from '\.\.\/(scan|send|sign|forms|room\/documents|people|earlier|ai)\//;
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))) {
      expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(forbidden);
    }
  });
});
