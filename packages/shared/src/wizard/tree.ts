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
 * The structure is the part worth sharing: a question, two to four buttons, each button adding
 * something and choosing what to ask next. That shape is identical whether the buttons are choosing
 * fields on a form or who a mailing goes to.
 *
 * ## What an answer may do
 *
 * Contribute items, and choose the next question. That is the whole vocabulary, and it is
 * deliberately smaller than "run code per answer".
 *
 * The reason is that a tree of data can be *enumerated*: every path through it can be walked and
 * checked. A branch written as an `if` inside a component can only be tested by guessing which
 * combinations somebody might press. Every guarantee these trees carry — no dead ends, no
 * unreachable questions, nothing that takes more than four presses — exists because the tree is a
 * value rather than a function.
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
  /** The next question, or nothing to finish here. */
  readonly next?: string;
}

export interface WizardQuestion<TItem> {
  readonly id: string;
  readonly prompt: Record<string, string>;
  readonly options: readonly WizardOption<TItem>[];
}

/** A tree, and where a run through it starts. */
export interface WizardTree<TItem> {
  readonly id: string;
  readonly first: string;
  readonly questions: readonly WizardQuestion<TItem>[];
  /**
   * How an item identifies itself, so the same thing contributed by two branches appears once.
   *
   * Two paths can both ask for an email address; a form with two email boxes on it is a form
   * somebody fills in twice and then queries.
   */
  readonly keyOf: (item: TItem) => string;
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

/** Walk a run of answers and collect what they contributed. */
export function collect<TItem>(
  tree: WizardTree<TItem>,
  answers: readonly string[],
): readonly TItem[] {
  const byId = index(tree);
  const items: TItem[] = [];
  const seen = new Set<string>();

  let questionId: string | undefined = tree.first;

  for (const answer of answers) {
    if (!questionId) throw new WizardError('The run already finished; there is nothing to answer');

    const question: WizardQuestion<TItem> | undefined = byId.get(questionId);
    if (!question) throw new WizardError(`No question ${questionId} in ${tree.id}`);

    const option = question.options.find((candidate) => candidate.id === answer);
    if (!option) throw new WizardError(`${answer} is not an answer to ${questionId}`);

    for (const item of option.contributes ?? []) {
      const key = tree.keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }

    questionId = option.next;
  }

  return items;
}

/** The question in front of somebody, or nothing when the run has finished. */
export function currentQuestion<TItem>(
  tree: WizardTree<TItem>,
  answers: readonly string[],
): WizardQuestion<TItem> | undefined {
  const byId = index(tree);
  let questionId: string | undefined = tree.first;

  for (const answer of answers) {
    const question: WizardQuestion<TItem> | undefined = questionId
      ? byId.get(questionId)
      : undefined;
    if (!question) return undefined;
    questionId = question.options.find((candidate) => candidate.id === answer)?.next;
  }

  return questionId ? byId.get(questionId) : undefined;
}

/**
 * Every complete run the tree allows.
 *
 * Exported rather than kept in a test, because it is what the tests for each individual tree are
 * written on top of — and because a tree that cannot be enumerated has grown a cycle, which this
 * says out loud instead of hanging.
 */
export function everyPath<TItem>(tree: WizardTree<TItem>): string[][] {
  const byId = index(tree);
  const paths: string[][] = [];

  const walk = (questionId: string | undefined, answers: string[], visited: readonly string[]) => {
    if (!questionId) {
      paths.push(answers);
      return;
    }
    if (visited.includes(questionId)) {
      throw new WizardError(
        `${tree.id} loops: ${[...visited, questionId].join(' > ')}. A run that can return to a question it has already asked cannot finish.`,
      );
    }

    const question = byId.get(questionId);
    if (!question) throw new WizardError(`No question ${questionId} in ${tree.id}`);

    for (const option of question.options) {
      walk(option.next, [...answers, option.id], [...visited, questionId]);
    }
  };

  walk(tree.first, [], []);
  return paths;
}
