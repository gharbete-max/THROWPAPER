import {
  fingerprint,
  labelledOptions,
  resizeOptions,
  stableFieldId,
  uniqueKey,
  DEFAULT_OPTION_COUNT,
  type Slot,
} from '@tp/shared/builder';
import {
  EntryField,
  Field,
  MAX_GROUP_ENTRIES,
  type FieldType,
  type FormDefinition,
} from '@tp/shared/forms';
import type { Kind } from '@tp/shared/import';
import { asks, type ReviewItem } from './review.js';

/**
 * The review's items as the questions "Use these questions" adds — `IMPORT-PIPELINE.md` §8.
 *
 * Every word is the document's, verbatim, in the form's language: a label, its options, the notes
 * under it (as help text), a heading, a paragraph. A type the form has no field for becomes the
 * nearest one that keeps the answer whole:
 *
 * | Read as | Becomes |
 * | --- | --- |
 * | money | a number with two decimals |
 * | address | long text (an address is several lines) |
 * | personnummer, organisation number | short text; the number's own check is S12's |
 * | consent | yes/no, as the wizard asks for a consent — its text kept byte for byte (#28) |
 * | grid | a choice per row under a heading of the grid's label: one of its columns ("Grid"), or any number ("Multiple choice"); a grid of one column is a list to tick, its column's header as help (`CAVEATS.md`, known unknowns: the grid fallback) |
 * | table | a repeating group, a question per column, as many entries as it printed rows |
 *
 * Notes an item carries — printed under a question, or kept by a merge — are its help text; a
 * grid's are its heading's, or text to read above its rows when it has no heading. So are a
 * question's options when it is given a type that has none (short text, say): the person sees them
 * in the preview, and the editor has them to delete. A yes/no's printed pair is the type itself.
 * | heading | a section break |
 * | text to read | text, one paragraph per line it was read as |
 *
 * Ids are stable fingerprints of the document's text and place (`builder/ids.ts`): the same
 * document gives the same ids on every machine, and an id the form ever used is never given again.
 */

/** A key from a label: its letters without their accents, lower case, words joined by `_`. */
export function labelKey(label: string, fallback: string): string {
  const base = label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[đĐð]/g, 'd')
    .replace(/[þÞ]/g, 'th')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return /^[a-z]/.test(base) ? base : fallback;
}

/** The field type a question read as `kind` becomes. */
export function fieldTypeOf(kind: Kind): FieldType {
  switch (kind) {
    case 'money':
      return 'number';
    case 'address':
      return 'long_text';
    case 'personnummer':
    case 'orgnr':
      return 'short_text';
    case 'consent':
      return 'yes_no';
    case 'grid':
      return 'single_select';
    default:
      return kind;
  }
}

interface Taken {
  readonly ids: Set<string>;
  readonly keys: Set<string>;
}

/** What "Use these questions" adds: the questions, and what the document decided about each. */
export interface Imported {
  readonly fields: Field[];
  /**
   * By field id, the slots the document decided (`docs/plan/CONVERGENCE.md`): the kind always,
   * since nothing leaves the review unsettled; whether it must be answered, when the document said
   * either way; the options, when they were printed. The walk asks the rest.
   */
  readonly decided: Record<string, Slot[]>;
}

/** The questions the items become, for a form that already holds `definition` and has retired `retired`. */
export function fieldsOf(
  items: readonly ReviewItem[],
  context: Parameters<typeof importOf>[1],
): Field[] {
  return importOf(items, context).fields;
}

/** The questions the items become, and what the document decided about each (S12). */
export function importOf(
  items: readonly ReviewItem[],
  context: {
    readonly definition: FormDefinition;
    readonly retired: readonly string[];
    /** The form's language: every word goes in under it. */
    readonly locale: string;
  },
): Imported {
  const { locale } = context;
  const taken: Taken = {
    ids: new Set([
      ...context.definition.fields.flatMap((field) =>
        field.type === 'repeating_group'
          ? [field.id, ...field.fields.map((f) => f.id)]
          : [field.id],
      ),
      ...context.retired,
    ]),
    keys: new Set(context.definition.fields.map((field) => field.key)),
  };
  let section =
    context.definition.fields.findLast((field) => field.type === 'section_break')?.id ?? '';
  let ordinal = context.definition.fields.length;
  const words = (text: string) => ({ [locale]: text });

  /** A new id and key, taken so neither is used twice. */
  const name = (seed: string, keyFrom: string, fallback: string) => {
    ordinal += 1;
    const id = stableFieldId(fingerprint(seed, ordinal, section), taken.ids);
    taken.ids.add(id);
    const key = uniqueKey(labelKey(keyFrom, fallback), taken.keys);
    taken.keys.add(key);
    return { id, key };
  };
  /** An id for a question inside a group: its own, never one the form used. */
  const innerId = (seed: string, at: number) => {
    const id = stableFieldId(fingerprint(seed, at, section), taken.ids);
    taken.ids.add(id);
    return id;
  };

  const out: Field[] = [];
  const decided: Record<string, Slot[]> = {};
  const question = (item: ReviewItem, label: string, kind: Kind, extra: object = {}) => {
    const type = fieldTypeOf(kind);
    const { id, key } = name(label || item.id, label, type);
    const choice = type === 'single_select' || type === 'multi_select';
    decided[id] = [
      'kind',
      ...(item.requiredKnown ? (['required'] as const) : []),
      ...(choice && item.options.length > 0 ? (['options'] as const) : []),
    ];
    const options = choice
      ? item.options.length > 0
        ? labelledOptions([], item.options, locale)
        : resizeOptions([], DEFAULT_OPTION_COUNT)
      : undefined;
    // Options a type has no place for are kept as help, but a yes/no's pair is the type itself.
    const kept = choice || type === 'yes_no' ? [] : item.options;
    const help = [...kept, ...item.details];
    out.push(
      Field.parse({
        id,
        key,
        type,
        label: label === '' ? {} : words(label),
        required: item.required,
        ...(help.length > 0 ? { helpText: words(help.join('\n')) } : {}),
        ...(options ? { options } : {}),
        ...(kind === 'money' ? { decimals: 2 } : {}),
        ...extra,
      }),
    );
  };

  for (const item of items) {
    if (!asks(item)) {
      if (item.kind === 'heading') {
        const { id, key } = name(item.text, item.text, 'section');
        section = id;
        out.push(Field.parse({ id, key, type: 'section_break', label: words(item.text) }));
      } else {
        const { id, key } = name(item.text, 'text', 'text');
        out.push(Field.parse({ id, key, type: 'rich_text', content: words(item.text) }));
      }
      continue;
    }
    const kind = item.type ?? 'short_text';

    if (item.kind === 'grid') {
      if (item.columns.length <= 1) {
        // A grid of one column is a list to tick: its rows are the options, its header the help.
        const help = [...item.columns.filter((column) => column !== ''), ...item.details];
        question({ ...item, options: item.rows, details: help }, item.text, 'multi_select');
        continue;
      }
      const help = item.details.length > 0 ? { helpText: words(item.details.join('\n')) } : {};
      if (item.text !== '') {
        const { id, key } = name(item.text, item.text, 'section');
        section = id;
        out.push(Field.parse({ id, key, type: 'section_break', label: words(item.text), ...help }));
      } else if (item.details.length > 0) {
        const { id, key } = name(item.details.join('\n'), 'text', 'text');
        out.push(
          Field.parse({ id, key, type: 'rich_text', content: words(item.details.join('\n')) }),
        );
      }
      // "Grid": one of the columns per row. "Multiple choice": any number of them.
      const each = item.type === 'multi_select' ? 'multi_select' : 'single_select';
      for (const row of item.rows) {
        question({ ...item, options: item.columns, details: [] }, row, each);
      }
      continue;
    }

    if (item.kind === 'table' || kind === 'repeating_group') {
      const label = item.text;
      const { id, key } = name(label || item.id, label, 'group');
      const columns = item.columns.length > 0 ? item.columns : [label];
      // Keys within the group are taken one by one: two columns of the same name, or two with no
      // letters a key can hold ("Имя", "氏名"), still get their own.
      const inner = new Set<string>();
      const fields = columns.map((column, at) => {
        const inside = uniqueKey(labelKey(column, 'answer'), inner);
        inner.add(inside);
        return EntryField.parse({
          id: innerId(`${label}|${column}`, at + 1),
          key: inside,
          type: 'short_text',
          label: column === '' ? {} : words(column),
          required: false,
        });
      });
      out.push(
        Field.parse({
          id,
          key,
          type: 'repeating_group',
          label: label === '' ? {} : words(label),
          ...(item.details.length > 0 ? { helpText: words(item.details.join('\n')) } : {}),
          required: item.required,
          fields,
          min: 0,
          max: Math.min(MAX_GROUP_ENTRIES, Math.max(1, item.rowCount || 1)),
        }),
      );
      continue;
    }

    question(item, item.text, kind);
  }
  return { fields: out, decided };
}
