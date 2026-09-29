import { describe, expect, it } from 'vitest';
import { reviewKey, type ReviewKeyPress } from './keys.js';

/** Every key of `IMPORT-PIPELINE.md` §8, and the ones the screen must leave alone. */

const press = (key: string, more: Partial<ReviewKeyPress> = {}): ReviewKeyPress => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...more,
});
const free = { typing: false, onControl: false };

describe('the review screen’s keys', () => {
  it('move, choose a chip, merge, split, text, question, accept and undo', () => {
    expect(reviewKey(press('ArrowDown'), free)).toEqual({ kind: 'move', by: 1 });
    expect(reviewKey(press('ArrowUp'), free)).toEqual({ kind: 'move', by: -1 });
    expect(['1', '2', '3'].map((key) => reviewKey(press(key), free))).toEqual([
      { kind: 'chip', index: 0 },
      { kind: 'chip', index: 1 },
      { kind: 'chip', index: 2 },
    ]);
    expect(['m', 'S', 't', 'Q'].map((key) => reviewKey(press(key), free)?.kind)).toEqual([
      'merge',
      'split',
      'text',
      'question',
    ]);
    expect(reviewKey(press('Enter'), free)).toEqual({ kind: 'accept' });
    expect(reviewKey(press('z', { ctrlKey: true }), free)).toEqual({ kind: 'undo' });
    expect(reviewKey(press('z', { metaKey: true }), free)).toEqual({ kind: 'undo' });
  });

  it('leaves the browser its own: text boxes, modified letters, digits past three, Enter on a button', () => {
    expect(reviewKey(press('m'), { typing: true, onControl: false })).toBeNull();
    expect(reviewKey(press('z', { ctrlKey: true }), { typing: true, onControl: false })).toBeNull();
    expect(reviewKey(press('s', { ctrlKey: true }), free)).toBeNull();
    expect(reviewKey(press('t', { altKey: true }), free)).toBeNull();
    expect(reviewKey(press('M', { shiftKey: true }), free)).toBeNull();
    expect(reviewKey(press('4'), free)).toBeNull();
    expect(reviewKey(press('Enter'), { typing: false, onControl: true })).toBeNull();
    expect(reviewKey(press('z', { ctrlKey: true, shiftKey: true }), free)).toBeNull();
  });
});
