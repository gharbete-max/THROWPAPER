import { describe, expect, it } from 'vitest';
import { clipboardText, htmlToText } from './clipboard.js';

/**
 * A paste, as the text the importer reads (`IMPORT-PIPELINE.md` §1): plain text over HTML, and
 * HTML only when there is nothing else.
 */

const clip = (types: Record<string, string>) => ({ getData: (type: string) => types[type] ?? '' });

describe('a paste', () => {
  it('is its plain text whenever it has some, verbatim', () => {
    const plain = '1. Namn\n2. Adress';
    expect(clipboardText(clip({ 'text/plain': plain, 'text/html': '<b>other</b>' }))).toBe(plain);
  });

  it('is read from its HTML only when it has no plain text', () => {
    expect(clipboardText(clip({ 'text/html': '<p>Namn</p><p>Adress</p>' }))).toBe('Namn\nAdress');
    expect(clipboardText(clip({}))).toBe('');
  });
});

describe('HTML as lines', () => {
  it('gives a list item the number or bullet its list shows, nested lists indented', () => {
    const html = '<ol start="3"><li>Namn</li><li>Adress<ul><li>Gata</li></ul></li></ol>';
    expect(htmlToText(html)).toBe('3. Namn\n4. Adress\n  • Gata');
  });

  it('breaks at blocks and <br>, puts a tab between cells, and folds the source’s whitespace', () => {
    const html = `<div>Fyll   i
      formuläret</div><table><tr><td>Namn</td><td>____</td></tr></table>Rad<br>två`;
    expect(htmlToText(html)).toBe('Fyll i formuläret\nNamn\t____\nRad\ntvå');
  });

  it('decodes entities, and leaves out scripts, styles and comments', () => {
    const html =
      '<style>p{}</style><!-- note --><p>R&auml;tt &amp; fel&nbsp;&#9744; &#x2611;</p><script>x()</script>';
    expect(htmlToText(html)).toBe('Rätt & fel ☐ ☑');
  });
});
