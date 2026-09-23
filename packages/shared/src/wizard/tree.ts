/**
 * Asking a few narrow questions instead of presenting an empty tool.
 *
 * ## Why this is generic
 *
 * The first version of this lived in `forms/` and produced form fields. It is the default way of
 * starting anything in this product now — a form, a send, a brand, a run of invoices — and four
 * copies of the same walk, each with its own bugs, is not a pattern. So the tree is generic over
 * what an answer contributes, and each surface supplies its own questions and its own outcome type.
 *
 * ## A sector, then facets — not a path
 *
 * This used to be a decision tree: each answer named the one question that followed, so the *order*
 * of questions was a property of the data. That is right for a decision tree and wrong for what
 * this actually asks. "Does it need payment" and "does it need a signature" are independent, and
 * making one of them come second was an invention nobody decided on.
 *
 * So the first question chooses a **sector**, and the sector chooses a **set of facets**. Facets
 * are answered in any order, and a facet may take several answers at once. `docs/adr/0006` is the
 * decision and the argument.
 *
 * ## What an answer may do
 *
 * Contribute items, and — if it is a sector — select which facets apply. That is the whole
 * vocabulary, and it is deliberately smaller than "run code per answer", because a tree of data can
 * be checked and a branch written as an `if` inside a component can only be guessed at.
 *
 * ## Composition, and the one rule that carries it
 *
 * Two facets can both ask for an email address. A form with two email boxes on it is a form
 * somebody fills in twice and then queries, so `keyOf` decides when two contributed items are the
 * same thing and the first one wins. That rule is the load-bearing part of composing blocks, and
 * it is why a few dozen authored blocks cover more forms than anybody will author by hand.
 *
 * ## This is a head start, not a walled garden
 *
 * A run produces a draft, and the draft opens in the ordinary editor. The wizard never becomes the
 * only way to express something, which is what stops it having to grow a button for every case the
 * editor already handles. Anybody who would rather start from nothing takes the advanced route,
 * which is always one press away and never hidden.
 */

export interface WizardOption<TItem> {
  readonly id: string;
  readonly label: Record<string, string>;
  /** A sentence of consequence, so the buttons can be told apart without pressing them. */
  readonly detail?: Record<string, string>;
  /** What choosing this adds, in order. */
  readonly contributes?: readonly TItem[];
  /**
   * Which facets this answer brings into play.
   *
   * A sector option has these; a facet option does not. Order here is the order they are asked in,
   * which is a presentation choice — the answers themselves are order-independent.
   */
  readonly selects?: readonly string[];
}

export interface WizardQuestion<TItem> {
  readonly id: string;
  readonly prompt: Record<string, string>;
  /**
   * Whether several answers may be given at once.
   *
   * A sector is a choice; a facet is a matrix. This is the difference between "what is this for"
   * and "which of these does it need".
   */
  readonly multiple?: boolean;
  readonly options: readonly WizardOption<TItem>[];
}

/** A tree, and where a run through it starts. */
export interface WizardTree<TItem> {
  readonly id: string;
  /** The sector question. Always asked, always first, always one answer. */
  readonly first: string;
  readonly questions: readonly WizardQuestion<TItem>[];
  /**
   * How an item identifies itself, so the same thing contributed by two facets appears once.
   *
   * Two facets can both ask for an email address; a form with two email boxes on it is a form
   * somebody fills in twice and then queries.
   */
  readonly keyOf: (item: TItem) => string;
  /**
   * The most facets a sector may select.
   *
   * This is the four-press promise written as a number a test can read. It used to be proved by
   * enumerating every complete run, which is 2ⁿ once a facet takes several answers at once — so
   * the enumeration went and this took its place. Without it the promise disappears without
   * anybody deciding to drop it. See `docs/adr/0006-catalogue-direction.md`.
   */
  readonly maxFacets: number;
}

export class WizardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WizardError';
  }
}

function index<TItem>(tree: WizardTree<TItem>): Map<string, WizardQuestion<TItem>> {
  return new Map(tree.questions.map((question) => [question.id, question]));
}

export function questionById<TItem>(
  tree: WizardTree<TItem>,
  id: string,
): WizardQuestion<TItem> | undefined {
  return index(tree).get(id);
}

/**
 * The questions a run is actually asking: the sector, then the facets its answer selected.
 *
 * Everything else here is built on this. Answers are matched against the active set rather than
 * walked in sequence, which is what makes them order-independent — the same answers in a different
 * order produce the same form.
 */
export function activeQuestions<TItem>(
  tree: WizardTree<TItem>,
  answers: readonly string[],
): readonly WizardQuestion<TItem>[] {
  const byId = index(tree);
  const sector = byId.get(tree.first);
  if (!sector) throw new WizardError(`No question ${tree.first} in ${tree.id}`);

  const chosen = sector.options.find((option) => answers.includes(option.id));
  if (!chosen) return [sector];

  const facets = (chosen.selects ?? []).map((id) => {
    const facet = byId.get(id);
    if (!facet)
      throw new WizardError(`${tree.id}/${chosen.id} selects ${id}, which does not exist`);
    return facet;
  });

  return [sector, ...facets];
}

/**
 * What a set of answers produces, deduplicated by `keyOf`.
 *
 * Order-independent on purpose: an answer is looked up in the active set rather than consumed in
 * sequence. Within one question the declared option order still decides which contribution wins a
 * key, so the result is deterministic whatever order the buttons were pressed in.
 */
export function collect<TItem>(
  tree: WizardTree<TItem>,
  answers: readonly string[],
): readonly TItem[] {
  const questions = activeQuestions(tree, answers);
  const chosen = new Set(answers);
  const items: TItem[] = [];
  const seen = new Set<string>();

  /*
   * An answer nobody offered is a mistake, not a no-op.
   *
   * Walking `next` used to catch this for free, because an unknown id simply had no successor.
   * Matching against a set does not, so it is checked: `wizardAnswers` arrives over HTTP, and a
   * typo that silently produced a form missing half its fields would be found by the person
   * filling it in.
   */
  const offered = new Set(questions.flatMap((q) => q.options.map((option) => option.id)));
  for (const answer of answers) {
    if (!offered.has(answer)) {
      throw new WizardError(`${answer} is not an answer to anything in ${tree.id}`);
    }
  }

  for (const question of questions) {
    for (const option of question.options) {
      if (!chosen.has(option.id)) continue;
      for (const item of option.contributes ?? []) {
        const key = tree.keyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
  }

  return items;
}
