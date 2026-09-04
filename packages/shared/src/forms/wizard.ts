import type { FieldType } from './definition.js';

/**
 * Building a form by ruling things out, instead of by filling a form in.
 *
 * ## The problem this solves
 *
 * A blank builder with seventeen field types is a fair tool for somebody who makes forms weekly and
 * a wall for somebody who makes one a year. The audience here is the second person: a membership
 * secretary, a volunteer treasurer, somebody who was handed the job in March. They know exactly
 * what they want and nothing about how to express it in fields.
 *
 * So nobody starts from nothing. A short run of narrow questions, each answered by pressing one of
 * two or three buttons, and the form falls out of the answers:
 *
 *     What is this for?  ->  Getting in touch
 *     How should people reach you?  ->  Email
 *     What do they write?  ->  One message
 *     -> Name, Email, Message, Send
 *
 * Four presses and no typing. The builder is still there afterwards for anybody who wants it; this
 * decides what it opens with.
 *
 * ## Why the questions are data
 *
 * Because they are content, not logic. A question written in a component is a question that has to
 * be translated by editing a component, and a branch written as an `if` is a branch nobody can see
 * the shape of. Here the whole tree is one value: it can be walked, counted, tested for dead ends,
 * and rendered by something that knows nothing about what any particular question means.
 *
 * ## What an answer is allowed to do
 *
 * Add fields, and choose the next question. That is the entire vocabulary. It is deliberately
 * smaller than "run arbitrary code per answer", because the useful property of this tree is that
 * every path through it can be enumerated — which is what makes it testable, and what stops it
 * quietly growing into a second form builder.
 */

/** A field the wizard can put on a form, in the shape the builder already understands. */
export interface WizardField {
  readonly type: FieldType;
  readonly key: string;
  readonly label: Record<string, string>;
  readonly required?: boolean;
  readonly help?: Record<string, string>;
  /** For choice fields: the options, localised. */
  readonly options?: readonly { readonly value: string; readonly label: Record<string, string> }[];
}

export interface WizardOption {
  readonly id: string;
  readonly label: Record<string, string>;
  /** A sentence of consequence, so somebody can tell the buttons apart without pressing them. */
  readonly detail?: Record<string, string>;
  /** Fields this answer contributes, in order. */
  readonly fields?: readonly WizardField[];
  /** The next question, or nothing to finish here. */
  readonly next?: string;
}

export interface WizardQuestion {
  readonly id: string;
  readonly prompt: Record<string, string>;
  readonly options: readonly WizardOption[];
}

const sv = (en: string, svText: string) => ({ 'en-GB': en, 'sv-SE': svText });

/**
 * The questions.
 *
 * Two to four options each, never more. A question with six buttons is a menu, and a menu is the
 * thing this exists to avoid — past about four, people stop reading and start scanning, which is
 * where a wrong answer comes from.
 */
export const WIZARD_QUESTIONS: readonly WizardQuestion[] = [
  {
    id: 'purpose',
    prompt: sv('What is this form for?', 'Vad ska formuläret användas till?'),
    options: [
      {
        id: 'contact',
        label: sv('Getting in touch', 'Kontakta oss'),
        detail: sv('People send you a message.', 'Folk skickar ett meddelande.'),
        next: 'contact-reply',
      },
      {
        id: 'signup',
        label: sv('Signing up for something', 'Anmälan'),
        detail: sv('A meeting, a course, an event.', 'Ett möte, en kurs, ett evenemang.'),
        fields: [
          {
            type: 'short_text',
            key: 'name',
            label: sv('Name', 'Namn'),
            required: true,
          },
          {
            type: 'email',
            key: 'email',
            label: sv('Email address', 'E-postadress'),
            required: true,
          },
        ],
        next: 'signup-extras',
      },
      {
        id: 'collect',
        label: sv('Collecting information', 'Samla in uppgifter'),
        detail: sv('Updating what you hold on people.', 'Uppdatera uppgifter om medlemmar.'),
        fields: [
          { type: 'short_text', key: 'name', label: sv('Name', 'Namn'), required: true },
          { type: 'email', key: 'email', label: sv('Email address', 'E-postadress') },
        ],
        next: 'collect-what',
      },
    ],
  },

  {
    id: 'contact-reply',
    prompt: sv('How should you reply to them?', 'Hur ska ni svara dem?'),
    options: [
      {
        id: 'email',
        label: sv('By email', 'Med e-post'),
        fields: [
          { type: 'short_text', key: 'name', label: sv('Name', 'Namn'), required: true },
          {
            type: 'email',
            key: 'email',
            label: sv('Email address', 'E-postadress'),
            required: true,
          },
        ],
        next: 'contact-message',
      },
      {
        id: 'phone',
        label: sv('By telephone', 'Per telefon'),
        fields: [
          { type: 'short_text', key: 'name', label: sv('Name', 'Namn'), required: true },
          { type: 'phone', key: 'phone', label: sv('Telephone', 'Telefon'), required: true },
        ],
        next: 'contact-message',
      },
      {
        id: 'either',
        label: sv('Either, let them choose', 'Låt dem välja'),
        fields: [
          { type: 'short_text', key: 'name', label: sv('Name', 'Namn'), required: true },
          { type: 'email', key: 'email', label: sv('Email address', 'E-postadress') },
          { type: 'phone', key: 'phone', label: sv('Telephone', 'Telefon') },
        ],
        next: 'contact-message',
      },
    ],
  },

  {
    id: 'contact-message',
    prompt: sv('What do they write?', 'Vad skriver de?'),
    options: [
      {
        id: 'message',
        label: sv('One message', 'Ett meddelande'),
        detail: sv('A single box. Nothing else to fill in.', 'En ruta. Inget mer att fylla i.'),
        fields: [
          {
            type: 'long_text',
            key: 'message',
            label: sv('Message', 'Meddelande'),
            required: true,
          },
        ],
      },
      {
        id: 'subject',
        label: sv('A subject and a message', 'Ämne och meddelande'),
        fields: [
          { type: 'short_text', key: 'subject', label: sv('Subject', 'Ämne'), required: true },
          {
            type: 'long_text',
            key: 'message',
            label: sv('Message', 'Meddelande'),
            required: true,
          },
        ],
      },
      {
        id: 'topic',
        label: sv('Pick a topic, then a message', 'Välj ämnesområde, sedan meddelande'),
        detail: sv('Sends it to the right person.', 'Skickar till rätt person.'),
        fields: [
          {
            type: 'single_select',
            key: 'topic',
            label: sv('What is it about?', 'Vad gäller det?'),
            required: true,
            options: [
              { value: 'membership', label: sv('Membership', 'Medlemskap') },
              { value: 'billing', label: sv('Invoices and payments', 'Fakturor och betalningar') },
              { value: 'other', label: sv('Something else', 'Något annat') },
            ],
          },
          {
            type: 'long_text',
            key: 'message',
            label: sv('Message', 'Meddelande'),
            required: true,
          },
        ],
      },
    ],
  },

  {
    id: 'signup-extras',
    prompt: sv('Anything else you need from them?', 'Behöver ni något mer?'),
    options: [
      {
        id: 'nothing',
        label: sv('Nothing else', 'Inget mer'),
        detail: sv('Name and email is enough.', 'Namn och e-post räcker.'),
      },
      {
        id: 'dietary',
        label: sv('What they eat', 'Specialkost'),
        detail: sv('For anything with food.', 'För allt med mat.'),
        fields: [
          {
            type: 'single_select',
            key: 'meal',
            label: sv('Meal', 'Måltid'),
            required: true,
            options: [
              { value: 'standard', label: sv('Standard', 'Standard') },
              { value: 'vegetarian', label: sv('Vegetarian', 'Vegetarisk') },
              { value: 'vegan', label: sv('Vegan', 'Vegansk') },
              { value: 'gluten-free', label: sv('Gluten free', 'Glutenfri') },
            ],
          },
        ],
      },
      {
        id: 'guests',
        label: sv('Whether they bring anyone', 'Om de tar med gäster'),
        fields: [
          {
            type: 'number',
            key: 'guests',
            label: sv('Accompanying guests', 'Medföljande gäster'),
          },
        ],
      },
      {
        id: 'both',
        label: sv('Both of those', 'Båda'),
        fields: [
          {
            type: 'single_select',
            key: 'meal',
            label: sv('Meal', 'Måltid'),
            required: true,
            options: [
              { value: 'standard', label: sv('Standard', 'Standard') },
              { value: 'vegetarian', label: sv('Vegetarian', 'Vegetarisk') },
              { value: 'vegan', label: sv('Vegan', 'Vegansk') },
              { value: 'gluten-free', label: sv('Gluten free', 'Glutenfri') },
            ],
          },
          {
            type: 'number',
            key: 'guests',
            label: sv('Accompanying guests', 'Medföljande gäster'),
          },
        ],
      },
    ],
  },

  {
    id: 'collect-what',
    prompt: sv('What are you updating?', 'Vad vill ni uppdatera?'),
    options: [
      {
        id: 'address',
        label: sv('Where they live', 'Adress'),
        fields: [
          { type: 'short_text', key: 'address', label: sv('Address', 'Adress'), required: true },
          {
            type: 'short_text',
            key: 'postcode',
            label: sv('Postcode', 'Postnummer'),
            required: true,
          },
          { type: 'short_text', key: 'city', label: sv('Town or city', 'Ort'), required: true },
        ],
      },
      {
        id: 'contact',
        label: sv('How to reach them', 'Kontaktuppgifter'),
        fields: [{ type: 'phone', key: 'phone', label: sv('Telephone', 'Telefon') }],
      },
      {
        id: 'consent',
        label: sv('What they agree to', 'Samtycken'),
        detail: sv('Newsletters, photographs, the members list.', 'Utskick, foton, medlemslistan.'),
        fields: [
          {
            type: 'yes_no',
            key: 'newsletter',
            label: sv('Send me the newsletter', 'Skicka nyhetsbrevet till mig'),
          },
          {
            type: 'yes_no',
            key: 'photos',
            label: sv('Photographs of me may be published', 'Foton på mig får publiceras'),
          },
        ],
      },
    ],
  },
];

const BY_ID = new Map(WIZARD_QUESTIONS.map((question) => [question.id, question]));

/** Where every run starts. */
export const FIRST_QUESTION = 'purpose';

export function wizardQuestion(id: string): WizardQuestion | undefined {
  return BY_ID.get(id);
}

export class WizardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WizardError';
  }
}

/**
 * Walk a run of answers and collect the fields.
 *
 * Answers are option ids in the order they were pressed. Duplicated keys are dropped rather than
 * repeated: two branches can both ask for an email address, and a form with two email boxes on it
 * is a form somebody fills in twice and then queries.
 */
export function fieldsFromAnswers(answers: readonly string[]): readonly WizardField[] {
  const fields: WizardField[] = [];
  const seen = new Set<string>();

  let questionId: string | undefined = FIRST_QUESTION;

  for (const answer of answers) {
    if (!questionId) throw new WizardError('The run already finished; there is nothing to answer');

    const question = BY_ID.get(questionId);
    if (!question) throw new WizardError(`No question ${questionId}`);

    const option = question.options.find((candidate) => candidate.id === answer);
    if (!option) throw new WizardError(`${answer} is not an answer to ${questionId}`);

    for (const field of option.fields ?? []) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      fields.push(field);
    }

    questionId = option.next;
  }

  return fields;
}

/** The question a run is currently on, or nothing when it has finished. */
export function nextQuestion(answers: readonly string[]): WizardQuestion | undefined {
  let questionId: string | undefined = FIRST_QUESTION;

  for (const answer of answers) {
    const question: WizardQuestion | undefined = questionId ? BY_ID.get(questionId) : undefined;
    if (!question) return undefined;
    questionId = question.options.find((candidate) => candidate.id === answer)?.next;
  }

  return questionId ? BY_ID.get(questionId) : undefined;
}
