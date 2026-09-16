import { z } from 'zod';
import {
  FIELD_TYPES,
  MAX_GROUP_ENTRIES,
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
 * | `paneldynamic` | `repeating_group` | needs their `maxPanelCount`; see `mapPanel` |
 * | `ranking` | — | ordering an answer; no equivalent |
 * | `expression` | — | a computed value; `packages/calc` could back one |
 * | `multipletext` | — | several inputs under one label |
 *
 * Adding any of the four remaining is a change to `FIELD_TYPES`, which that file calls "a scope
 * change, not a detail" — so this reports them and does not decide them.
 *
 * `paneldynamic` used to be a fifth. It was the one this module's own notes called "the one that
 * looks most relevant to this product", and the repeating group built in the phase after this one
 * is what makes it importable.
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
  reason:
    | 'no-equivalent'
    | 'unknown-type'
    | 'unreadable'
    | 'needs-asset'
    /** A panel inside a panel. Ours are one level deep — see `docs/adr/0003-repeating-groups.md`. */
    | 'nested-group'
    /** A `paneldynamic` with no `maxPanelCount`. Ours requires one; see `mapPanel`. */
    | 'needs-limit';
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
      const outcome = mapQuestion(element, fields.length, taken, { insideGroup: false });
      if (outcome.skipped) {
        skipped.push(outcome.skipped);
        continue;
      }
      if (!outcome.field) continue;

      /*
       * A `paneldynamic` becomes a repeating group, which needs its children mapped too.
       *
       * Their children go through the **same** mapper, with `insideGroup` set — so a question
       * behaves the same way inside a panel as outside one, and the two things a group may not
       * contain (another group, a page break) are refused in one place rather than two.
       */
      if (outcome.field['type'] === 'repeating_group') {
        const template = Array.isArray(
          element ? (element as Record<string, unknown>)['templateElements'] : null,
        )
          ? ((element as Record<string, unknown>)['templateElements'] as unknown[])
          : [];

        const childTaken = new Set<string>();
        const children: Field[] = [];
        for (const child of template) {
          const mapped = mapQuestion(child, children.length, childTaken, { insideGroup: true });
          if (mapped.skipped) {
            skipped.push(mapped.skipped);
            continue;
          }
          if (mapped.field) children.push(mapped.field as Field);
        }

        /*
         * A panel whose every question was skipped is not an empty panel — it is a panel we could
         * not read. `fields` requires at least one child, so importing it would fail the parse at
         * the bottom of this function and take the whole form with it.
         */
        if (children.length === 0) {
          skipped.push({
            type: 'paneldynamic',
            name: String((element as Record<string, unknown>)['name'] ?? ''),
            reason: 'unreadable',
          });
          taken.delete(String(outcome.field['key']));
          continue;
        }

        outcome.field['fields'] = children;
      }

      fields.push(outcome.field as Field);
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

/**
 * One of their questions, as one of ours — or the reason it could not be.
 *
 * Extracted from the page loop when `paneldynamic` became importable, because a panel's children
 * are questions in exactly the same sense as a page's. Two copies of this mapping would be two
 * copies that stop agreeing, and the one inside the panel is the one fewer people would look at.
 */
function mapQuestion(
  element: unknown,
  position: number,
  taken: Set<string>,
  context: { insideGroup: boolean },
): { field?: Record<string, unknown>; skipped?: SkippedQuestion } {
  const item = (element ?? {}) as Record<string, unknown>;
  const type = typeof item['type'] === 'string' ? item['type'] : '';
  const name = typeof item['name'] === 'string' ? item['name'] : '';

  /*
   * A group may not contain a group. Refused here rather than left to the schema, so the report
   * says *why* — `nested-group` is a fact about their document, where a Zod error would be a fact
   * about ours. See `docs/adr/0003-repeating-groups.md` for why nesting is refused at all.
   */
  if (context.insideGroup && type === 'paneldynamic') {
    return { skipped: { type, name, reason: 'nested-group' } };
  }

  if (type === 'paneldynamic') return mapPanel(item, position, taken);

  if (NO_EQUIVALENT.has(type)) return { skipped: { type, name, reason: 'no-equivalent' } };

  /*
   * Their `image` carries an `imageLink` pointing anywhere on the web; ours carries an
   * `AssetPath` into this organisation's own store. Importing one would mean fetching a
   * remote file at import time and re-hosting it — a network call, an upload and a size
   * limit, none of which belong in a pure function that reads a document. Reported rather
   * than half-done.
   */
  if (type === 'image') return { skipped: { type, name, reason: 'needs-asset' } };

  const mapped =
    type === 'text' ? (TEXT_INPUT[String(item['inputType'] ?? '')] ?? 'short_text') : DIRECT[type];

  if (!mapped || !FIELD_TYPES.includes(mapped)) {
    return { skipped: { type: type || '(none)', name, reason: 'unknown-type' } };
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
    if (!text) return { skipped: { type, name, reason: 'unreadable' } };
    return {
      field: {
        id: `imported_${position + 1}`,
        key: toKey(name || 'text', position, taken),
        type: 'rich_text',
        content: text,
        width: 'full',
      },
    };
  }

  const label = localise(item['title']) ?? localise(item['name']);
  /* Every field here carries a label, and a question nobody can read is not importable. */
  if (!label) return { skipped: { type, name, reason: 'unreadable' } };

  const field: Record<string, unknown> = {
    id: `imported_${position + 1}`,
    key: toKey(name || label['en-GB'], position, taken),
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
    if (options.length === 0) return { skipped: { type, name, reason: 'unreadable' } };
    field['options'] = options;
    const appearance = SELECT_APPEARANCE[type];
    if (appearance) field['appearance'] = appearance;
  }

  if (mapped === 'rating') {
    const max = Number(item['rateMax'] ?? item['max']);
    if (Number.isFinite(max) && max >= 2 && max <= 10) field['max'] = Math.round(max);
  }

  return { field };
}

/**
 * Their `paneldynamic` as our repeating group — the one type this importer used to report as
 * having no equivalent, and no longer does.
 *
 * ## Why a panel with no stated maximum is reported rather than capped
 *
 * `max` is **required** on a repeating group, and `docs/adr/0003-repeating-groups.md` explains
 * that this is the point rather than an inconvenience: the export has one block of columns per
 * possible entry, so the column set is a function of the form only because the form states how
 * many entries there can be. SurveyJS does not require `maxPanelCount`, so a panel often carries
 * no such number.
 *
 * Inventing one was considered and refused. Defaulting to the schema cap would put twenty blocks
 * of columns into somebody's CSV because their survey happened not to mention a limit — a decision
 * about their spreadsheet, made silently, by an importer. This module's whole posture is to map
 * what maps and report what does not, and a target field that requires information the source does
 * not carry is the definition of the second case.
 *
 * The cost, stated plainly: an author importing a panel with no limit gets it in `skipped` and has
 * to say how many. That is one number, asked once, and the alternative is a number nobody chose.
 */
function mapPanel(
  item: Record<string, unknown>,
  position: number,
  taken: Set<string>,
): { field?: Record<string, unknown>; skipped?: SkippedQuestion } {
  const name = typeof item['name'] === 'string' ? item['name'] : '';
  const label = localise(item['title']) ?? localise(item['name']);
  if (!label) return { skipped: { type: 'paneldynamic', name, reason: 'unreadable' } };

  const stated = Number(item['maxPanelCount']);
  if (!Number.isFinite(stated) || stated < 1) {
    return { skipped: { type: 'paneldynamic', name, reason: 'needs-limit' } };
  }

  /*
   * Clamped rather than refused. A panel that says 100 is an author who meant "plenty", and 20 is
   * the most this product will carry; refusing it over a number they did not think hard about
   * would lose a block that maps perfectly well otherwise. The cap is reported nowhere because it
   * is visible in the builder, on a required field, next to a hint explaining it.
   */
  const max = Math.min(MAX_GROUP_ENTRIES, Math.round(stated));

  const wanted = Number(item['minPanelCount']);
  const min = Number.isFinite(wanted) ? Math.min(max, Math.max(0, Math.round(wanted))) : 0;

  const field: Record<string, unknown> = {
    id: `imported_${position + 1}`,
    key: toKey(name || label['en-GB'], position, taken),
    type: 'repeating_group',
    label,
    required: item['isRequired'] === true || min > 0,
    width: 'full',
    min,
    max,
    /* Filled in by the caller once the children have been mapped. */
    fields: [],
  };

  const help = localise(item['description']);
  if (help) field['helpText'] = help;

  const addText = localise(item['panelAddText']);
  if (addText) field['addLabel'] = addText;

  /*
   * `templateTitle` is their per-entry heading, and it usually contains `{panelIndex}` — their
   * placeholder syntax, which means nothing to us. Ours numbers entries itself, so the token is
   * removed rather than carried through as literal text on every heading.
   */
  const entryTitle = localise(item['templateTitle']);
  if (entryTitle) {
    const cleaned = Object.fromEntries(
      Object.entries(entryTitle).map(([locale, text]) => [
        locale,
        text
          .replace(/\{panel(Index|Count)\}/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      ]),
    );
    if (Object.values(cleaned).some((text) => text)) field['entryLabel'] = cleaned;
  }

  /*
   * `admits` is deliberately **not** set from anything in their document.
   *
   * Nothing in a SurveyJS panel says "each of these is a person who gets a ticket" — it is a
   * decision about an event, which their schema has no concept of. Guessing it from a panel named
   * "guests" would hand out admission cards because of a word.
   */
  return { field };
}
