import { z } from 'zod';
import {
  FIELD_TYPES,
  FormDefinition,
  SelectOption,
  type Field,
  type FieldType,
} from './definition.js';

/**
 * Reads a SurveyJS survey definition and produces one of ours.
 *
 * ## Why an importer and not an adoption
 *
 * `surveyjs/survey-library` is MIT, and the tempting move is to take the renderer. That would
 * replace a builder and renderer already translated into twelve languages, already server-rendered,
 * already carrying print CSS and a PDF path — with one that is none of those things. `docs/HANDOVER.md`
 * settled this: take the **question-type taxonomy as a checklist** and the **JSON schema as an
 * import target**, which is worth more to a catalogue than a rendering engine is.
 *
 * So nothing here is their code. This reads their document shape and writes ours. The only thing
 * borrowed is the shape of the JSON, which is a wire format rather than an implementation.
 *
 * ## What it refuses to guess
 *
 * Five of their question types have no equivalent here, and **inventing one would be worse than
 * reporting the gap**: a `matrix` flattened into a row of selects is not the question the author
 * wrote, and somebody would find that out after collecting answers. Those come back in `skipped`,
 * named, so the caller can say which questions did not survive rather than quietly producing a
 * shorter form.
 *
 * That list is also the honest gap analysis against their taxonomy, kept in executable form where
 * it cannot drift from what the code actually does:
 *
 * | theirs | ours | note |
 * |---|---|---|
 * | `text` (+ `inputType`) | `short_text`, `email`, `phone`, `number`, `date`, `time` | one type of ours per input type of theirs; `url` stays `short_text`, since our `link` is presentational |
 * | `comment` | `long_text` | |
 * | `boolean` | `yes_no` | |
 * | `radiogroup`, `dropdown`, `buttongroup`, `imagepicker` | `single_select` | their four are our one plus an appearance |
 * | `checkbox`, `tagbox` | `multi_select` | |
 * | `rating`, `slider` | `rating` | |
 * | `file`, `signaturepad`, `image`, `html` | `file`, `signature`, `image`, `rich_text` | |
 * | `matrix`, `matrixdropdown`, `matrixdynamic` | — | a grid of questions; no equivalent |
 * | `paneldynamic` | — | a repeating group; no equivalent |
 * | `ranking` | — | ordering an answer; no equivalent |
 * | `expression` | — | a computed value; `packages/calc` could back one |
 * | `multipletext` | — | several inputs under one label |
 *
 * Adding any of the five is a change to `FIELD_TYPES`, which that file calls "a scope change, not a
 * detail" — so this reports them and does not decide them.
 */

/**
 * Their document, read loosely on purpose.
 *
 * `passthrough` and a wide `unknown` for each element: a survey exported from their builder carries
 * dozens of properties this does not read, and a strict schema would reject a perfectly good file
 * over a styling property. The narrowing happens per question type below, where it can produce a
 * useful message instead of a parse error the author cannot act on.
 */
const SurveyElement = z.object({ type: z.string().optional() }).passthrough();
const SurveyPage = z.object({ elements: z.array(SurveyElement).optional() }).passthrough();

export const SurveyJson = z
  .object({
    title: z.unknown().optional(),
    pages: z.array(SurveyPage).optional(),
    /** A survey with no pages may put its questions at the top level. Both shapes are real. */
    elements: z.array(SurveyElement).optional(),
  })
  .passthrough();

export interface SkippedQuestion {
  /** Their type, verbatim, so the message can name what was in the file. */
  type: string;
  /** Their `name`, which is what the author will recognise. */
  name: string;
  reason: 'no-equivalent' | 'unknown-type' | 'unreadable' | 'needs-asset';
}

export interface SurveyImport {
  definition: FormDefinition;
  skipped: SkippedQuestion[];
}

/** Their types we understand, mapped to ours. `text` is handled separately — it carries a subtype. */
const DIRECT: Record<string, FieldType> = {
  comment: 'long_text',
  boolean: 'yes_no',
  radiogroup: 'single_select',
  dropdown: 'single_select',
  buttongroup: 'single_select',
  imagepicker: 'single_select',
  checkbox: 'multi_select',
  tagbox: 'multi_select',
  rating: 'rating',
  slider: 'rating',
  file: 'file',
  signaturepad: 'signature',
  html: 'rich_text',
};

/** How their four single-select flavours are drawn here. Presentation only; the answer is the same. */
const SELECT_APPEARANCE: Record<string, string> = {
  radiogroup: 'radio',
  dropdown: 'dropdown',
  buttongroup: 'buttons',
  imagepicker: 'cards',
  checkbox: 'checkboxes',
  /* Their tagbox is a multi-select dropdown; ours has no dropdown appearance, so it draws as
     checkboxes. Presentation only — the answer stored is identical either way. */
  tagbox: 'checkboxes',
};

/** `text` is one type of theirs and seven of ours, told apart by `inputType`. */
const TEXT_INPUT: Record<string, FieldType> = {
  email: 'email',
  tel: 'phone',
  number: 'number',
  range: 'number',
  date: 'date',
  'datetime-local': 'date',
  month: 'date',
  week: 'date',
  time: 'time',
  /*
   * `url` stays a text box. Our `link` is **presentational** — a link the author places in the
   * form for somebody to read, listed in `PRESENTATIONAL_TYPES` and carrying a required `href`.
   * Their `inputType: "url"` is the opposite: a box a respondent types into. Mapping one to the
   * other would turn a question into decoration and silently drop the answer.
   */
};

/** Their types we understand and deliberately cannot represent. See the table above. */
const NO_EQUIVALENT = new Set([
  'matrix',
  'matrixdropdown',
  'matrixdynamic',
  'paneldynamic',
  'ranking',
  'expression',
  'multipletext',
]);

/**
 * Their titles are a string, or an object keyed by locale with `default` for the fallback.
 *
 * Ours is `LocalisedText`, keyed by BCP 47. `default` becomes `en-GB` because that is this
 * product's fallback in every chain — see `apps/forms/src/lib/messages/index.ts`. A two-letter key
 * of theirs (`de`) is widened to the tag we use (`de-DE`), since a catalogue keyed `de` would never
 * match a form rendered in `de-DE`.
 */
const LOCALE_WIDENING: Record<string, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
  da: 'da-DK',
  no: 'nb-NO',
  nb: 'nb-NO',
  fi: 'fi-FI',
  is: 'is-IS',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ru: 'ru-RU',
};

/**
 * Their `html` question is markup; our `rich_text` is deliberately not.
 *
 * Tags are removed rather than escaped, and the entities that actually appear in prose are decoded
 * so `&amp;` does not survive as literal text. Block-level tags become a paragraph break, because
 * a heading and the sentence under it running together is a different document.
 */
function stripTags(markup: string): string {
  return markup
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function localise(value: unknown): Record<string, string> | undefined {
  if (typeof value === 'string') return value.trim() ? { 'en-GB': value } : undefined;
  if (!value || typeof value !== 'object') return undefined;

  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text !== 'string' || !text.trim()) continue;
    const locale = key === 'default' ? 'en-GB' : (LOCALE_WIDENING[key] ?? key);
    out[locale] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Their `name` is a free string; our `key` is `^[a-z][a-z0-9_]*$` and is what a CSV column is
 * called. Sanitised rather than rejected, because a name is the author's word for the question and
 * refusing the import over punctuation would be pedantry.
 *
 * Collisions are resolved by suffix rather than by dropping a question: two questions named
 * "Name (first)" and "Name (last)" both sanitise to `name`, and losing the second would lose an
 * answer. `taken` carries across the whole survey, so a repeat on a later page is caught too.
 */
function toKey(name: unknown, index: number, taken: Set<string>): string {
  const raw = typeof name === 'string' ? name : '';
  let key = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  if (!/^[a-z]/.test(key)) key = `field_${key}`;
  key = key.slice(0, 60) || `field_${index + 1}`;

  let candidate = key;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${key}_${suffix++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Their choices are `"Yes"`, or `{ value, text }`. Both are common in one file.
 *
 * A choice with no usable label is dropped rather than given its value as a label: the label is
 * what a respondent reads and what the export writes, and `item_3` is not an answer anybody meant.
 */
function toOptions(raw: unknown): Array<z.infer<typeof SelectOption>> {
  if (!Array.isArray(raw)) return [];

  const options: Array<z.infer<typeof SelectOption>> = [];
  for (const choice of raw) {
    if (typeof choice === 'string' || typeof choice === 'number') {
      const text = String(choice);
      if (!text.trim()) continue;
      options.push({ value: text.slice(0, 128), label: { 'en-GB': text }, image: null });
      continue;
    }
    if (!choice || typeof choice !== 'object') continue;

    const item = choice as Record<string, unknown>;
    const label = localise(item['text']) ?? localise(item['value']);
    if (!label) continue;
    const value = String(item['value'] ?? Object.values(label)[0] ?? '').slice(0, 128);
    if (!value) continue;
    options.push({ value, label, image: null });
  }
  return options;
}

/**
 * Reads a SurveyJS survey and returns ours, plus what did not survive.
 *
 * Never throws for content reasons. An import is something an author runs on a file they did not
 * write, and a stack trace is not an answer — an unreadable question is reported as `unreadable`
 * and the rest of the form still arrives. The one thing that does throw is a document that is not
 * a survey at all, which `SurveyJson.parse` reports.
 */
export function importSurveyJson(input: unknown): SurveyImport {
  const survey = SurveyJson.parse(input);
  const skipped: SkippedQuestion[] = [];
  const fields: Field[] = [];
  const taken = new Set<string>();

  /** Pages become `page_break`s between their questions — the closest true equivalent we have. */
  const pages = survey.pages ?? (survey.elements ? [{ elements: survey.elements }] : []);

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      /*
       * `page_break` is `{ id, key, type }` and nothing else — no label, no width. Passing more
       * is not an error, it is worse: Zod strips the extras silently, so the field arrives
       * label-less and the mistake shows up as a blank row in the builder rather than as a parse
       * failure here. Found by importing a real survey, not by reading the schema.
       */
      fields.push({
        id: `imported_page_${pageIndex}`,
        key: toKey(`page_${pageIndex + 1}`, fields.length, taken),
        type: 'page_break',
      } as Field);
    }

    for (const element of page.elements ?? []) {
      const item = element as Record<string, unknown>;
      const type = typeof item['type'] === 'string' ? item['type'] : '';
      const name = typeof item['name'] === 'string' ? item['name'] : '';

      if (NO_EQUIVALENT.has(type)) {
        skipped.push({ type, name, reason: 'no-equivalent' });
        continue;
      }

      /*
       * Their `image` carries an `imageLink` pointing anywhere on the web; ours carries an
       * `AssetPath` into this organisation's own store. Importing one would mean fetching a
       * remote file at import time and re-hosting it — a network call, an upload and a size
       * limit, none of which belong in a pure function that reads a document. Reported rather
       * than half-done.
       */
      if (type === 'image') {
        skipped.push({ type, name, reason: 'needs-asset' });
        continue;
      }

      const mapped =
        type === 'text'
          ? (TEXT_INPUT[String(item['inputType'] ?? '')] ?? 'short_text')
          : DIRECT[type];

      if (!mapped || !FIELD_TYPES.includes(mapped)) {
        skipped.push({ type: type || '(none)', name, reason: 'unknown-type' });
        continue;
      }

      /*
       * `rich_text` holds `content`, not `label`, and its schema says why: "Plain text with
       * paragraph breaks. Not HTML — that would be a stored-XSS surface." Their `html` question is
       * markup, so the tags come off rather than riding in through an importer. The same rule the
       * field was built around applies to text arriving from a file somebody else wrote.
       */
      if (mapped === 'rich_text') {
        const markup = item['html'];
        const text = localise(typeof markup === 'string' ? stripTags(markup) : markup);
        if (!text) {
          skipped.push({ type, name, reason: 'unreadable' });
          continue;
        }
        fields.push({
          id: `imported_${fields.length + 1}`,
          key: toKey(name || 'text', fields.length, taken),
          type: 'rich_text',
          content: text,
          width: 'full',
        } as Field);
        continue;
      }

      const label = localise(item['title']) ?? localise(item['name']);
      if (!label) {
        /* Every field here carries a label, and a question nobody can read is not importable. */
        skipped.push({ type, name, reason: 'unreadable' });
        continue;
      }

      const field: Record<string, unknown> = {
        id: `imported_${fields.length + 1}`,
        key: toKey(name || label['en-GB'], fields.length, taken),
        type: mapped,
        label,
        required: item['isRequired'] === true,
        width: 'full',
      };

      const help = localise(item['description']);
      if (help) field['helpText'] = help;
      const placeholder = localise(item['placeholder'] ?? item['placeHolder']);
      if (placeholder) field['placeholder'] = placeholder;

      if (mapped === 'single_select' || mapped === 'multi_select') {
        const options = toOptions(item['choices']);
        /* A choice question with no readable choices is not a choice question. */
        if (options.length === 0) {
          skipped.push({ type, name, reason: 'unreadable' });
          continue;
        }
        field['options'] = options;
        const appearance = SELECT_APPEARANCE[type];
        if (appearance) field['appearance'] = appearance;
      }

      if (mapped === 'rating') {
        const max = Number(item['rateMax'] ?? item['max']);
        if (Number.isFinite(max) && max >= 2 && max <= 10) field['max'] = Math.round(max);
      }

      fields.push(field as Field);
    }
  });

  /*
   * Parsed rather than cast, so an import cannot produce a definition the builder would refuse to
   * open. If a mapping above is wrong, this is where it is caught — in the importer's own tests
   * rather than in somebody's form.
   */
  const definition = FormDefinition.parse({ schemaVersion: 1, fields, settings: {} });
  return { definition, skipped };
}
