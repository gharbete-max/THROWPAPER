import { describe, expect, it } from 'vitest';
import { emptyDefinition } from '../forms/definition.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import {
  base32,
  fingerprint,
  fnv1a64,
  normaliseForFingerprint,
  stableFieldId,
  uniqueKey,
} from './ids.js';
import { answer, begin, edit, type Conversation } from './machine.js';

/**
 * `CAVEATS.md` #39 (`stable-ids`) and #49 (`id-reuse-after-delete`): a question's id is made once
 * and never changes, and an id the form has used is never given to another question.
 */

describe('the hash', () => {
  it('is FNV-1a 64 over UTF-8, as its reference vectors say', () => {
    expect(fnv1a64('').toString(16)).toBe('cbf29ce484222325');
    expect(fnv1a64('a').toString(16)).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar').toString(16)).toBe('85944171f73967e8');
  });

  it('writes 64 bits as 13 base-32 digits with nothing to misread', () => {
    expect(base32(0n)).toBe('0000000000000');
    expect(base32(0xffffffffffffffffn)).toBe('fzzzzzzzzzzzz');
    expect(base32(fnv1a64('foobar'))).toMatch(/^[0-9a-hjkmnp-tv-z]{13}$/);
  });

  it('fingerprints what a question is, not how it was typed', () => {
    expect(normaliseForFingerprint('  Ｅ-post\n\tadress ')).toBe('e-post adress');
    expect(fingerprint('Namn', 1, '')).toBe(fingerprint(' NAMN ', 1, ''));
    expect(fingerprint('Namn', 1, '')).not.toBe(fingerprint('Namn', 2, ''));
    expect(fingerprint('Namn', 1, '')).not.toBe(fingerprint('Namn', 1, 'q-section'));
  });
});

describe('ids and keys', () => {
  it('gives the same id for the same fingerprint, and the next suffix when it was used', () => {
    const print = fingerprint('name', 1, '');
    const id = stableFieldId(print, new Set());
    expect(id).toMatch(/^q-[0-9a-z]{13}$/);
    expect(stableFieldId(print, new Set())).toBe(id);
    expect(stableFieldId(print, new Set([id]))).toBe(`${id}-2`);
    expect(stableFieldId(print, new Set([id, `${id}-2`]))).toBe(`${id}-3`);
  });

  it('keeps keys unique the way the classic editor does', () => {
    expect(uniqueKey('email', new Set())).toBe('email');
    expect(uniqueKey('email', new Set(['email']))).toBe('email_2');
    expect(uniqueKey('email_2', new Set(['email', 'email_2']))).toBe('email_3');
    expect(uniqueKey('x'.repeat(80), new Set())).toHaveLength(60);
  });
});

describe('a question keeps its id', () => {
  const locale = 'sv-SE';
  const start = (): Conversation => {
    let c = begin(BUILDER_GRAPH, { definition: emptyDefinition, title: {} });
    c = answer(BUILDER_GRAPH, c, { kind: 'option', optionId: 'collect' }, { locale });
    c = answer(BUILDER_GRAPH, c, { kind: 'option', optionId: 'later' }, { locale });
    return answer(BUILDER_GRAPH, c, { kind: 'text', value: 'Allergier' }, { locale });
  };
  const ids = (c: Conversation) => c.state.draft.definition.fields.map((field) => field.id);

  it('is the same on every machine: the same answers give the same ids', () => {
    expect(ids(start())).toEqual(ids(start()));
  });

  it('through a rename, a change of type and a reorder', () => {
    const c = start();
    const [first, second] = ids(c);
    let d = edit(
      c,
      [
        {
          op: 'set',
          path: `draft.definition.fields[id=${second}].label`,
          value: { 'sv-SE': 'Mat' },
        },
      ],
      { locale },
    );
    d = edit(
      d,
      [{ op: 'set', path: `draft.definition.fields[id=${second}].type`, value: 'long_text' }],
      { locale },
    );
    d = edit(d, [{ op: 'reorder', path: 'draft.definition.fields', id: second!, after: null }], {
      locale,
    });
    expect(ids(d)).toEqual([second, first]);
  });

  it('is never given to a new question after it was deleted, even an identical one in its place', () => {
    const c = start();
    const [, second] = ids(c);
    let d = edit(c, [{ op: 'remove', path: `draft.definition.fields[id=${second}]` }], { locale });
    d = answer(BUILDER_GRAPH, d, { kind: 'jump', to: 'text.label' }, { locale });
    d = answer(BUILDER_GRAPH, d, { kind: 'text', value: 'Allergier' }, { locale });
    const [, third] = ids(d);
    expect(third).toBe(`${second}-2`);
    expect(d.state.sidecar.retiredIds).toEqual([...ids(c), third]);
  });

  it('retires the ids a form already had when a conversation starts on it', () => {
    const made = start().state.draft.definition;
    const again = begin(BUILDER_GRAPH, { definition: made, title: {} });
    expect(again.state.sidecar.retiredIds).toEqual(made.fields.map((field) => field.id));
  });
});
