import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from './definition.js';
import {
  FIRST_QUESTION,
  WIZARD_QUESTIONS,
  WizardError,
  fieldsFromAnswers,
  nextQuestion,
  wizardQuestion,
  type WizardField,
} from './wizard.js';

/**
 * The wizard, checked by walking every path through it.
 *
 * That is the property the whole design was chosen for: the questions are data, so the tree can be
 * enumerated rather than sampled. A branch written as an `if` in a component would have to be
 * tested by guessing which combinations somebody might press.
 */

/** Every complete run of answers the tree allows, depth-first. */
function everyPath(): string[][] {
  const paths: string[][] = [];

  const walk = (questionId: string | undefined, answers: string[]) => {
    if (!questionId) {
      paths.push(answers);
      return;
    }
    const question = wizardQuestion(questionId);
    if (!question) throw new Error(`No question ${questionId}`);
    for (const option of question.options) {
      walk(option.next, [...answers, option.id]);
    }
  };

  walk(FIRST_QUESTION, []);
  return paths;
}

describe('the tree', () => {
  it('starts somewhere real', () => {
    expect(wizardQuestion(FIRST_QUESTION)).toBeDefined();
  });

  it('has no dead ends', () => {
    for (const question of WIZARD_QUESTIONS) {
      for (const option of question.options) {
        if (option.next === undefined) continue;
        expect(
          wizardQuestion(option.next),
          `${question.id}/${option.id} goes nowhere`,
        ).toBeDefined();
      }
    }
  });

  it('can reach every question it defines', () => {
    const reached = new Set<string>([FIRST_QUESTION]);
    for (const question of WIZARD_QUESTIONS) {
      for (const option of question.options) if (option.next) reached.add(option.next);
    }
    for (const question of WIZARD_QUESTIONS) {
      expect(reached.has(question.id), `${question.id} is unreachable`).toBe(true);
    }
  });

  /**
   * Two to four buttons, never more.
   *
   * Past about four people stop reading and start scanning, and a scanned question is where a wrong
   * answer comes from. This is the constraint that keeps it a wizard rather than a menu.
   */
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

describe('every path through it', () => {
  const paths = everyPath();

  it('finishes, and finishes quickly', () => {
    expect(paths.length).toBeGreaterThan(5);
    for (const path of paths) {
      // Four presses was the promise. Nothing may quietly become a questionnaire.
      expect(path.length, `${path.join(' > ')} takes too many presses`).toBeLessThanOrEqual(4);
    }
  });

  it('produces a form with at least one field on it', () => {
    for (const path of paths) {
      const fields = fieldsFromAnswers(path);
      expect(fields.length, `${path.join(' > ')} produced an empty form`).toBeGreaterThan(0);
    }
  });

  it('only produces field types the builder actually has', () => {
    for (const path of paths) {
      for (const field of fieldsFromAnswers(path)) {
        expect(FIELD_TYPES, `${field.type} is not a field type`).toContain(field.type);
      }
    }
  });

  it('never asks the same thing twice', () => {
    for (const path of paths) {
      const keys = fieldsFromAnswers(path).map((field) => field.key);
      expect(new Set(keys).size, `${path.join(' > ')} repeats a field`).toBe(keys.length);
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
    for (const path of paths) {
      for (const field of fieldsFromAnswers(path)) {
        expect(field.label['en-GB'], `${field.key} has no English label`).toBeTruthy();
        expect(field.label['sv-SE'], `${field.key} has no Swedish label`).toBeTruthy();
      }
    }
  });

  it('gives every choice field something to choose from', () => {
    const choices: WizardField[] = paths
      .flatMap((path) => fieldsFromAnswers(path))
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
    // And the run is over: nothing else to answer.
    expect(nextQuestion(answers)).toBeUndefined();
  });

  it('asks for a telephone number instead when that is how they reply', () => {
    const fields = fieldsFromAnswers(['contact', 'phone', 'message']);
    expect(fields.map((field) => field.key)).toEqual(['name', 'phone', 'message']);
  });
});

describe('walking a run', () => {
  it('reports the question in front of somebody', () => {
    expect(nextQuestion([])?.id).toBe('purpose');
    expect(nextQuestion(['contact'])?.id).toBe('contact-reply');
    expect(nextQuestion(['contact', 'email'])?.id).toBe('contact-message');
    expect(nextQuestion(['contact', 'email', 'message'])).toBeUndefined();
  });

  it('refuses an answer that is not on offer', () => {
    expect(() => fieldsFromAnswers(['contact', 'carrier-pigeon'])).toThrow(WizardError);
  });

  it('refuses to keep answering a run that has finished', () => {
    expect(() => fieldsFromAnswers(['contact', 'email', 'message', 'anything'])).toThrow(
      WizardError,
    );
  });
});
