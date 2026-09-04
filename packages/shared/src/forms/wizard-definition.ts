import { FormDefinition, emptyDefinition, type FieldWidth } from './definition.js';
import { FORM_WIZARD, fieldsFromAnswers, type WizardField } from './wizard.js';

/**
 * A run of answers, turned into a form the builder can open.
 *
 * ## Why the server does this, from the answers
 *
 * The client sends what somebody pressed — `["contact", "email", "message"]` — not the fields those
 * presses produce. Three reasons, in order of how much they matter:
 *
 * 1. What an answer produces is not the client's to decide. A posted list of fields is a posted
 *    list of fields, and "the wizard made me do it" is not a claim a server can check.
 * 2. The answers are a better record. "This form came from contact / email / one message" is
 *    something a person can read a year later; a serialised field array is not.
 * 3. It is smaller, and it stays correct when the tree gains a question — an old client's answers
 *    still resolve, because resolution happens where the tree lives.
 *
 * ## What it does not do
 *
 * Anything the builder can already do. No conditions, no pages, no validation rules. The wizard
 * decides which fields exist and stops; everything after that is editing, and the editor is where
 * editing happens. Keeping that line is what stops this growing into a second builder with a worse
 * interface.
 */

export class WizardDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WizardDefinitionError';
  }
}

/**
 * A stable id for a field the wizard produced.
 *
 * Derived from the key rather than random, so the same answers give the same document. That makes
 * the whole path reproducible: a bug report saying "contact, email, message" is something anybody
 * can run.
 */
const idFor = (field: WizardField) => `w-${field.key}`;

/**
 * Fields the wizard offers that need more than a label to be valid.
 *
 * A choice field with no options fails the schema, and it should: a dropdown with nothing in it is
 * not a smaller version of a working field, it is a broken one.
 */
function optionsFor(field: WizardField) {
  if (field.type !== 'single_select' && field.type !== 'multi_select') return {};

  if (!field.options || field.options.length === 0) {
    throw new WizardDefinitionError(
      `The wizard offered ${field.key} as a choice with nothing to choose from`,
    );
  }
  return { options: field.options.map((option) => ({ value: option.value, label: option.label })) };
}

/**
 * How wide a field sits.
 *
 * A message box wants the row to itself; a name and an email address read as a pair. This is the
 * one piece of layout the wizard decides, because leaving every field full width produces a column
 * of boxes that looks nothing like the form somebody imagined.
 */
function widthFor(field: WizardField): FieldWidth {
  if (field.type === 'long_text') return 'full';
  return field.key === 'name' || field.key === 'email' || field.key === 'phone' ? 'half' : 'full';
}

export function definitionFromAnswers(answers: readonly string[]) {
  const fields = fieldsFromAnswers(answers);

  if (fields.length === 0) {
    throw new WizardDefinitionError('That run produced no fields, so there is no form to make');
  }

  return FormDefinition.parse({
    ...emptyDefinition,
    fields: fields.map((field) => ({
      id: idFor(field),
      key: field.key,
      type: field.type,
      label: field.label,
      required: field.required ?? false,
      width: widthFor(field),
      ...(field.help ? { helpText: field.help } : {}),
      ...optionsFor(field),
    })),
  });
}

/** Whether a run of answers is one this tree could have produced. */
export function isWizardRun(answers: readonly string[]): boolean {
  try {
    fieldsFromAnswers(answers);
    return true;
  } catch {
    return false;
  }
}

export { FORM_WIZARD };
