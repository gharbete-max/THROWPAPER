import { uniqueKey, type BuilderSidecar, type Reimport, type Slot } from '@tp/shared/builder';
import { emptyDefinition, type Field, type FormDefinition } from '@tp/shared/forms';
import {
  compareImport,
  nothingChanged,
  planImport,
  type Comparison,
  type CompareInput,
  type EntryFamily,
  type ImportChoices,
} from '@tp/shared/import';
import { importOf } from './fields.js';
import type { ReviewItem } from './review.js';

/**
 * A form read from a document, and the document read again — `docs/plan/CONVERGENCE.md` (S12c).
 * Pure: what the review screen shows under "Compared with your form", and what "Update the form"
 * hands the machine. The comparison itself is `@tp/shared/import`'s (`compareImport`).
 */

export interface Update {
  readonly input: CompareInput;
  readonly comparison: Comparison;
  /** The document's fields, made as if into an empty form, so an unchanged one has its old id. */
  readonly fields: readonly Field[];
  readonly decided: Readonly<Record<string, Slot[]>>;
  /** By document field id, the review item it came from. */
  readonly itemOf: Readonly<Record<string, string>>;
}

export interface UpdateContext {
  readonly definition: FormDefinition;
  readonly sidecar: BuilderSidecar;
  /** The form's language: the document's words are compared, and written, in it. */
  readonly locale: string;
}

/** A field's family, as the comparison has it; a page break has no words and is not compared. */
function familyOf(field: Field): EntryFamily | null {
  if (field.type === 'section_break') return 'heading';
  if (field.type === 'rich_text') return 'text';
  if (field.type === 'page_break') return null;
  return 'question';
}

type Words = Readonly<Record<string, string>>;

/** Where a field's words are: a text's content, anything else's label. */
const propertyOf = (field: Field): 'label' | 'content' =>
  field.type === 'rich_text' ? 'content' : 'label';

function wordsOf(field: Field): Words {
  const words = (field as { label?: Words; content?: Words })[propertyOf(field)];
  return words ?? {};
}

/** A field's words in the form's language, else its first, else none. */
function textOf(field: Field, locale: string): string {
  const words = wordsOf(field);
  return words[locale] ?? Object.values(words)[0] ?? '';
}

/** Whether a document is one the form keeps already: its paper sources are `<sha256>.<ext>`. */
export function keptAlready(definition: FormDefinition, sha256: string | null): boolean {
  if (sha256 === null) return false;
  return (definition.paper?.sources ?? []).some((source) => source.key.startsWith(`${sha256}.`));
}

/** Whether "Use these questions" is an update: the form has anything in it already. */
export const isUpdate = (definition: FormDefinition) => definition.fields.length > 0;

/** The review's items against the form: what is added, and what the person is asked. */
export function compareWithForm(items: readonly ReviewItem[], context: UpdateContext): Update {
  const { definition, sidecar, locale } = context;
  const imported = importOf(items, { definition: emptyDefinition, retired: [], locale });
  const input: CompareInput = {
    form: definition.fields.flatMap((field) => {
      const family = familyOf(field);
      return family === null
        ? []
        : [
            {
              id: field.id,
              family,
              text: textOf(field, locale),
              fromDocument: sidecar.fields[field.id]?.source === 'import',
            },
          ];
    }),
    document: imported.fields.flatMap((field) => {
      const family = familyOf(field);
      return family === null ? [] : [{ id: field.id, family, text: textOf(field, locale) }];
    }),
    retired: sidecar.retiredIds,
  };
  return {
    input,
    comparison: compareImport(input),
    fields: imported.fields.filter((field) => familyOf(field) !== null),
    decided: imported.decided,
    itemOf: imported.itemOf,
  };
}

export const noChoices: ImportChoices = { addBack: [], reword: [], remove: [], move: [] };

/** Whether updating would change anything: something to add, or something the person chose. */
export function changesAnything(update: Update, choices: ImportChoices): boolean {
  const plan = planImport(update.input, update.comparison, choices);
  return plan.place.length + plan.reword.length + plan.remove.length > 0;
}

export { nothingChanged };

/**
 * The review items behind what would be added: the gate holds "Update the form" only on these, as
 * "Use these questions" is held on everything it adds (non-negotiable 3).
 */
export function itemsAdded(update: Update, choices: ImportChoices): string[] {
  const plan = planImport(update.input, update.comparison, choices);
  const ids = plan.place.flatMap((p) =>
    p.kind === 'add' ? [update.input.document[p.index]!.id] : [],
  );
  return [...new Set(ids.flatMap((id) => (update.itemOf[id] ? [update.itemOf[id]!] : [])))];
}

/**
 * What the machine does (`reimport`): the plan, with each added field given an id and a key the
 * form has never used — a field the person took out comes back under a new id, never its old one
 * (`CAVEATS.md` #49) — and each rewording the document's words in the form's language, the form's
 * other languages kept.
 */
export function reimportOf(
  update: Update,
  choices: ImportChoices,
  context: UpdateContext,
): Reimport {
  const { definition, sidecar, locale } = context;
  const plan = planImport(update.input, update.comparison, choices);
  const taken = new Set([
    ...definition.fields.flatMap((field) =>
      field.type === 'repeating_group' ? [field.id, ...field.fields.map((f) => f.id)] : [field.id],
    ),
    ...sidecar.retiredIds,
  ]);
  const keys = new Set(definition.fields.map((field) => field.key));
  const free = (id: string) => {
    if (!taken.has(id)) return id;
    for (let n = 2; ; n += 1) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`;
  };
  /** The ids additions were given, by the document's: an addition can follow another. */
  const given = new Map<string, string>();
  const byId = new Map(update.fields.map((field) => [field.id, field]));
  const place = plan.place.map((p) => {
    const after = p.after === null ? null : (given.get(p.after) ?? p.after);
    if (p.kind === 'move') return { kind: 'move' as const, id: p.formId, after };
    const documentId = update.input.document[p.index]!.id;
    const original = byId.get(documentId)!;
    const id = free(original.id);
    taken.add(id);
    given.set(documentId, id);
    const key = uniqueKey(original.key, keys);
    keys.add(key);
    const field =
      original.type === 'repeating_group'
        ? {
            ...original,
            id,
            key,
            fields: original.fields.map((inner) => {
              const innerId = free(inner.id);
              taken.add(innerId);
              return { ...inner, id: innerId };
            }),
          }
        : { ...original, id, key };
    return {
      kind: 'add' as const,
      field: field as Field,
      after,
      decided: update.decided[documentId] ?? [],
    };
  });
  const formField = new Map(definition.fields.map((field) => [field.id, field]));
  const reword = plan.reword.map((index) => {
    const formId = update.comparison.matches[index]!.formId!;
    const field = formField.get(formId)!;
    return {
      id: formId,
      property: propertyOf(field),
      value: { ...wordsOf(field), [locale]: update.input.document[index]!.text },
    };
  });
  return { place, reword, remove: [...plan.remove] };
}

/** A field's words in the form's language, for the screen: the form's and the document's. */
export function formText(update: Update, formId: string): string {
  return update.input.form.find((entry) => entry.id === formId)?.text ?? '';
}
export const documentText = (update: Update, index: number) =>
  update.input.document[index]?.text ?? '';
