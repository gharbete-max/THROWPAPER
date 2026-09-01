import { z } from 'zod';
import { LocalisedText } from '../api/common.js';
import { FormDefinition } from './definition.js';

/**
 * Prebuilt forms somebody can start from.
 *
 * These are **code, not database rows**. A template ships with the product, has to stay valid as
 * the field schema moves, and is reviewed like any other change — a seeded table would drift the
 * moment a field type gained a required property, and nothing would notice until an author picked
 * that template. `templates.test.ts` parses every one of them against `FormDefinition`, so a
 * schema change that breaks a template fails the build rather than a customer's afternoon.
 *
 * ## What is deliberately not here
 *
 * `CLAUDE.md` rule 8 and `SPEC-forms.md` §8: **no legal, clinical, tax or safety-critical
 * wording.** That rules out most of the categories a "template gallery" would otherwise reach
 * for — incident and accident reports, medical intake, consent and waiver forms, tax
 * declarations, contracts of employment. Those templates need a human who is accountable for the
 * words, and a plausible-looking one written here would be worse than none: somebody would send
 * it out.
 *
 * What is left is the operational middle: asking who is coming, what they thought, and how to get
 * back in touch. Every template below is a **starting point to be edited**, not a finished
 * document, and the gallery says so.
 */

export const TEMPLATE_SECTORS = [
  'events',
  'services',
  'education',
  'retail',
  'membership',
] as const;

export const TemplateSector = z.enum(TEMPLATE_SECTORS);
export type TemplateSector = z.infer<typeof TemplateSector>;

export const FormTemplate = z.object({
  id: z.string().min(1).max(64),
  sector: TemplateSector,
  name: LocalisedText,
  description: LocalisedText,
  definition: FormDefinition,
});

export type FormTemplate = z.infer<typeof FormTemplate>;

/** Shorthand, because every label in here is written twice. */
const t = (sv: string, en: string) => ({ 'sv-SE': sv, 'en-GB': en });

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'event-registration',
    sector: 'events',
    name: t('Anmälan till evenemang', 'Event registration'),
    description: t(
      'Namn, kontakt och matval. Passar möten, konferenser och middagar.',
      'Name, contact details and a meal choice. Suits meetings, conferences and dinners.',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'name',
          key: 'full_name',
          type: 'short_text',
          label: t('Namn', 'Name'),
          required: true,
        },
        {
          id: 'email',
          key: 'email',
          type: 'email',
          label: t('E-post', 'Email'),
          helpText: t('Hit skickas bekräftelsen.', 'The confirmation goes here.'),
          required: true,
        },
        {
          id: 'organisation',
          key: 'organisation',
          type: 'short_text',
          label: t('Organisation', 'Organisation'),
          required: false,
        },
        { id: 'page', key: 'page_two', type: 'page_break' },
        {
          id: 'meal',
          key: 'meal',
          type: 'single_select',
          label: t('Måltid', 'Meal'),
          required: true,
          appearance: 'cards',
          options: [
            { value: 'standard', label: t('Standard', 'Standard') },
            { value: 'vegetarian', label: t('Vegetariskt', 'Vegetarian') },
            { value: 'vegan', label: t('Veganskt', 'Vegan') },
          ],
        },
        {
          id: 'allergies',
          key: 'allergies',
          type: 'long_text',
          label: t(
            'Allergier eller annat vi bör veta',
            'Allergies or anything else we should know',
          ),
          required: false,
          rows: 3,
        },
        {
          id: 'guests',
          key: 'guests',
          type: 'number',
          label: t('Medföljande gäster', 'Accompanying guests'),
          required: false,
          min: 0,
          max: 10,
        },
      ],
      settings: {
        submitLabel: t('Anmäl mig', 'Register me'),
        confirmationMessage: t(
          'Tack för din anmälan. Vi ses snart.',
          'Thank you for registering. See you soon.',
        ),
      },
    }),
  },

  {
    id: 'contact-enquiry',
    sector: 'services',
    name: t('Kontaktformulär', 'Contact form'),
    description: t(
      'Den kortaste användbara formen: vem, hur vi når dig, och vad det gäller.',
      'The shortest useful form: who you are, how to reach you, and what it is about.',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'name',
          key: 'full_name',
          type: 'short_text',
          label: t('Namn', 'Name'),
          required: true,
        },
        { id: 'email', key: 'email', type: 'email', label: t('E-post', 'Email'), required: true },
        {
          id: 'phone',
          key: 'phone',
          type: 'phone',
          label: t('Telefon', 'Phone'),
          required: false,
        },
        {
          id: 'topic',
          key: 'topic',
          type: 'single_select',
          label: t('Vad gäller det?', 'What is it about?'),
          required: true,
          appearance: 'radio',
          options: [
            { value: 'quote', label: t('Offert', 'A quote') },
            { value: 'support', label: t('Support', 'Support') },
            { value: 'invoice', label: t('Faktura', 'An invoice') },
            { value: 'other', label: t('Annat', 'Something else') },
          ],
        },
        {
          id: 'message',
          key: 'message',
          type: 'long_text',
          label: t('Meddelande', 'Message'),
          required: true,
          rows: 6,
        },
      ],
      settings: {
        submitLabel: t('Skicka', 'Send'),
        confirmationMessage: t('Tack. Vi hör av oss.', 'Thank you. We will get back to you.'),
        // One enquiry per person per subject is normal; two is usually a double-click.
        duplicateControl: 'none',
      },
    }),
  },

  {
    id: 'customer-feedback',
    sector: 'retail',
    name: t('Kundenkät', 'Customer feedback'),
    description: t(
      'En betygsskala och plats för egna ord. Håll den kort — långa enkäter fylls inte i.',
      'A rating scale and room for their own words. Keep it short; long surveys go unanswered.',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'rating',
          key: 'rating',
          type: 'single_select',
          label: t('Hur blev det?', 'How did we do?'),
          required: true,
          // Buttons rather than a dropdown: a scale should be one tap, and visible all at once.
          appearance: 'buttons',
          options: [
            { value: '1', label: t('1 — dåligt', '1 — poor') },
            { value: '2', label: t('2', '2') },
            { value: '3', label: t('3', '3') },
            { value: '4', label: t('4', '4') },
            { value: '5', label: t('5 — utmärkt', '5 — excellent') },
          ],
        },
        {
          id: 'what',
          key: 'what_went_well',
          type: 'long_text',
          label: t('Vad fungerade bra?', 'What went well?'),
          required: false,
          rows: 3,
        },
        {
          id: 'improve',
          key: 'what_to_improve',
          type: 'long_text',
          label: t('Vad kan vi göra bättre?', 'What could we do better?'),
          required: false,
          rows: 3,
        },
        {
          id: 'contact_ok',
          key: 'may_contact',
          type: 'yes_no',
          label: t('Får vi höra av oss om ditt svar?', 'May we contact you about your answer?'),
          required: false,
          appearance: 'radio',
        },
        {
          id: 'email',
          key: 'email',
          type: 'email',
          label: t('E-post', 'Email'),
          helpText: t('Bara om vi får höra av oss.', 'Only if we may contact you.'),
          required: false,
        },
      ],
      settings: {
        submitLabel: t('Skicka svar', 'Send feedback'),
        confirmationMessage: t('Tack för att du tog dig tid.', 'Thank you for taking the time.'),
        duplicateControl: 'none',
      },
    }),
  },

  {
    id: 'course-signup',
    sector: 'education',
    name: t('Kursanmälan', 'Course sign-up'),
    description: t(
      'Deltagare, tillfälle och förkunskaper. Byt ut tillfällena mot dina egna.',
      'Who is coming, which session, and what they already know. Replace the sessions with yours.',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'name',
          key: 'full_name',
          type: 'short_text',
          label: t('Namn', 'Name'),
          required: true,
        },
        { id: 'email', key: 'email', type: 'email', label: t('E-post', 'Email'), required: true },
        {
          id: 'session',
          key: 'session',
          type: 'single_select',
          label: t('Vilket tillfälle?', 'Which session?'),
          helpText: t('Byt ut de här mot dina egna datum.', 'Replace these with your own dates.'),
          required: true,
          appearance: 'radio',
          options: [
            { value: 'morning', label: t('Förmiddag', 'Morning') },
            { value: 'afternoon', label: t('Eftermiddag', 'Afternoon') },
            { value: 'evening', label: t('Kväll', 'Evening') },
          ],
        },
        {
          id: 'level',
          key: 'experience',
          type: 'single_select',
          label: t('Förkunskaper', 'Experience'),
          required: false,
          appearance: 'radio',
          options: [
            { value: 'none', label: t('Nybörjare', 'Beginner') },
            { value: 'some', label: t('Har provat förut', 'Tried it before') },
            { value: 'confident', label: t('Van', 'Confident') },
          ],
        },
        {
          id: 'notes',
          key: 'notes',
          type: 'long_text',
          label: t('Något vi bör veta?', 'Anything we should know?'),
          required: false,
          rows: 3,
        },
      ],
      settings: {
        submitLabel: t('Anmäl mig', 'Sign me up'),
        confirmationMessage: t('Tack. Du är anmäld.', 'Thank you. You are signed up.'),
      },
    }),
  },

  {
    id: 'booking-request',
    sector: 'services',
    name: t('Bokningsförfrågan', 'Booking request'),
    description: t(
      'En förfrågan, inte en bokning — du bekräftar själv. Byt ut tiderna mot dina egna.',
      'A request, not a booking — you confirm it yourself. Replace the times with your own.',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'name',
          key: 'full_name',
          type: 'short_text',
          label: t('Namn', 'Name'),
          required: true,
        },
        { id: 'email', key: 'email', type: 'email', label: t('E-post', 'Email'), required: true },
        {
          id: 'phone',
          key: 'phone',
          type: 'phone',
          label: t('Telefon', 'Phone'),
          required: false,
        },
        {
          id: 'date',
          key: 'preferred_date',
          type: 'date',
          label: t('Önskat datum', 'Preferred date'),
          required: true,
        },
        {
          id: 'time',
          key: 'preferred_time',
          type: 'single_select',
          label: t('Önskad tid', 'Preferred time'),
          required: true,
          appearance: 'buttons',
          options: [
            { value: 'morning', label: t('Förmiddag', 'Morning') },
            { value: 'afternoon', label: t('Eftermiddag', 'Afternoon') },
            { value: 'evening', label: t('Kväll', 'Evening') },
          ],
        },
        {
          id: 'people',
          key: 'people',
          type: 'number',
          label: t('Antal personer', 'Number of people'),
          required: true,
          min: 1,
          max: 50,
        },
        {
          id: 'notes',
          key: 'notes',
          type: 'long_text',
          label: t('Övrigt', 'Anything else'),
          required: false,
          rows: 3,
        },
      ],
      settings: {
        submitLabel: t('Skicka förfrågan', 'Send request'),
        confirmationMessage: t(
          'Tack. Din förfrågan är mottagen — vi bekräftar tiden innan den gäller.',
          'Thank you. We have your request and will confirm the time before it is booked.',
        ),
      },
    }),
  },

  {
    id: 'member-details',
    sector: 'membership',
    name: t('Medlemsuppgifter', 'Member details'),
    description: t(
      'Uppdatera kontaktuppgifter och intressen. Lägg till det som gäller just er förening.',
      'Update contact details and interests. Add whatever applies to your organisation.',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'name',
          key: 'full_name',
          type: 'short_text',
          label: t('Namn', 'Name'),
          required: true,
        },
        { id: 'email', key: 'email', type: 'email', label: t('E-post', 'Email'), required: true },
        {
          id: 'phone',
          key: 'phone',
          type: 'phone',
          label: t('Telefon', 'Phone'),
          required: false,
        },
        {
          id: 'address',
          key: 'address',
          type: 'long_text',
          label: t('Adress', 'Address'),
          required: false,
          rows: 3,
        },
        {
          id: 'interests',
          key: 'interests',
          type: 'multi_select',
          label: t('Vad vill du höra om?', 'What would you like to hear about?'),
          required: false,
          appearance: 'checkboxes',
          options: [
            { value: 'events', label: t('Evenemang', 'Events') },
            { value: 'newsletter', label: t('Nyhetsbrev', 'Newsletter') },
            { value: 'volunteering', label: t('Ideellt arbete', 'Volunteering') },
          ],
        },
      ],
      settings: {
        submitLabel: t('Spara uppgifter', 'Save details'),
        confirmationMessage: t(
          'Tack. Uppgifterna är uppdaterade.',
          'Thank you. Your details are updated.',
        ),
      },
    }),
  },
];

export function findTemplate(id: string): FormTemplate | null {
  return FORM_TEMPLATES.find((template) => template.id === id) ?? null;
}
