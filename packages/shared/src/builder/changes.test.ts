import { describe, expect, it } from 'vitest';
import { applyAll, applyChange, get, inverseOf, jsonEqual, type Change } from './changes.js';
import { MachineError } from './state.js';

/**
 * Every kind of change, and its inverse: applying a change and then its inverse gives back what
 * was there. The machine's undo is built on nothing else.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const root = () =>
  deepFreeze({
    draft: {
      fields: [
        { id: 'a', label: { 'sv-SE': 'A' }, options: [{ value: 'x' }, { value: 'y' }] },
        { id: 'b', label: {} },
        { id: 'c', label: {} },
      ],
    },
    pending: { buttons: true },
  });

const cases: [string, Change][] = [
  [
    'set a value',
    { op: 'set', at: ['draft', 'fields', { id: 'b' }, 'label'], value: { 'sv-SE': 'B' } },
  ],
  [
    'set a new key, making the object on the way',
    { op: 'set', at: ['draft', 'fields', { id: 'c' }, 'style', 'shape'], value: 'pill' },
  ],
  ['unset a key', { op: 'unset', at: ['pending', 'buttons'] }],
  ['insert first', { op: 'insert', at: ['draft', 'fields'], value: { id: 'z' }, after: null }],
  [
    'insert after',
    { op: 'insert', at: ['draft', 'fields'], value: { id: 'z' }, after: { id: 'b' } },
  ],
  [
    'insert an option by value',
    {
      op: 'insert',
      at: ['draft', 'fields', { id: 'a' }, 'options'],
      value: { value: 'w' },
      after: { value: 'x' },
    },
  ],
  ['remove the first', { op: 'remove', at: ['draft', 'fields', { id: 'a' }] }],
  ['remove from the middle', { op: 'remove', at: ['draft', 'fields', { id: 'b' }] }],
  [
    'remove an option',
    { op: 'remove', at: ['draft', 'fields', { id: 'a' }, 'options', { value: 'y' }] },
  ],
  ['reorder to the front', { op: 'reorder', at: ['draft', 'fields', { id: 'c' }], after: null }],
  [
    'reorder to the end',
    { op: 'reorder', at: ['draft', 'fields', { id: 'a' }], after: { id: 'c' } },
  ],
];

describe('a change and its inverse', () => {
  it.each(cases)('%s, then undo it', (_name, change) => {
    const before = root();
    const undo = inverseOf(before, change);
    const after = applyChange(before, change);
    expect(jsonEqual(after, before)).toBe(false);
    expect(undo).not.toBeNull();
    expect(jsonEqual(applyChange(after, undo!), before)).toBe(true);
  });

  it('unsets a key that is not there as nothing at all, with nothing to undo', () => {
    const change: Change = { op: 'unset', at: ['pending', 'absent'] };
    expect(inverseOf(root(), change)).toBeNull();
    expect(applyChange(root(), change)).toEqual(root());
  });

  it('never writes to what it is given (the input is frozen here)', () => {
    const before = root();
    const after = applyAll(before, cases.map(([, change]) => change).slice(0, 3));
    expect(get(after, ['draft', 'fields', { id: 'b' }, 'label'])).toEqual({ 'sv-SE': 'B' });
    expect(get(before, ['draft', 'fields', { id: 'b' }, 'label'])).toEqual({});
  });

  it.each<[string, Change]>([
    ['a missing element', { op: 'remove', at: ['draft', 'fields', { id: 'nope' }] }],
    [
      'a path through a list as if it were an object',
      { op: 'set', at: ['draft', 'fields', 'x'], value: 1 },
    ],
    [
      'inserting after nothing that exists',
      { op: 'insert', at: ['draft', 'fields'], value: { id: 'z' }, after: { id: 'nope' } },
    ],
  ])('refuses %s', (_name, change) => {
    expect(() => applyChange(root(), change)).toThrow(MachineError);
  });
});

describe('jsonEqual', () => {
  it('ignores key order and keeps fractions', () => {
    expect(jsonEqual({ a: 1, b: [0.25, { c: null }] }, { b: [0.25, { c: null }], a: 1 })).toBe(
      true,
    );
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});
