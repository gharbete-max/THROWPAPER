import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { begin, BUILDER_GRAPH, importQuestions } from '@tp/shared/builder';
import { definitionProblems, emptyDefinition } from '@tp/shared/forms';
import { parseLayoutDocument, readLayout } from '@tp/shared/import';
import { readDocument } from '../paper/pipeline.js';
import type { Reading } from '../paper/reading.js';
import { fieldsOf, fieldTypeOf, labelKey } from './fields.js';
import {
  act,
  counts,
  itemOfLine,
  readyToUse,
  refusal,
  replay,
  startReview,
  undo,
  type ReviewItem,
} from './review.js';

/**
 * The review screen's model and what "Use these questions" adds — `IMPORT-PIPELINE.md` §8 — on
 * readings made by the stages themselves, as the worker makes them. Acceptance S4 and S5
 * (`PREDICTIVE-BUILDER.md`) are held here at the model and in `e2e/review.spec.ts` on screen.
 */

const paste = (text: string): Reading => readDocument({ kind: 'paste', text });
const fixture = (name: string): Reading => {
  const path = new URL(`../../../../../../fixtures/numbering/${name}.json`, import.meta.url);
  const layout = parseLayoutDocument(JSON.parse(readFileSync(path, 'utf8')).input);
  return { ...readLayout(layout), layout };
};
const context = { definition: emptyDefinition, retired: [], locale: 'sv-SE' };
const fieldsFrom = (items: readonly ReviewItem[]) => fieldsOf(items, context);

describe('acceptance S4: two numbered questions pasted', () => {
  const review = startReview(paste('1. Question one\n2. Question two'));

  it('are two questions, with their words, typed as a guess to check, with chips', () => {
    expect(review.items.map((i) => [i.kind, i.text, i.type, i.bucket])).toEqual([
      ['question', 'Question one', 'short_text', 'flag'],
      ['question', 'Question two', 'short_text', 'flag'],
    ]);
    expect(review.items[0]!.alternatives).toEqual(['short_text', 'long_text', 'number']);
    expect(counts(review.items)).toEqual({ questions: 2, needEye: 0, check: 2, texts: 0 });
    expect(readyToUse(review.items)).toBe(true);
  });

  it('become two short-text questions in the form, in order, labels verbatim', () => {
    const fields = fieldsFrom(review.items);
    expect(fields.map((f) => [f.type, 'label' in f ? f.label : null])).toEqual([
      ['short_text', { 'sv-SE': 'Question one' }],
      ['short_text', { 'sv-SE': 'Question two' }],
    ]);
  });
});

describe('acceptance S5: the dotted-number trap', () => {
  it('"12.1" inside a question starts nothing, splits nothing, and stays in the label', () => {
    const { items } = startReview(paste('1. A thing 12.1 mentions blabla\n2. Something else'));
    expect(items.map((i) => i.text)).toEqual(['A thing 12.1 mentions blabla', 'Something else']);
    expect(fieldsFrom(items)).toHaveLength(2);
  });
});

describe('the items a reading comes to', () => {
  it('keeps the document’s order: headings, text to read and questions', () => {
    const { items } = startReview(paste('PERSONUPPGIFTER\n\nNamn: ____\nE-post: ____\n\nTack!'));
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ['heading', 'PERSONUPPGIFTER'],
      ['question', 'Namn'],
      ['question', 'E-post'],
      ['text', 'Tack!'],
    ]);
    expect(counts(items)).toMatchObject({ questions: 2, texts: 2 });
  });

  it('offers no chips on what it is sure of, and links every line to its item both ways', () => {
    const review = startReview(paste('Namn: ____\nE-post: ____'));
    const email = review.items.find((i) => i.text === 'E-post')!;
    expect(email.bucket).toBe('auto');
    expect(email.alternatives).toEqual([]);
    for (const item of review.items) {
      for (const line of item.lineIds) expect(itemOfLine(review.items, line)?.id).toBe(item.id);
    }
  });

  it('reads a grid with its rows and columns, and a table with its columns and rows', () => {
    const grid = startReview(fixture('checkbox-grid')).items.find((i) => i.kind === 'grid')!;
    expect(grid.rows.length).toBeGreaterThan(1);
    expect(grid.columns.length).toBeGreaterThan(1);
    const table = startReview(fixture('table-rows')).items[0]!;
    expect(table).toMatchObject({
      kind: 'table',
      text: 'Deltagare',
      columns: ['Namn', 'Telefon', 'E-post'],
      rowCount: 3,
    });
  });
});

describe('what the person does', () => {
  const start = () => startReview(paste('1. Question one\n2. Question two\nThanks for your help'));

  it('a chip picks the type, and only a chip', () => {
    const review = start();
    const id = review.items[0]!.id;
    const picked = act(review, { kind: 'pick', itemId: id, type: 'long_text' });
    expect(picked.items[0]).toMatchObject({ type: 'long_text', decided: true });
    expect(refusal(review, { kind: 'pick', itemId: id, type: 'email' })).toBe('not-a-chip');
    expect(act(review, { kind: 'pick', itemId: id, type: 'email' })).toBe(review);
  });

  it('accepts, and a settled item is no longer counted as one to check', () => {
    const review = start();
    const accepted = act(review, { kind: 'accept', itemId: review.items[0]!.id });
    expect(counts(accepted.items).check).toBe(counts(review.items).check - 1);
    expect(refusal(accepted, { kind: 'accept', itemId: review.items[0]!.id })).toBe('already');
  });

  it('"this is just text" keeps every word; "make this a question" makes one to check', () => {
    const review = start();
    const text = act(review, { kind: 'text', itemId: review.items[1]!.id });
    expect(text.items[1]).toMatchObject({ kind: 'text', text: 'Question two', type: null });
    const last = review.items.at(-1)!;
    expect(last.kind).toBe('text');
    const asked = act(review, { kind: 'question', itemId: last.id });
    expect(asked.items.at(-1)).toMatchObject({
      kind: 'question',
      text: 'Thanks for your help',
      type: 'short_text',
      alternatives: ['short_text', 'long_text', 'number'],
    });
  });

  it('merges a question into the one before it, and a note into its question', () => {
    const review = start();
    const [one, two, thanks] = review.items;
    const merged = act(review, { kind: 'merge', itemId: two!.id });
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0]).toMatchObject({
      text: 'Question one Question two',
      lineIds: [...one!.lineIds, ...two!.lineIds],
    });
    const noted = act(review, { kind: 'merge', itemId: thanks!.id });
    expect(noted.items[1]).toMatchObject({
      text: 'Question two',
      details: ['Thanks for your help'],
    });
    expect(refusal(review, { kind: 'merge', itemId: one!.id })).toBe('first');
  });

  it('splits an item of several lines at a line, with each part’s own words', () => {
    const review = act(start(), { kind: 'merge', itemId: start().items[1]!.id });
    const both = review.items[0]!;
    const split = act(review, { kind: 'split', itemId: both.id, at: 1 });
    expect(split.items.slice(0, 2).map((i) => i.text)).toEqual(['Question one', 'Question two']);
    expect(refusal(start(), { kind: 'split', itemId: start().items[0]!.id, at: 1 })).toBe(
      'one-line',
    );
  });

  it('undoes the last action, exactly: the items are always the actions replayed', () => {
    let review = start();
    const before = review.items;
    review = act(review, { kind: 'merge', itemId: review.items[1]!.id });
    review = act(review, { kind: 'accept', itemId: review.items[0]!.id });
    expect(replay(review, review.actions).items).toEqual(review.items);
    expect(undo(undo(review)).items).toEqual(before);
    expect(undo(startReview(paste('1. Namn')))).toEqual(startReview(paste('1. Namn')));
  });
});

describe('what needs the person’s eye', () => {
  const unsure: ReviewItem = {
    id: 'x',
    kind: 'question',
    lineIds: ['p1-l1'],
    text: 'Adr3ss',
    options: [],
    details: [],
    rows: [],
    columns: [],
    rowCount: 0,
    type: 'short_text',
    alternatives: ['short_text', 'long_text', 'address'],
    required: false,
    bucket: 'review',
    decided: false,
    field: false,
  };

  it('holds "Use these questions" until each is settled — never a silent guess', () => {
    expect(counts([unsure]).needEye).toBe(1);
    expect(readyToUse([unsure])).toBe(false);
    expect(readyToUse([{ ...unsure, decided: true }])).toBe(true);
    expect(readyToUse([])).toBe(false);
  });
});

describe('the questions they become', () => {
  it('maps each type the reading has to a field the form has, keeping every word', () => {
    expect(
      (['money', 'address', 'personnummer', 'orgnr', 'consent', 'grid', 'email'] as const).map(
        fieldTypeOf,
      ),
    ).toEqual([
      'number',
      'long_text',
      'short_text',
      'short_text',
      'yes_no',
      'single_select',
      'email',
    ]);
    const fields = fieldsFrom(
      startReview(
        paste(
          'PERSONUPPGIFTER\n\nNamn *: ____\nVilken dag? ☐ Lördag ☐ Söndag\nBelopp: ____\n\nTack!',
        ),
      ).items,
    );
    expect(fields.map((f) => f.type)).toEqual([
      'section_break',
      'short_text',
      'single_select',
      'number',
      'rich_text',
    ]);
    expect(fields[1]).toMatchObject({ label: { 'sv-SE': 'Namn *' }, required: true });
    expect(fields[2]).toMatchObject({
      options: [{ label: { 'sv-SE': 'Lördag' } }, { label: { 'sv-SE': 'Söndag' } }],
    });
    expect(fields[3]).toMatchObject({ decimals: 2 });
    expect(fields[4]).toMatchObject({ content: { 'sv-SE': 'Tack!' } });
  });

  it('a grid: one single choice per row under its label; one column: a list to tick', () => {
    const items = startReview(fixture('checkbox-grid')).items;
    const grid = items.find((i) => i.kind === 'grid')!;
    const fields = fieldsFrom([grid]);
    const rows = fields.filter((f) => f.type === 'single_select');
    expect(rows.map((f) => f.label['sv-SE'])).toEqual(grid.rows);
    for (const row of rows) {
      expect('options' in row ? row.options.map((o) => o.label['sv-SE']) : []).toEqual(
        grid.columns,
      );
    }
    const one = fieldsFrom([{ ...grid, columns: ['Ja'] }]);
    expect(one.map((f) => f.type)).toEqual(['multi_select']);
  });

  it('a table: a repeating group, a question per column, as many entries as it printed rows', () => {
    const [group] = fieldsFrom(startReview(fixture('table-rows')).items);
    expect(group).toMatchObject({
      type: 'repeating_group',
      label: { 'sv-SE': 'Deltagare' },
      max: 3,
    });
    expect(
      group && 'fields' in group
        ? group.fields.map((f) => ('label' in f ? f.label['sv-SE'] : null))
        : [],
    ).toEqual(['Namn', 'Telefon', 'E-post']);
  });

  it('keys from labels, accents and all; ids the same every time and never one used before', () => {
    expect(labelKey('Födelsedatum', 'x')).toBe('fodelsedatum');
    expect(labelKey('E-post', 'x')).toBe('e_post');
    expect(labelKey('Første dag', 'x')).toBe('forste_dag');
    expect(labelKey('お名前', 'short_text')).toBe('short_text');
    const items = startReview(paste('1. Namn\n2. Namn')).items;
    const once = fieldsFrom(items);
    expect(fieldsFrom(items)).toEqual(once);
    expect(once.map((f) => f.key)).toEqual(['namn', 'namn_2']);
    const again = fieldsOf(items, { ...context, retired: once.map((f) => f.id) });
    expect(again.some((f) => once.some((o) => o.id === f.id))).toBe(false);
  });

  it('go into the form through the machine, as one step, and the form can be published', () => {
    const items = startReview(paste('PERSONUPPGIFTER\n\n1. Namn: ____\n2. E-post: ____')).items;
    const c = begin(BUILDER_GRAPH, {
      definition: emptyDefinition,
      title: {},
      pending: { brandKitExists: false, canChangeBrand: true },
    });
    const after = importQuestions(c, fieldsFrom(items));
    expect(after.state.draft.definition.fields.map((f) => f.type)).toEqual([
      'section_break',
      'short_text',
      'email',
    ]);
    expect(definitionProblems(after.state.draft.definition)).toEqual([]);
  });
});
