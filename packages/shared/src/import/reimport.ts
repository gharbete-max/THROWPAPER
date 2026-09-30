/**
 * Stage 9: a form read from a document, compared with the document read again —
 * `docs/plan/CONVERGENCE.md` (S12c), `IMPORT-PIPELINE.md` stage 9.
 *
 * Pure and integer. The form's fields and the document's, each with its id, its family and its
 * text, in their own orders. The document's are made as if into an empty form, so a field the
 * document still says the same thing about, in the same place, has the id it was given when it was
 * first imported: its id is its source text's fingerprint (`PREDICTIVE-BUILDER.md`, "Stable ids").
 *
 * Matched, in this order:
 * 1. **By id**: the document did not change there. Whatever the form now says, and wherever it now
 *    stands, is the person's, and nothing is asked.
 * 2. **By wording near its place**: in document order, each unmatched document field to the
 *    unmatched form field of its family with the highest Dice similarity of their texts' character
 *    bigrams, at least 4/5, whose ordinal is within 3 of its own; ties to the lower ordinal.
 * 3. **By the same wording anywhere**: a document field whose normalised text is that of exactly one
 *    unmatched form field of its family, and of no other unmatched document field. Added while
 *    building: four questions inserted before one put it outside the three places, and it would
 *    have been added a second time (`fixtures/reimport/far-but-the-same.json`).
 *
 * Then what the person is told and asked: what is added, what they took out that the document still
 * has, what is worded differently, what the document no longer has, and what it moved.
 */

export type EntryFamily = 'question' | 'heading' | 'text';

export interface ImportEntry {
  readonly id: string;
  readonly family: EntryFamily;
  /** A question's label, a heading's title, a text's body: in the form's language. */
  readonly text: string;
}

export interface FormEntry extends ImportEntry {
  /** The import made it (`source: 'import'` in the author's sidecar): only then is it asked about. */
  readonly fromDocument: boolean;
}

export interface CompareInput {
  /** In the form's order. */
  readonly form: readonly FormEntry[];
  /** In the document's order, with the ids an import into an empty form gives them. */
  readonly document: readonly ImportEntry[];
  /** Every id the form has used (`retiredIds`): one the form no longer has was taken out. */
  readonly retired: readonly string[];
}

export interface EntryMatch {
  readonly formId: string | null;
  readonly by: 'id' | 'wording' | null;
}

export interface Comparison {
  /** One per document field, in the document's order. */
  readonly matches: readonly EntryMatch[];
  /** Document fields new to the form: added. */
  readonly added: readonly number[];
  /** Document fields the person took out of the form: asked, default no. */
  readonly addBack: readonly number[];
  /** Document fields matched by wording whose text is not the form's: asked, default keep. */
  readonly reworded: readonly number[];
  /** Form fields the import made that the document no longer has: asked, default keep. */
  readonly gone: readonly string[];
  /** Document fields matched by wording and out of the document's order: asked, default leave. */
  readonly moved: readonly number[];
}

/** What the person chose: document indexes, and form ids for removals. */
export interface ImportChoices {
  readonly addBack: readonly number[];
  readonly reword: readonly number[];
  readonly remove: readonly string[];
  readonly move: readonly number[];
}

export type Placement =
  | { readonly kind: 'add'; readonly index: number; readonly after: string | null }
  | { readonly kind: 'move'; readonly formId: string; readonly after: string | null };

/**
 * What to do to the form, in the order to do it: placements in the document's order, each after
 * the field before it in the document (null: first); rewordings; removals last.
 */
export interface ImportPlan {
  readonly place: readonly Placement[];
  readonly reword: readonly number[];
  readonly remove: readonly string[];
}

/** How far, in ordinals, a field may have moved and still be matched by wording near its place. */
export const NEAR_PLACES = 3;

/** The lowest Dice similarity that is the same field, as a fraction: 4/5. */
export const DICE_AT_LEAST = { numerator: 4, denominator: 5 } as const;

/** Text as it is compared: NFKC, lower case, runs of white space as one, trimmed. */
export function normaliseEntry(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function bigrams(text: string): Map<string, number> {
  const chars = [...normaliseEntry(text)];
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < chars.length; i += 1) {
    const pair = chars[i]! + chars[i + 1]!;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/**
 * The Dice similarity of two texts' character bigrams, as a fraction `twice / total`:
 * twice the bigrams they share (counted with multiplicity), over both counts added. Two texts too
 * short to have a bigram are 1/1 when their normalised texts are equal, else 0/1.
 */
export function dice(a: string, b: string): { readonly twice: number; readonly total: number } {
  const left = bigrams(a);
  const right = bigrams(b);
  let sizeA = 0;
  let sizeB = 0;
  let shared = 0;
  for (const count of left.values()) sizeA += count;
  for (const [pair, count] of right) {
    sizeB += count;
    shared += Math.min(count, left.get(pair) ?? 0);
  }
  if (sizeA + sizeB === 0)
    return { twice: normaliseEntry(a) === normaliseEntry(b) ? 1 : 0, total: 1 };
  return { twice: 2 * shared, total: sizeA + sizeB };
}

const alike = (d: { twice: number; total: number }) =>
  DICE_AT_LEAST.denominator * d.twice >= DICE_AT_LEAST.numerator * d.total;

/** Whether `a` is more alike than `b`, compared as fractions. */
const moreAlike = (a: { twice: number; total: number }, b: { twice: number; total: number }) =>
  a.twice * b.total > b.twice * a.total;

export function compareImport(input: CompareInput): Comparison {
  const { form, document } = input;
  const formAt = new Map(form.map((entry, i) => [entry.id, i]));
  const matchOf: (number | null)[] = document.map(() => null);
  const by: ('id' | 'wording' | null)[] = document.map(() => null);
  const taken = new Set<number>();

  // 1. By id: the same fingerprint, the same family.
  document.forEach((entry, d) => {
    const f = formAt.get(entry.id);
    if (f === undefined || form[f]!.family !== entry.family || taken.has(f)) return;
    matchOf[d] = f;
    by[d] = 'id';
    taken.add(f);
  });

  // 2. By wording near its place, in document order.
  document.forEach((entry, d) => {
    if (matchOf[d] !== null) return;
    let best: { f: number; similarity: { twice: number; total: number } } | null = null;
    for (let f = Math.max(0, d - NEAR_PLACES); f <= d + NEAR_PLACES && f < form.length; f += 1) {
      const candidate = form[f]!;
      if (taken.has(f) || candidate.family !== entry.family) continue;
      const similarity = dice(entry.text, candidate.text);
      if (!alike(similarity)) continue;
      // Ties to the lower ordinal: a later candidate must be strictly more alike.
      if (best === null || moreAlike(similarity, best.similarity)) best = { f, similarity };
    }
    if (best === null) return;
    matchOf[d] = best.f;
    by[d] = 'wording';
    taken.add(best.f);
  });

  // 3. By the same wording anywhere, when it is one field's on each side.
  const textOf = (entry: ImportEntry) => `${entry.family}\u0000${normaliseEntry(entry.text)}`;
  const openDocument = new Map<string, number[]>();
  document.forEach((entry, d) => {
    if (matchOf[d] !== null) return;
    openDocument.set(textOf(entry), [...(openDocument.get(textOf(entry)) ?? []), d]);
  });
  const openForm = new Map<string, number[]>();
  form.forEach((entry, f) => {
    if (taken.has(f)) return;
    openForm.set(textOf(entry), [...(openForm.get(textOf(entry)) ?? []), f]);
  });
  for (const [text, ds] of openDocument) {
    const fs = openForm.get(text);
    if (ds.length !== 1 || fs?.length !== 1) continue;
    matchOf[ds[0]!] = fs[0]!;
    by[ds[0]!] = 'wording';
    taken.add(fs[0]!);
  }

  const inForm = new Set(form.map((entry) => entry.id));
  const retired = new Set(input.retired);
  const added: number[] = [];
  const addBack: number[] = [];
  const reworded: number[] = [];
  document.forEach((entry, d) => {
    const f = matchOf[d] ?? null;
    if (f === null) {
      if (!inForm.has(entry.id) && retired.has(entry.id)) addBack.push(d);
      else added.push(d);
      return;
    }
    if (by[d] === 'wording' && entry.text !== form[f]!.text) reworded.push(d);
  });
  const gone = form.filter((entry, f) => entry.fromDocument && !taken.has(f)).map((e) => e.id);

  return {
    matches: document.map((_, d) => {
      const f = matchOf[d] ?? null;
      return f === null ? { formId: null, by: null } : { formId: form[f]!.id, by: by[d]! };
    }),
    added,
    addBack,
    reworded,
    gone,
    moved: outOfOrder(matchOf, by),
  };
}

/**
 * The matched document fields that are out of the document's order, asked about only when matched
 * by wording: the longest run of matched fields whose form order is the document's stays, ties to
 * the earlier document field. A field matched by id and out of that run was moved by the person,
 * and is not asked about. Every match weighs the same: weighing id matches more would keep a field
 * the person moved by hand in the run and ask about the one the document only reworded
 * (`fixtures/reimport/hand-moved-and-reworded.json`).
 */
function outOfOrder(
  matchOf: readonly (number | null)[],
  by: readonly ('id' | 'wording' | null)[],
): number[] {
  const matched = matchOf.flatMap((f, d) => (f === null ? [] : [d]));
  const best: number[] = [];
  const before: number[] = [];
  matched.forEach((d, i) => {
    best[i] = 1;
    before[i] = -1;
    for (let j = 0; j < i; j += 1) {
      if (matchOf[matched[j]!]! < matchOf[d]! && best[j]! + 1 > best[i]!) {
        best[i] = best[j]! + 1;
        before[i] = j;
      }
    }
  });
  let end = -1;
  best.forEach((value, i) => {
    if (end < 0 || value > best[end]!) end = i;
  });
  const stays = new Set<number>();
  for (let i = end; i >= 0; i = before[i]!) stays.add(matched[i]!);
  return matched.filter((d) => !stays.has(d) && by[d] === 'wording');
}

/** Whether there is nothing to add and nothing to ask. */
export function nothingChanged(comparison: Comparison): boolean {
  return (
    comparison.added.length === 0 &&
    comparison.addBack.length === 0 &&
    comparison.reworded.length === 0 &&
    comparison.gone.length === 0 &&
    comparison.moved.length === 0
  );
}

/**
 * What to do, from the comparison and the person's choices. A choice that is not one of the
 * comparison's questions is ignored: nothing is removed, reworded or moved that was not asked.
 */
export function planImport(
  input: CompareInput,
  comparison: Comparison,
  choices: ImportChoices,
): ImportPlan {
  const addBack = new Set(choices.addBack.filter((d) => comparison.addBack.includes(d)));
  const move = new Set(choices.move.filter((d) => comparison.moved.includes(d)));
  const added = new Set(comparison.added);
  const place: Placement[] = [];
  let anchor: string | null = null;
  input.document.forEach((entry, d) => {
    const { formId } = comparison.matches[d]!;
    if (formId !== null) {
      if (move.has(d)) place.push({ kind: 'move', formId, after: anchor });
      anchor = formId;
      return;
    }
    if (added.has(d) || addBack.has(d)) {
      place.push({ kind: 'add', index: d, after: anchor });
      anchor = entry.id;
    }
  });
  return {
    place,
    reword: comparison.reworded.filter((d) => choices.reword.includes(d)),
    remove: comparison.gone.filter((id) => choices.remove.includes(id)),
  };
}
