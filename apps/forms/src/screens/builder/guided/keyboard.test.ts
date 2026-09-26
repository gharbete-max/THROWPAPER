import { describe, expect, it } from 'vitest';
import { digitOfCode, keyAction, type KeyContext, type KeyPress } from './keyboard.js';

/**
 * The conversation's keys — `CAVEATS.md` #51 (`browser-reserved-shortcuts`): ⌘/Ctrl+1–9 is the
 * browser's tab switcher, so the browser uses 1–9 and Alt+1–9, and only the desktop app claims
 * ⌘/Ctrl+digit. A text box keeps its own keys: digits type, ⌘Z undoes typing, Backspace deletes.
 */

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});
const browser: KeyContext = { typing: false, boxEmpty: true, desktop: false, answers: 4 };
const typing: KeyContext = { ...browser, typing: true, boxEmpty: false };

describe('picking an answer', () => {
  it.each<[string, KeyPress, KeyContext, ReturnType<typeof keyAction>]>([
    ['a digit, nothing focused', press('2'), browser, { kind: 'pick', index: 1 }],
    ['a digit past the last answer', press('5'), browser, null],
    ['a digit while typing: it types', press('2'), typing, null],
    ['Alt+digit, anywhere', press('3', { altKey: true }), typing, { kind: 'pick', index: 2 }],
    ['Ctrl+digit in a browser: its tabs', press('1', { ctrlKey: true }), browser, null],
    ['⌘+digit in a browser: its tabs', press('1', { metaKey: true }), browser, null],
    [
      '⌘+digit in the desktop app',
      press('1', { metaKey: true }),
      { ...typing, desktop: true },
      { kind: 'pick', index: 0 },
    ],
    ['Shift+digit is a symbol, not a pick', press('2', { shiftKey: true }), browser, null],
  ])('%s', (_name, key, context, expected) => {
    expect(keyAction(key, context)).toEqual(expected);
  });

  it('knows Alt+digit on a Mac by where the key is, not what it types', () => {
    expect(digitOfCode('Digit3')).toBe('3');
    expect(digitOfCode('Numpad7')).toBe('7');
    expect(digitOfCode('Digit0')).toBeNull();
    expect(digitOfCode('KeyA')).toBeNull();
  });
});

describe('going back', () => {
  it.each<[string, KeyPress, KeyContext, ReturnType<typeof keyAction>]>([
    ['Escape', press('Escape'), browser, { kind: 'back' }],
    ['Escape in an empty box', press('Escape'), { ...typing, boxEmpty: true }, { kind: 'back' }],
    ['Escape in a box with text: the box’s', press('Escape'), typing, null],
    ['Ctrl+Z', press('z', { ctrlKey: true }), browser, { kind: 'back' }],
    ['⌘Z', press('z', { metaKey: true }), browser, { kind: 'back' }],
    ['⌘Z while typing undoes the typing', press('z', { metaKey: true }), typing, null],
    ['⌘⇧Z is redo, not back', press('z', { metaKey: true, shiftKey: true }), browser, null],
    ['Backspace, nothing typed', press('Backspace'), browser, { kind: 'back' }],
    [
      'Backspace in an empty box',
      press('Backspace'),
      { ...typing, boxEmpty: true },
      { kind: 'back' },
    ],
    ['Backspace in a box with text deletes', press('Backspace'), typing, null],
  ])('%s', (_name, key, context, expected) => {
    expect(keyAction(key, context)).toEqual(expected);
  });
});

describe('moving and help', () => {
  it('moves between answers with the arrows, and asks for help with ?', () => {
    expect(keyAction(press('ArrowDown'), browser)).toEqual({ kind: 'move', by: 1 });
    expect(keyAction(press('ArrowRight'), browser)).toEqual({ kind: 'move', by: 1 });
    expect(keyAction(press('ArrowUp'), browser)).toEqual({ kind: 'move', by: -1 });
    expect(keyAction(press('ArrowLeft'), browser)).toEqual({ kind: 'move', by: -1 });
    expect(keyAction(press('?'), browser)).toEqual({ kind: 'help' });
  });

  it('leaves the arrows, ? and Enter to a text box and to the browser', () => {
    expect(keyAction(press('ArrowDown'), typing)).toBeNull();
    expect(keyAction(press('?'), typing)).toBeNull();
    expect(keyAction(press('Enter'), browser)).toBeNull();
    expect(keyAction(press('a'), browser)).toBeNull();
  });
});
