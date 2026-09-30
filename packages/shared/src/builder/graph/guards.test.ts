import { describe, expect, it } from 'vitest';
import {
  GuardError,
  MAX_GUARD_DEPTH,
  MAX_GUARD_LENGTH,
  evaluateGuard,
  explainGuard,
  parseGuard,
  type GuardState,
} from './guards.js';

const state: GuardState = {
  focus: 'q-1',
  pending: { buttons: true, count: 4, name: 'pill', empty: null, list: [1, 2, 3] },
  sidecar: { brandDecided: 'organisation', fields: { 'q-1': { decided: { kind: true } } } },
  draft: {
    definition: {
      fields: [
        { id: 'q-1', type: 'single_select', options: [{ value: 'a' }, { value: 'b' }] },
        { id: 'q-2', type: 'short_text' },
      ],
    },
  },
  guess: { pMille: 812 },
  answered: ['choice.buttons'],
};

const holds = (source: string, s: GuardState = state) => evaluateGuard(parseGuard(source), s);

describe('the when language', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['pending.buttons', true],
    ['pending.buttons == true', true],
    ['pending.buttons != true', false],
    ['pending.count == 4', true],
    ['pending.count >= 4 && pending.count < 5', true],
    ["pending.name == 'pill'", true],
    ['pending.empty == null', true],
    ['pending.missing == null', true],
    ['pending.list.length == 3', true],
    ['count(pending.list) == 3', true],
    ['has(focus)', true],
    ['has(pending.empty)', false],
    ['has(sidecar.brandDecided)', true],
    ['decided(kind)', true],
    ['decided(shape)', false],
    ['answered(choice.buttons)', true],
    ['answered(choice.shape)', false],
    ["draft.definition.fields[focus].type == 'single_select'", true],
    ["draft.definition.fields[id=q-2].type == 'short_text'", true],
    ['count(draft.definition.fields[focus].options) == 2', true],
    ['guess.pMille >= 800', true],
    ['!(pending.buttons && !has(focus))', true],
    ['false || pending.count > 3', true],
  ])('%s is %s', (source, expected) => {
    expect(holds(source)).toBe(expected);
  });

  /**
   * Totality: every guard evaluates, against any state at all, without throwing. The states below
   * are the hostile ones — nothing, the wrong types everywhere, a prototype key.
   */
  it.each([
    {},
    { pending: null, sidecar: 'x', draft: 42, focus: null, answered: [] },
    { pending: { buttons: 'true', count: '4', list: 'abc' } },
    { draft: { definition: { fields: 'not a list' } }, focus: 'q-1' },
  ] as GuardState[])('never throws, whatever the state (%#)', (hostile) => {
    for (const source of [
      'pending.buttons',
      'pending.count >= 4',
      'pending.list.length == 3',
      'has(pending.constructor)',
      "draft.definition.fields[focus].type == 'single_select'",
      'decided(kind) || answered(x)',
    ]) {
      expect(() => holds(source, hostile)).not.toThrow();
    }
  });

  it('is strict about types rather than clever', () => {
    const loose: GuardState = { pending: { buttons: 'true', count: '4', list: 'abc' } };
    expect(holds('pending.buttons', loose)).toBe(false);
    expect(holds('pending.count >= 4', loose)).toBe(false);
    expect(holds('pending.list.length == 3', loose)).toBe(false);
    expect(holds('pending.list == pending.list', state)).toBe(false);
  });

  it('reads own properties only', () => {
    expect(holds('has(pending.constructor)')).toBe(false);
    expect(holds('has(pending.toString)')).toBe(false);
  });

  it.each([
    ["pending.name == 'pill", 'an unclosed string'],
    ['pending.count >', 'an expression expected'],
    ['pending.count + 1 == 2', 'an unexpected "+"'],
    ['eval(1)', '"eval" is not a path'],
    ['answered()', 'answered() needs one argument'],
    ['has(nothing.at.all)', 'is not a path'],
    ['window.alert', 'is not a path'],
    ['(true', '")" expected'],
    ['true true', 'after the end'],
  ])('refuses "%s"', (source, message) => {
    expect(() => parseGuard(source)).toThrow(GuardError);
    expect(() => parseGuard(source)).toThrow(message);
  });

  it(`refuses anything longer than ${MAX_GUARD_LENGTH} characters`, () => {
    const long = Array.from({ length: 30 }, () => 'true').join(' && ');
    expect(long.length).toBeGreaterThan(MAX_GUARD_LENGTH);
    expect(() => parseGuard(long)).toThrow('longer than');
  });

  it(`refuses nesting deeper than ${MAX_GUARD_DEPTH}`, () => {
    const deep = `${'('.repeat(MAX_GUARD_DEPTH + 1)}true${')'.repeat(MAX_GUARD_DEPTH + 1)}`;
    expect(() => parseGuard(deep)).toThrow('nested more than');
    const nots = `${'!'.repeat(MAX_GUARD_DEPTH + 1)}true`;
    expect(() => parseGuard(nots)).toThrow('nested more than');
    expect(() =>
      parseGuard(`${'('.repeat(MAX_GUARD_DEPTH)}true${')'.repeat(MAX_GUARD_DEPTH)}`),
    ).not.toThrow();
  });

  it('says which part decided it', () => {
    const source = 'has(focus) && !decided(kind)';
    expect(explainGuard(source, parseGuard(source), state)).toEqual({
      result: false,
      because: '!decided(kind)',
    });
    const either = 'pending.count > 9 || pending.buttons';
    expect(explainGuard(either, parseGuard(either), state)).toEqual({
      result: true,
      because: 'pending.buttons',
    });
  });

  it('parses the same source to the same tree every time', () => {
    const source =
      "has(focus) && (pending.count >= 2 || draft.definition.fields[focus].type != 'x')";
    expect(JSON.stringify(parseGuard(source))).toBe(JSON.stringify(parseGuard(source)));
  });
});
