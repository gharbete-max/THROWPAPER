import type { FieldType } from './definition.js';
import type { WizardQuestion, WizardTree } from '../wizard/tree.js';
import { collect, currentQuestion, questionById } from '../wizard/tree.js';

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
 * ## The questions are data, and the walk is somebody else's
 *
 * The tree structure lives in `wizard/tree.ts` and is shared with every other place that starts
 * something this way. This file is only the questions and the fields they produce — which is the
 * part that is about forms, and the only part that should be.
 *
 * See that module for why an answer may do exactly two things and no more.
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

const sv = (en: string, svText: string) => ({ 'en-GB': en, 'sv-SE': svText });

/**
 * The questions.
 *
 * Two to four options each, never more. A question with six buttons is a menu, and a menu is the
 * thing this exists to avoid — past about four, people stop reading and start scanning, which is
 * where a wrong answer comes from.
 */
const WIZARD_QUESTIONS: readonly WizardQuestion<WizardField>[] = [
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
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [
          { type: 'short_text', key: 'name', label: sv('Name', 'Namn'), required: true },
          { type: 'phone', key: 'phone', label: sv('Telephone', 'Telefon'), required: true },
        ],
        next: 'contact-message',
      },
      {
        id: 'either',
        label: sv('Either, let them choose', 'Låt dem välja'),
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [
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
        contributes: [{ type: 'phone', key: 'phone', label: sv('Telephone', 'Telefon') }],
      },
      {
        id: 'consent',
        label: sv('What they agree to', 'Samtycken'),
        detail: sv('Newsletters, photographs, the members list.', 'Utskick, foton, medlemslistan.'),
        contributes: [
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

/**
 * The form tree.
 *
 * `keyOf` is the field key, so two branches that both ask for an email address contribute one box
 * rather than two.
 */
export const FORM_WIZARD: WizardTree<WizardField> = {
  id: 'form',
  first: 'purpose',
  questions: WIZARD_QUESTIONS,
  keyOf: (field) => field.key,
};

/** Where every run starts. Kept as a name because screens read better for it. */
export const FIRST_QUESTION = FORM_WIZARD.first;

export function wizardQuestion(id: string): WizardQuestion<WizardField> | undefined {
  return questionById(FORM_WIZARD, id);
}

/** The fields a run of answers produces. */
export function fieldsFromAnswers(answers: readonly string[]): readonly WizardField[] {
  return collect(FORM_WIZARD, answers);
}

/** The question in front of somebody, or nothing when the run has finished. */
export function nextQuestion(answers: readonly string[]): WizardQuestion<WizardField> | undefined {
  return currentQuestion(FORM_WIZARD, answers);
}
