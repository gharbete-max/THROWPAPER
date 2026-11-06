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

  it('fuzzy: finds the most alike value despite case, accents, punctuation and word order', () => {
    const fa = join(work, 'fa.csv');
    const fb = join(work, 'fb.csv');
    writeFileSync(fa, 'Name\r\nAnna-Maria Berg\r\nJon Lindqvist\r\nZed\r\nÅsa Öberg\r\n');
    writeFileSync(fb, 'Namn\r\n"Berg, Anna Maria"\r\nJohn Lindqvist\r\nPer\r\nasa oberg\r\n');
    const r = run('fuzzy', '-A', fa, '-B', fb, '-Column', 'Name', '-ColumnB', 'Namn');
    expect(lines(r.file('fuzzy-matches.csv'))).toEqual([
      '"Row in A","Value in A","Most alike in B","Row in B","Score","Status"',
      '"2","Anna-Maria Berg","Berg, Anna Maria","2","1","same"',
      '"3","Jon Lindqvist","John Lindqvist","3","0.929","likely"',
      '"4","Zed","Per","4","0.333","weak"',
      '"5","Åsa Öberg","asa oberg","5","1","same"',
    ]);
  });

  it('numbers: compares as numbers in any local style, within a tolerance', () => {
    const na = join(work, 'na.csv');
    const nb = join(work, 'nb.csv');
    writeFileSync(
      na,
      'Id;Amount\r\n1;1 234,50\r\n2;100\r\n3;12,5 kr\r\n4;abc\r\n5;1,234\r\n6;200\r\n',
    );
    writeFileSync(nb, 'Id;Amount\r\n1;1 234,55\r\n2;(5)\r\n3;12,50\r\n4;7\r\n5;1234\r\n6;201\r\n');
    const r = run(
      'numbers',
      '-A',
      na,
      '-B',
      nb,
      '-Key',
      'Id',
      '-Column',
      'Amount',
      '-Tolerance',
      '0.1',
    );
    expect(lines(r.file('number-differences.csv'))).toEqual([
      '"Id";"Column";"A";"B";"B minus A";"Status"',
      '"2";"Amount";"100";"(5)";"-105";"differs"',
      '"4";"Amount";"abc";"7";"";"A is not a number"',
      '"6";"Amount";"200";"201";"1";"differs"',
    ]);
    const pct = run(
      'numbers',
      '-A',
      na,
      '-B',
      nb,
      '-Key',
      'Id',
      '-Column',
      'Amount',
      '-Tolerance',
      '1',
      '-Percent',
    );
    expect(pct.file('number-differences.csv')).not.toContain('"6";');
    const comma = run(
      'numbers',
      '-A',
      na,
      '-B',
      nb,
      '-Key',
      'Id',
      '-Column',
      'Amount',
      '-Decimal',
      ',',
    );
    expect(comma.file('number-differences.csv')).toContain('"5";"Amount";"1,234";"1234"');
  });

  it('lookup: brings columns over by key, fills what is missing, never clashes with a column', () => {
    const main = join(work, 'main.csv');
    const other = join(work, 'other.csv');
    writeFileSync(main, 'Id,Name\r\n1,Anna\r\n2,Bo\r\n3,Cia\r\n');
    writeFileSync(other, 'ID,Name,City\r\n1,Anna B,Malmö\r\n3,Cia C,Lund\r\n3,Dup,X\r\n');
    const r = run(
      'lookup',
      '-File',
      main,
      '-Key',
      'Id',
      '-From',
      other,
      '-Take',
      'Name,City',
      '-Missing',
      '?',
    );
    expect(lines(r.file('lookup-result.csv'))).toEqual([
      '"Id","Name","Name (from other.csv)","City"',
      '"1","Anna","Anna B","Malmö"',
      '"2","Bo","?","?"',
      '"3","Cia","Cia C","Lund"',
    ]);
    expect(r.stdout).toMatch(/repeated keys in -From\s+1/);
  });

  it('gaps: missing numbers per series, keeping the zeros, and numbers used twice', () => {
    const g = join(work, 'g.csv');
    writeFileSync(
      g,
      'No\r\nINV-0001\r\nINV-0002\r\nINV-0005\r\nINV-0005\r\nINV-0009\r\nCR-1\r\nCR-3\r\nx\r\n',
    );
    const r = run('gaps', '-File', g, '-Column', 'No');
    expect(lines(r.file('gaps.csv'))).toEqual([
      '"Series","Missing from","Missing to","How many"',
      '"CR-...","CR-2","CR-2","1"',
      '"INV-...","INV-0003","INV-0004","2"',
      '"INV-...","INV-0006","INV-0008","3"',
    ]);
    expect(lines(r.file('repeated-numbers.csv'))).toEqual(['"Number","Times"', '"INV-0005","2"']);
    expect(r.stdout).toMatch(/cells with no number\s+1/);
  });

  it('pivot: counts, or adds up a number column, by one or two columns, with totals', () => {
    const p = join(work, 'p.csv');
    writeFileSync(p, 'Land;Vara;Belopp\r\nSE;A;1 000,50\r\nSE;B;200\r\nNO;A;300\r\nSE;A;99,25\r\n');
    const sum = run('pivot', '-File', p, '-By', 'Land', '-Cols', 'Vara', '-Sum', 'Belopp');
    expect(lines(sum.file('pivot.csv'))).toEqual([
      '"Land";"A";"B";"Total"',
      '"NO";"300";"";"300"',
      '"SE";"1099,75";"200";"1299,75"',
      '"Total";"1399,75";"200";"1599,75"',
    ]);
    const count = run('pivot', '-File', p, '-By', 'Land');
    expect(lines(count.file('pivot.csv'))).toEqual([
      '"Land";"Total"',
      '"NO";"1"',
      '"SE";"3"',
      '"Total";"4"',
    ]);
  });

  it('mask: tokens stay the same for the same value and salt, other columns are untouched', () => {
    const m = join(work, 'm.csv');
    writeFileSync(
      m,
      'Name,Email,City\r\nAnna,a@x.se,Lund\r\nanna ,b@x.se,Lund\r\n,c@x.se,Malmö\r\n',
    );
    const one = run('mask', '-File', m, '-Column', 'Name,Email', '-Salt', 'k1');
    const rows = lines(one.file('masked.csv')).map((l) => l.split(','));
    expect(rows[1]![0]).toBe(rows[2]![0]); // "Anna" and "anna " are one person
    expect(rows[1]![1]).not.toBe(rows[2]![1]);
    expect(rows[3]![0]).toBe('""'); // an empty cell stays empty
    expect(rows[1]!.at(-1)).toBe('"Lund"');
    expect(one.file('masked.csv')).not.toContain('a@x.se');
    const again = run('mask', '-File', m, '-Column', 'Name,Email', '-Salt', 'k1');
    expect(again.file('masked.csv')).toBe(one.file('masked.csv'));
    const other = run('mask', '-File', m, '-Column', 'Name,Email', '-Salt', 'k2');
    expect(other.file('masked.csv')).not.toBe(one.file('masked.csv'));
    expect(
      lines(run('mask', '-File', m, '-Column', 'Name', '-Mode', 'partial').file('masked.csv'))[1],
    ).toBe('"A***","a@x.se","Lund"');
    expect(
      lines(run('mask', '-File', m, '-Column', 'Email', '-Mode', 'blank').file('masked.csv'))[1],
    ).toBe('"Anna","","Lund"');
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
