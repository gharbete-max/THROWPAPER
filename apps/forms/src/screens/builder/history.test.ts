import { describe, expect, it } from 'vitest';
import { Field, emptyDefinition } from '@tp/shared/forms';
import type { FormDefinition } from '@tp/shared/forms';
import { COALESCE_MS, MAX_DEPTH, createHistory } from './history.js';

/**
 * The coalescing rule is the part worth pinning.
 *
 * One undo step per keystroke makes Ctrl+Z useless — twenty presses to get back past a word. One
 * step for a whole session makes it dangerous. The line between them is "did the shape change",
 * which is a judgement no type checker can hold.
 *
 * The clock is injected so these are about the rule rather than about timing.
 */
const withFields = (...ids: string[]): FormDefinition => ({
  ...emptyDefinition,
  fields: ids.map((id) =>
    Field.parse({ id, key: `k_${id}`, type: 'short_text', label: { 'sv-SE': id } }),
  ),
});

const labelled = (text: string): FormDefinition => ({
  ...emptyDefinition,
  fields: [Field.parse({ id: 'a', key: 'k_a', type: 'short_text', label: { 'sv-SE': text } })],
});

/** A clock the test drives by hand. */
function clock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe('builder history', () => {
  it('has nothing to undo before anything happens', () => {
    const history = createHistory();
    expect(history.canUndo()).toBe(false);
    expect(history.undo(withFields('a'))).toBeNull();
    expect(history.redo(withFields('a'))).toBeNull();
  });

  it('takes back a structural change', () => {
    const history = createHistory();
    const before = withFields('a');
    const after = withFields('a', 'b');

    history.record(before, after);
    expect(history.canUndo()).toBe(true);
    expect(history.undo(after)).toEqual(before);
  });

  it('collapses quick property edits into one step', () => {
    const time = clock();
    const history = createHistory(time.now);
    const start = labelled('N');

    // Typing "Name", a keystroke at a time, well inside the window.
    history.record(start, labelled('Na'));
    time.advance(50);
    history.record(labelled('Na'), labelled('Nam'));
    time.advance(50);
    history.record(labelled('Nam'), labelled('Name'));

    // One press goes back past the whole word, not one letter.
    expect(history.undo(labelled('Name'))).toEqual(start);
    expect(history.canUndo()).toBe(false);
  });

  it('starts a new step once the pause is long enough', () => {
    const time = clock();
    const history = createHistory(time.now);

    history.record(labelled('one'), labelled('two'));
    time.advance(COALESCE_MS + 1);
    history.record(labelled('two'), labelled('three'));

    expect(history.undo(labelled('three'))).toEqual(labelled('two'));
    expect(history.canUndo()).toBe(true);
  });

  it('never collapses a structural change into a property edit', () => {
    const time = clock();
    const history = createHistory(time.now);

    // A rename, then a delete a moment later. The delete is its own step however quick it was.
    history.record(labelled('one'), labelled('two'));
    time.advance(10);
    history.record(withFields('a', 'b'), withFields('a'));

    expect(history.undo(withFields('a'))).toEqual(withFields('a', 'b'));
  });

  it('redoes what it just undid', () => {
    const history = createHistory();
    const before = withFields('a');
    const after = withFields('a', 'b');

    history.record(before, after);
    history.undo(after);
    expect(history.canRedo()).toBe(true);
    expect(history.redo(before)).toEqual(after);
  });

  it('drops the redo stack once a different future is chosen', () => {
    const history = createHistory();
    history.record(withFields('a'), withFields('a', 'b'));
    history.undo(withFields('a', 'b'));
    expect(history.canRedo()).toBe(true);

    history.record(withFields('a'), withFields('a', 'c'));
    expect(history.canRedo()).toBe(false);
  });

  it('keeps a bounded number of steps rather than a form’s whole history', () => {
    const time = clock();
    const history = createHistory(time.now);

    for (let step = 0; step < MAX_DEPTH + 10; step += 1) {
      time.advance(COALESCE_MS + 1);
      history.record(withFields(`f${step}`), withFields(`f${step + 1}`));
    }

    let depth = 0;
    while (history.undo(withFields('x')) !== null) depth += 1;
    expect(depth).toBe(MAX_DEPTH);
  });

  it('forgets everything when another form is loaded', () => {
    const history = createHistory();
    history.record(withFields('a'), withFields('a', 'b'));
    history.reset();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
