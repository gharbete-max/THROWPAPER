import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The spreadsheet pack (`packs/spreadsheets/Loppa-Sheets.ps1`) run for real, because a script
 * nobody has run is a claim. Needs PowerShell (`pwsh`, or LOPPA_PWSH): GitHub's runners have it;
 * where it is missing these tests are SKIPPED, and vitest says so.
 */
const PWSH = process.env['LOPPA_PWSH'] ?? 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0;
const SCRIPT = new URL('../packs/spreadsheets/Loppa-Sheets.ps1', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const work = mkdtempSync(join(tmpdir(), 'loppa-sheets-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Windows-1252 for the letters used here is the same bytes as Latin-1. */
const cp1252 = (text: string) => Buffer.from(text, 'latin1');
const A = join(work, 'a.csv');
const B = join(work, 'b.csv');
writeFileSync(
  A,
  cp1252(
    'Id;Namn;E-post;Ort\r\n1;Åsa Öberg;asa@x.se;Malmö\r\n2;Bo  Ek ;bo@x.se;Lund\r\n3;Cia;cia@x.se;Lund\r\n3;Cia 2;cia@x.se;Lund\r\n',
  ),
);
writeFileSync(
  B,
  'ID,Namn,E post,Stad\r\n1,Åsa Öberg,asa@x.se,Malmö\r\n2,Bo Ek,bo@y.se,Lund\r\n4,Dan,dan@x.se,Umeå\r\n',
);

let runs = 0;
function run(...args: string[]) {
  runs += 1;
  const out = join(work, `out${runs}`);
  const r = spawnSync(PWSH, ['-NoProfile', '-File', SCRIPT, ...args, '-Out', out], {
    encoding: 'utf8',
  });
  const file = (name: string) => readFileSync(join(out, name), 'utf8').replace(/^\uFEFF/, '');
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, file };
}
const lines = (text: string) => text.trim().split(/\r?\n/);

describe.skipIf(!hasPwsh)('Loppa-Sheets.ps1', () => {
  it('compare: reads a Swedish ; file in Windows-1252 and says what is only in one, and what changed', () => {
    const r = run('compare', '-A', A, '-B', B, '-Key', 'Id');
    expect(r.status).toBe(0);
    expect(lines(r.file('only-in-A.csv'))).toEqual([
      '"Id";"Namn";"E-post";"Ort"',
      '"3";"Cia";"cia@x.se";"Lund"',
    ]);
    expect(r.file('only-in-B.csv')).toContain('"4","Dan","dan@x.se","Umeå"');
    expect(lines(r.file('changed-cells.csv'))).toEqual([
      '"Id";"Column";"A";"B"',
      '"2";"Namn";"Bo  Ek ";"Bo Ek"',
      '"2";"E-post";"bo@x.se";"bo@y.se"',
    ]);
    expect(r.stdout).toMatch(/identical\s+1/);
  });

  it('compare: -Trim and -IgnoreCase make "Bo  Ek " and "bo ek" not a change', () => {
    const r = run('compare', '-A', A, '-B', B, '-Key', 'Id', '-Trim');
    expect(r.file('changed-cells.csv')).toContain('"Namn"');
    const q = run('compare', '-A', A, '-B', B, '-Key', 'Id', '-IgnoreCase');
    expect(q.status).toBe(0);
  });

  it('match: pairs columns by name ignoring case, spaces, punctuation and accents', () => {
    const r = run('match', '-A', A, '-B', B);
    expect(lines(r.file('column-match.csv'))).toEqual([
      '"Column in A";"Column in B";"Status"',
      '"Id";"ID";"same name"',
      '"Namn";"Namn";"same name"',
      '"E-post";"E post";"same name"',
      '"Ort";"";"only in A"',
      '"";"Stad";"only in B"',
    ]);
  });

  it('dupes: lists every row of a repeated key and keeps the first of each', () => {
    const r = run('dupes', '-File', A, '-Key', 'E-post');
    expect(lines(r.file('duplicates.csv')).length).toBe(3);
    expect(lines(r.file('first-of-each.csv')).length).toBe(4);
  });

  it('merge: lines columns up by name and adds where each row came from', () => {
    const r = run('merge', '-File', `${A},${B}`);
    const rows = lines(r.file('merged.csv'));
    expect(rows[0]).toBe('"Id";"Namn";"E-post";"Ort";"Stad";"_source"');
    expect(rows.length).toBe(8);
    expect(rows.at(-1)).toBe('"4";"Dan";"dan@x.se";"";"Umeå";"b.csv"');
  });

  it('split: one file per value, named safely', () => {
    const r = run('split', '-File', A, '-By', 'Ort');
    expect(readdirSync(r.out).sort()).toEqual(['Lund.csv', 'Malmö.csv']);
  });

  it('clean: trims, collapses spaces, turns non-breaking spaces into spaces, drops empty rows', () => {
    const f = join(work, 'dirty.csv');
    writeFileSync(f, 'a,b\r\n" x  y ", z\r\n , \r\n');
    const r = run('clean', '-File', f);
    expect(lines(r.file('cleaned.csv'))).toEqual(['"a","b"', '"x y","z"']);
  });

  it('never touches an input and never writes into a folder that already has files', () => {
    const before = readFileSync(A);
    const r = run('clean', '-File', A);
    expect(readFileSync(A).equals(before)).toBe(true);
    const again = spawnSync(
      PWSH,
      ['-NoProfile', '-File', SCRIPT, 'clean', '-File', A, '-Out', r.out],
      {
        encoding: 'utf8',
      },
    );
    expect(again.status).not.toBe(0);
    expect(again.stderr + again.stdout).toMatch(/already holds files/);
  });

  it('says plainly what is wrong: a missing column, a repeated header', () => {
    const missing = run('compare', '-A', A, '-B', B, '-Key', 'Nope');
    expect(missing.status).not.toBe(0);
    expect(missing.stderr + missing.stdout).toMatch(/no column 'Nope'/);
    const twice = join(work, 'twice.csv');
    writeFileSync(twice, 'Id,id\r\n1,2\r\n');
    const r = run('clean', '-File', twice);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/twice/);
  });
});
