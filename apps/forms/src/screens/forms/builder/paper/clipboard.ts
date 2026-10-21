/**
 * What a paste holds, as the text `pasteDocument` reads — `IMPORT-PIPELINE.md` §1, Paste: plain
 * text over HTML. Every program that copies puts plain text on the clipboard beside its HTML, with
 * the list numbers and line breaks the reader saw, so that is what is read. Only a paste with no
 * plain text at all is read from its HTML: tags dropped, each block its own line, a list item
 * given the number or bullet its list shows, a table cell a tab.
 */

/** The part of a `DataTransfer` this reads. */
export interface Clipboard {
  getData(type: string): string;
}

export function clipboardText(data: Clipboard): string {
  const plain = data.getData('text/plain');
  if (plain.trim() !== '') return plain;
  const html = data.getData('text/html');
  return html.trim() === '' ? '' : htmlToText(html);
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  laquo: '«',
  raquo: '»',
  auml: 'ä',
  ouml: 'ö',
  aring: 'å',
  Auml: 'Ä',
  Ouml: 'Ö',
  Aring: 'Å',
  aelig: 'æ',
  oslash: 'ø',
  AElig: 'Æ',
  Oslash: 'Ø',
  uuml: 'ü',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
};

function entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[name] ?? whole;
  });
}

const BLOCK =
  /^(p|div|h[1-6]|li|tr|ul|ol|table|blockquote|section|article|header|footer|pre|dt|dd)$/i;

/** HTML as lines of text, in the order a browser draws them. */
export function htmlToText(html: string): string {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '');
  const lists: { ordered: boolean; next: number }[] = [];
  let out = '';
  const breakLine = () => {
    out = out.replace(/[ \t]+$/, '');
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };
  for (const piece of source.split(/(<[^>]*>)/)) {
    if (!piece.startsWith('<')) {
      // HTML's own whitespace is one space; a line break in the source is not one on the page.
      const text = entities(piece.replace(/\s+/g, ' '));
      out += out === '' || out.endsWith('\n') || out.endsWith('\t') ? text.trimStart() : text;
      continue;
    }
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>$/i.exec(piece);
    if (!tag) continue;
    const [, closing, rawName = '', attributes = ''] = tag;
    const name = rawName.toLowerCase();
    if (name === 'br') {
      out = out.replace(/[ \t]+$/, '') + '\n';
    } else if ((name === 'ol' || name === 'ul') && !closing) {
      const start = /\bstart\s*=\s*["']?(\d+)/i.exec(attributes)?.[1];
      lists.push({ ordered: name === 'ol', next: start ? Number(start) : 1 });
      breakLine();
    } else if ((name === 'ol' || name === 'ul') && closing) {
      lists.pop();
      breakLine();
    } else if (name === 'li' && !closing) {
      breakLine();
      const list = lists.at(-1);
      const depth = Math.max(0, lists.length - 1);
      const marker = list?.ordered ? `${list.next++}.` : '•';
      out += `${'  '.repeat(depth)}${marker} `;
    } else if (name === 'td' || name === 'th') {
      if (!closing && !out.endsWith('\n') && out !== '') out = out.replace(/[ \t]+$/, '') + '\t';
    } else if (BLOCK.test(name)) {
      breakLine();
    }
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
