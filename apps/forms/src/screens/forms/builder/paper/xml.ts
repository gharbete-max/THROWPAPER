import { DocxRefused } from './refusal.js';

/**
 * A minimal, non-validating XML reader for WordprocessingML — ADR 0018: no dependency, and
 * nothing in it that an attacker's document can make expensive.
 *
 * It reads elements, attributes, text, CDATA, the five predefined entities and numeric character
 * references, and skips comments and processing instructions. **A document type declaration or an
 * entity declaration anywhere is a refusal**, before any parsing: there is no external entity to
 * fetch and no entity to expand a billion times, because the reader knows no entity but the five.
 * Nesting deeper than the cap is a refusal too.
 *
 * Names come back with their namespace resolved: an element or attribute in WordprocessingML's
 * namespace (transitional or strict) is `w:local`, whatever prefix the file chose; others keep
 * the name as written.
 */

/** `IMPORT-PIPELINE.md`, "Caps": XML nesting. */
export const XML_MAX_DEPTH = 64;

const WORDML = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}
export type XmlNode = XmlElement | string;

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function bad(detail: string): never {
  throw new DocxRefused('unreadable', detail);
}

/** The five entities and character references; any other entity is an error, as in XML. */
function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;&\s]{1,12});/g, (_, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : bad('reference');
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : bad('reference');
    }
    return PREDEFINED[name] ?? bad(`entity &${name};`);
  });
}

const NAME = /^[^\s/>=]+/;
const ATTRIBUTE = /\s*([^\s/>=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;

interface Open {
  readonly raw: string;
  readonly attrs: Record<string, string>;
  readonly children: XmlNode[];
  readonly namespaces: ReadonlyMap<string, string>;
}

/** Parses a document into its root element. Throws `DocxRefused`. */
export function parseXml(text: string, maxDepth = XML_MAX_DEPTH): XmlElement {
  if (/<!\s*(?:doctype|entity)/i.test(text)) throw new DocxRefused('unsafe', 'a DTD or entity');

  const stack: Open[] = [];
  let root: XmlElement | null = null;
  let at = 0;

  const resolve = (raw: string, namespaces: ReadonlyMap<string, string>, attribute: boolean) => {
    const colon = raw.indexOf(':');
    const prefix = colon < 0 ? '' : raw.slice(0, colon);
    const local = colon < 0 ? raw : raw.slice(colon + 1);
    if (prefix === 'xml' || prefix === 'xmlns' || (attribute && prefix === '')) return raw;
    const uri = namespaces.get(prefix);
    return uri && WORDML.has(uri) ? `w:${local}` : raw;
  };

  const close = (element: Open) => {
    const namespaces = element.namespaces;
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(element.attrs)) {
      attrs[resolve(key, namespaces, true)] = value;
    }
    const done: XmlElement = {
      name: resolve(element.raw, namespaces, false),
      attrs,
      children: element.children,
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(done);
    else if (root) bad('two root elements');
    else root = done;
  };

  while (at < text.length) {
    const lt = text.indexOf('<', at);
    const chunk = text.slice(at, lt < 0 ? text.length : lt);
    if (chunk !== '') {
      const parent = stack.at(-1);
      if (parent) parent.children.push(decode(chunk));
      else if (chunk.trim() !== '') bad('text outside the root');
    }
    if (lt < 0) break;
    at = lt;

    if (text.startsWith('<?', at)) {
      const endAt = text.indexOf('?>', at);
      if (endAt < 0) bad('processing instruction');
      at = endAt + 2;
    } else if (text.startsWith('<!--', at)) {
      const endAt = text.indexOf('-->', at);
      if (endAt < 0) bad('comment');
      at = endAt + 3;
    } else if (text.startsWith('<![CDATA[', at)) {
      const endAt = text.indexOf(']]>', at);
      if (endAt < 0) bad('CDATA');
      const parent = stack.at(-1) ?? bad('CDATA outside the root');
      parent.children.push(text.slice(at + 9, endAt));
      at = endAt + 3;
    } else if (text.startsWith('<!', at)) {
      throw new DocxRefused('unsafe', 'a declaration');
    } else if (text.startsWith('</', at)) {
      const endAt = text.indexOf('>', at);
      if (endAt < 0) bad('end tag');
      const name = text.slice(at + 2, endAt).trim();
      const open = stack.pop();
      if (!open || open.raw !== name) bad(`mismatched </${name}>`);
      close(open);
      at = endAt + 1;
    } else {
      const name = NAME.exec(text.slice(at + 1, at + 257))?.[0] ?? bad('tag name');
      let cursor = at + 1 + name.length;
      const attrs: Record<string, string> = {};
      for (;;) {
        ATTRIBUTE.lastIndex = cursor;
        const match = ATTRIBUTE.exec(text);
        if (!match) break;
        attrs[match[1]!] = decode(match[3] ?? match[4] ?? '');
        cursor = ATTRIBUTE.lastIndex;
      }
      while (/\s/.test(text[cursor] ?? '')) cursor += 1;
      const selfClosing = text.startsWith('/>', cursor);
      if (!selfClosing && text[cursor] !== '>') bad(`tag <${name}>`);
      at = cursor + (selfClosing ? 2 : 1);

      const inherited = stack.at(-1)?.namespaces ?? new Map<string, string>();
      let namespaces: ReadonlyMap<string, string> = inherited;
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'xmlns' || key.startsWith('xmlns:')) {
          const scoped = new Map(namespaces);
          scoped.set(key === 'xmlns' ? '' : key.slice(6), value);
          namespaces = scoped;
        }
      }
      const element: Open = { raw: name, attrs, children: [], namespaces };
      if (selfClosing) {
        close(element);
      } else {
        if (stack.length >= maxDepth) throw new DocxRefused('too-complex', 'nesting');
        stack.push(element);
      }
    }
  }
  if (stack.length > 0) bad('unclosed element');
  return root ?? bad('no root element');
}

/** The element's children that are elements named `name`. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => typeof child !== 'string' && child.name === name,
  );
}

/** The first child element named `name`, or undefined. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find(
    (node): node is XmlElement => typeof node !== 'string' && node.name === name,
  );
}

/** The first element at the end of a path of child names, or undefined. */
export function at(element: XmlElement | undefined, ...path: string[]): XmlElement | undefined {
  return path.reduce<XmlElement | undefined>((node, name) => child(node, name), element);
}
