import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from './messages.js';

/**
 * The catalogue and the code that uses it, compared in both directions.
 *
 * **A key that is asked for and does not exist renders as the key** — `fieldType.image` sat in the
 * palette looking exactly like that, in front of anybody building a form, for as long as the image
 * field existed. `messages.test.ts` covers the schema-driven families; this covers every plain
 * `t('...')` in the app, which is most of them.
 *
 * **A key that exists and is asked for by nobody** is dead weight that reads as a feature. That is
 * how `builder.removeConfirm` survived: a message about confirming a deletion, implying a
 * confirmation step, while the actual confirmation was an inline one using a different string.
 * Anybody reading the catalogue would have believed there was a modal.
 *
 * Dynamic keys — `t(\`fieldType.\${type}\`)` — cannot be resolved statically, so their prefix is
 * recorded and anything under it is treated as used. That is why this test is paired with the
 * schema-driven ones rather than replacing them.
 */
const SOURCE_ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * `packages/shared` is read too, because a key can be *named* there and rendered here.
 *
 * `validate.ts` emits `code: 'validation.tooShort'` and the public form renders `t(issue.code)`
 * with a variable — nothing static can connect those two through the call. The key's own text
 * appearing in the source that produces it is the connection, and it is a real one.
 */
const SHARED_ROOT = new URL('../../../../packages/shared/src/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const read = (files: string[]) =>
  files
    // The catalogue defines every key, so counting it would make everything look used.
    .filter((file) => !file.endsWith(join('lib', 'messages.ts')))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

/**
 * The `t(...)` scan reads **only the app**.
 *
 * `packages/shared/forms/templates.ts` has a local helper also called `t`, which takes two
 * sentences rather than a key — scanning it collected Swedish prose as if it were message keys.
 * Shared is read for the naming check below and nothing else.
 */
const appSource = read(sourceFiles(SOURCE_ROOT));
const all = `${appSource}\n${read(sourceFiles(SHARED_ROOT))}`;

/** `t('a.b')` and `t("a.b")`. */
const LITERAL = /\bt\(\s*['"]([a-zA-Z0-9._-]+)['"]/g;
/** `t(`a.b.${x}`)` — the fixed part before the first interpolation. */
const TEMPLATE = /\bt\(\s*`([a-zA-Z0-9._-]*)\$\{/g;

const literals = new Set([...appSource.matchAll(LITERAL)].map((match) => match[1]!));
const prefixes = [...appSource.matchAll(TEMPLATE)].map((match) => match[1]!).filter(Boolean);

describe('the message catalogue', () => {
  it('defines every key the app asks for by name', () => {
    // If this finds nothing the regex has drifted and the test proves nothing.
    expect(literals.size).toBeGreaterThan(50);
    const missing = [...literals].filter((key) => !messages[key]);
    expect(missing, `asked for but not defined: ${missing.join(', ')}`).toEqual([]);
  });

  it('defines nothing the app never asks for', () => {
    const unused = Object.keys(messages).filter((key) => {
      if (literals.has(key)) return false;
      if (prefixes.some((prefix) => key.startsWith(prefix))) return false;
      // Named somewhere — a `localisedDefault('field.defaultLabel')`, or a validator's own code.
      return !all.includes(`'${key}'`) && !all.includes(`"${key}"`);
    });
    expect(unused, `defined but never used: ${unused.join(', ')}`).toEqual([]);
  });
});
