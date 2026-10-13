import { describe, expect, it } from 'vitest';
import { findDate, safeName, suggestName, withPdf } from './suggest-name.js';

const today = new Date(2026, 9, 14);

describe('suggesting a file name', () => {
  const table: Array<[string, string, string]> = [
    [
      'english title and ISO date',
      'Minutes of the annual meeting\n2026-03-02\nPresent: ...',
      'Minutes of the annual meeting 2026-03-02',
    ],
    [
      'swedish, dotted date later in text',
      'Protokoll från årsmötet\nDatum: 2.3.2026',
      'Protokoll från årsmötet 2026-03-02',
    ],
    ['german slash date', 'Rechnung Nr. 4\n14/05/2025', 'Rechnung Nr. 4 2025-05-14'],
    ['russian title', 'Протокол собрания\n12.01.2026', 'Протокол собрания 2026-01-12'],
    ['japanese title and date', '議事録\n2026年4月18日', '議事録 2026-04-18'],
    ['chinese title, no date', '会员申请表', '会员申请表'],
    ['icelandic', 'Fundargerð aðalfundar', 'Fundargerð aðalfundar'],
    ['nothing readable falls back to Scan + today', '', 'Scan 2026-10-14'],
    ['only digits falls back, keeping the date found', '12345\n2025-01-31', 'Scan 2025-01-31'],
    ['skips a leading address line', 'info@club.se\nMedlemsansökan', 'Medlemsansökan'],
    ['a title that already holds the date is not doubled', 'Möte 2026-03-02', 'Möte 2026-03-02'],
  ];
  it.each(table)('%s', (_name, text, expected) => {
    expect(suggestName(text, 'Scan', today)).toBe(expected);
  });

  it('uses the translated word for scan', () => {
    expect(suggestName('', 'Skanning', today)).toBe('Skanning 2026-10-14');
  });
});

describe('names that a filesystem accepts', () => {
  it('removes forbidden characters but keeps every script', () => {
    expect(safeName('a/b:c*d?"e<f>g|h')).toBe('a b c d e f g h');
    expect(safeName('Протокол № 5')).toBe('Протокол № 5');
    expect(safeName('議事録/第二回')).toBe('議事録 第二回');
  });
  it('does not leave trailing dots, hidden-file dots or reserved names', () => {
    expect(safeName('report. ')).toBe('report');
    expect(safeName('..hidden')).toBe('hidden');
    expect(safeName('CON')).toBe('_CON');
  });
  it('cuts at 80 characters without splitting a character', () => {
    expect([...safeName('𠮷'.repeat(120))]).toHaveLength(80);
  });
  it('adds .pdf once', () => {
    expect(withPdf('Minutes.pdf')).toBe('Minutes.pdf');
    expect(withPdf('a/b')).toBe('a b.pdf');
    expect(withPdf('///')).toBe('Scan.pdf');
  });
  it('finds only plausible dates', () => {
    expect(findDate('31.13.2026')).toBeNull();
    expect(findDate('version 1.2.3')).toBeNull();
  });
});
