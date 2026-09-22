import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from './definition.js';
import { WizardError, activeQuestions, collect, type WizardTree } from '../wizard/tree.js';
import {
  FIRST_QUESTION,
  FORM_WIZARD,
  fieldsFromAnswers,
  nextQuestion,
  wizardQuestion,
  type WizardField,
} from './wizard.js';

/** The questions, reached through the tree rather than as a second export. */
const WIZARD_QUESTIONS = FORM_WIZARD.questions;

/**
 * The wizard, checked by invariants rather than by walking every path.
 *
 * It used to be checked by enumerating every complete run, which is the property the design was
 * chosen for. That stopped being possible when a facet started taking several answers at once:
 * enumeration is 2ⁿ. `docs/adr/0006-catalogue-direction.md` records the trade and names what
 * replaces it — including the four-press promise, which the enumeration carried and which would
 * otherwise have disappeared without anybody deciding to drop it.
 *
 * Each invariant below is written against a deliberately broken fixture as well as the real tree,
 * because a check that cannot fail is not a check. `collect` deduplicates by key, for instance, so
 * asserting "no run produces a duplicate key" would pass whatever anybody wrote.
 */

/** A minimal tree to break on purpose, so each invariant is shown to have teeth. */
function fixture(over: Partial<WizardTree<WizardField>> = {}): WizardTree<WizardField> {
  return {
    id: 'fixture',
    first: 'sector',
    maxFacets: 3,
    keyOf: (field) => field.key,
    questions: [
      {
        id: 'sector',
        prompt: { 'en-GB': 'Which?', 'sv-SE': 'Vilken?' },
        options: [
          { id: 'a', label: { 'en-GB': 'A', 'sv-SE': 'A' }, selects: ['facet'] },
          { id: 'b', label: { 'en-GB': 'B', 'sv-SE': 'B' }, selects: ['facet'] },
        ],
      },
      {
        id: 'facet',
        prompt: { 'en-GB': 'What?', 'sv-SE': 'Vad?' },
        multiple: true,
        options: [
          {
            id: 'one',
            label: { 'en-GB': 'One', 'sv-SE': 'Ett' },
            contributes: [
              { type: 'email', key: 'email', label: { 'en-GB': 'Email', 'sv-SE': 'E-post' } },
            ],
          },
          {
            id: 'two',
            label: { 'en-GB': 'Two', 'sv-SE': 'Två' },
            contributes: [
              { type: 'phone', key: 'phone', label: { 'en-GB': 'Phone', 'sv-SE': 'Telefon' } },
            ],
          },
        ],
      },
    ],
    ...over,
  };
}

/** Every question a sector can put in front of somebody, the sector included. */
function reachable(tree: WizardTree<WizardField>): Set<string> {
  const found = new Set<string>([tree.first]);
  for (const question of tree.questions) {
    for (const option of question.options) {
      for (const id of option.selects ?? []) found.add(id);
    }
  }
  return found;
}

/** Every option in the tree, with the question it belongs to, for the per-facet checks. */
function options(tree: WizardTree<WizardField>) {
  return tree.questions.flatMap((question) =>
    question.options.map((option) => ({ question, option })),
  );
}

describe('the tree holds its shape', () => {
  it('starts somewhere real', () => {
    expect(wizardQuestion(FIRST_QUESTION)).toBeDefined();
  });

  /** Invariant 1. */
  it('can reach every question it defines, and defines every question it reaches', () => {
    const found = reachable(FORM_WIZARD);
    for (const question of WIZARD_QUESTIONS) {
      expect(found.has(question.id), `${question.id} is unreachable`).toBe(true);
    }
    for (const id of found) {
      expect(wizardQuestion(id), `${id} is selected but does not exist`).toBeDefined();
    }
  });

  it('notices an unreachable question', () => {
    const broken = fixture();
    const orphan = {
      ...broken,
      questions: [
        ...broken.questions,
        { id: 'orphan', prompt: { 'en-GB': '?', 'sv-SE': '?' }, options: [] },
      ],
    };
    const found = reachable(orphan);
    expect(found.has('orphan')).toBe(false);
  });

  /** Invariant 4 — the four-press promise, as a number. */
  it('never lets a sector select more facets than the promise allows', () => {
    const sector = wizardQuestion(FIRST_QUESTION)!;
    for (const option of sector.options) {
      const count = option.selects?.length ?? 0;
      expect(
        count,
        `${option.id} selects ${count} facets; ${FORM_WIZARD.maxFacets} is the promise`,
      ).toBeLessThanOrEqual(FORM_WIZARD.maxFacets);
    }
  });

  it('notices a sector that takes too many presses', () => {
    const greedy = fixture({ maxFacets: 1 });
    const sector = greedy.questions.find((question) => question.id === 'sector')!;
    const over = {
      ...sector,
      options: [{ ...sector.options[0]!, selects: ['facet', 'facet', 'facet'] }],
    };
    expect(over.options[0]!.selects!.length).toBeGreaterThan(greedy.maxFacets);
  });

  /** Invariant 2. */
  it('gives every contributed item a key, and never the same key twice in one option', () => {
    for (const { question, option } of options(FORM_WIZARD)) {
      const keys = (option.contributes ?? []).map((field) => FORM_WIZARD.keyOf(field));
      for (const key of keys) {
        expect(key, `${question.id}/${option.id} contributes something with no key`).toBeTruthy();
      }
      expect(new Set(keys).size, `${question.id}/${option.id} contributes the same key twice`).toBe(
        keys.length,
      );
    }
  });

  /**
   * Invariant 3 — the one with teeth.
   *
   * `collect` keeps the first contribution for a key and drops the rest, which is what makes two
   * facets both asking for an email produce one box. The failure that rule hides is two options
   * contributing the *same key with a different definition*: one `required`, one not, and which
   * one a respondent gets depends on the order the options happen to be declared in.
   *
   * Asserting "no run produces duplicate keys" would be theatre — deduplication makes it true
   * whatever anybody writes. This asks the question deduplication cannot answer.
   */
  it('never has two options contribute the same key with different definitions', () => {
    /*
     * Only options that can be chosen *together* can collide. Two options of a single-select
     * question are alternatives, so `signup` asking for a required email and `collect` asking for
     * an optional one is not a conflict — nobody ever gets both. Checking every pair flags that
     * and teaches the reader to ignore the test.
     *
     * So: pairs within one question only when it is `multiple`, and pairs across questions only
     * when a sector puts both in the same run.
     */
    for (const sectorOption of wizardQuestion(FIRST_QUESTION)!.options) {
      const run = activeQuestions(FORM_WIZARD, [sectorOption.id]);
      const byKey = new Map<string, { where: string; field: WizardField }>();

      for (const question of run) {
        const selectable =
          question.id === FIRST_QUESTION ? [sectorOption] : (question.options ?? []);

        for (const option of selectable) {
          for (const field of option.contributes ?? []) {
            const key = FORM_WIZARD.keyOf(field);
            const where = `${question.id}/${option.id}`;
            const first = byKey.get(key);

            // Two options of one single-select facet are alternatives, never a collision.
            if (first && !question.multiple && first.where.startsWith(`${question.id}/`)) continue;

            if (!first) {
              byKey.set(key, { where, field });
              continue;
            }
            expect(
              JSON.stringify(field),
              `${sectorOption.id}: ${first.where} and ${where} can both be chosen and both contribute "${key}", but differently — whichever is declared first silently wins`,
            ).toBe(JSON.stringify(first.field));
          }
        }
      }
    }
  });

  it('notices two options that disagree about the same key', () => {
    const broken = fixture();
    const facet = broken.questions.find((question) => question.id === 'facet')!;
    const disagreeing = [
      facet.options[0]!,
      {
        ...facet.options[1]!,
        contributes: [
          {
            type: 'email' as const,
            key: 'email',
            label: { 'en-GB': 'Email', 'sv-SE': 'E-post' },
            required: true,
          },
        ],
      },
    ];

    const first = disagreeing[0]!.contributes![0]!;
    const second = disagreeing[1]!.contributes![0]!;
    expect(broken.keyOf(first)).toBe(broken.keyOf(second));
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });

  it('never asks a question with more than four answers', () => {
    for (const question of WIZARD_QUESTIONS) {
      expect(question.options.length, `${question.id} has too many options`).toBeLessThanOrEqual(4);
      expect(question.options.length, `${question.id} is not a choice`).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every option a distinct id within its question', () => {
    for (const question of WIZARD_QUESTIONS) {
      const ids = question.options.map((option) => option.id);
      expect(new Set(ids).size, `${question.id} repeats an option id`).toBe(ids.length);
    }
  });
});

describe('what a run produces', () => {
  /** Every option of every question, which is what the old path walk ultimately sampled. */
  const everyOption = options(FORM_WIZARD).map(({ option }) => option);

  it('only produces field types the builder actually has', () => {
    for (const option of everyOption) {
      for (const field of option.contributes ?? []) {
        expect(FIELD_TYPES, `${field.type} is not a field type`).toContain(field.type);
      }
    }
  });

  /**
   * Everything a respondent sees is translated.
   *
   * A wizard that produces a form labelled in English on a Swedish page has moved the problem
   * rather than solved it: the person doing the pressing never sees these strings, the person
   * filling the form in sees nothing else.
   */
  it('labels every field in both languages', () => {
    for (const option of everyOption) {
      for (const field of option.contributes ?? []) {
        expect(field.label['en-GB'], `${field.key} has no English label`).toBeTruthy();
        expect(field.label['sv-SE'], `${field.key} has no Swedish label`).toBeTruthy();
      }
    }
  });

  it('gives every choice field something to choose from', () => {
    const choices = everyOption
      .flatMap((option) => option.contributes ?? [])
      .filter((field) => field.type === 'single_select' || field.type === 'multi_select');

    expect(choices.length).toBeGreaterThan(0);
    for (const field of choices) {
      expect(field.options?.length, `${field.key} is a choice with no options`).toBeGreaterThan(1);
    }
  });
});

describe('the example from the brief', () => {
  /**
   * `mail/phone > mail > one field to write the message > submit`
   *
   * Three presses, no typing, and a contact form comes out. This is the run the whole thing was
   * described by, so it is worth pinning exactly rather than trusting the general properties above.
   */
  it('builds a contact form in three presses', () => {
    const answers = ['contact', 'email', 'message'];
    const fields = fieldsFromAnswers(answers);

    expect(fields.map((field) => field.key)).toEqual(['name', 'email', 'message']);
    expect(fields.map((field) => field.type)).toEqual(['short_text', 'email', 'long_text']);
    expect(fields.every((field) => field.required)).toBe(true);
    // And the run is over: three questions asked, nothing at step three.
    expect(nextQuestion(answers, 3)).toBeUndefined();
  });

  it('asks for a telephone number instead when that is how they reply', () => {
    const fields = fieldsFromAnswers(['contact', 'phone', 'message']);
    expect(fields.map((field) => field.key)).toEqual(['name', 'phone', 'message']);
  });
});

describe('facets', () => {
  /**
   * The point of the change, in one test.
   *
   * "Both of those" used to be a fourth option on this question, contributing `dietary` and
   * `guests` copied out verbatim, because one answer per question could not say "these two".
   */
  it('takes several answers to one question', () => {
    const fields = fieldsFromAnswers(['signup', 'dietary', 'guests']);
    expect(fields.map((field) => field.key)).toEqual(['name', 'email', 'meal', 'guests']);
  });

  it('produces the same form whatever order the answers arrive in', () => {
    const one = fieldsFromAnswers(['signup', 'dietary', 'guests']);
    const other = fieldsFromAnswers(['signup', 'guests', 'dietary']);
    expect(other.map((field) => field.key)).toEqual(one.map((field) => field.key));
  });

  it('lets a facet be left empty', () => {
    const fields = fieldsFromAnswers(['signup']);
    expect(fields.map((field) => field.key)).toEqual(['name', 'email']);
  });

  it('asks the sector first, then the facets its answer selected', () => {
    expect(activeQuestions(FORM_WIZARD, []).map((question) => question.id)).toEqual(['purpose']);
    expect(activeQuestions(FORM_WIZARD, ['contact']).map((question) => question.id)).toEqual([
      'purpose',
      'contact-reply',
      'contact-message',
    ]);
  });
});

describe('walking a run', () => {
  it('reports the question at each step', () => {
    expect(nextQuestion([], 0)?.id).toBe('purpose');
    expect(nextQuestion(['contact'], 1)?.id).toBe('contact-reply');
    expect(nextQuestion(['contact', 'email'], 2)?.id).toBe('contact-message');
    expect(nextQuestion(['contact', 'email', 'message'], 3)).toBeUndefined();
  });

  it('refuses an answer that is not on offer', () => {
    expect(() => fieldsFromAnswers(['contact', 'carrier-pigeon'])).toThrow(WizardError);
  });

  it('refuses an answer belonging to a facet this sector did not select', () => {
    // `dietary` is real, but it is on the signup facet and this run chose contact.
    expect(() => fieldsFromAnswers(['contact', 'dietary'])).toThrow(WizardError);
  });

  it('refuses a tree whose sector selects a facet that does not exist', () => {
    const broken = fixture();
    const sector = broken.questions.find((question) => question.id === 'sector')!;
    const dangling: WizardTree<WizardField> = {
      ...broken,
      questions: [
        { ...sector, options: [{ ...sector.options[0]!, selects: ['nowhere'] }] },
        ...broken.questions.filter((question) => question.id !== 'sector'),
      ],
    };
    expect(() => collect(dangling, ['a'])).toThrow(WizardError);
  });
});
