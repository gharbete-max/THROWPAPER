import { plain } from '../forms/ask.js';
import { Field } from '../forms/definition.js';
import { SUMMARY_LOCALES, type SummaryLocale } from '../summary/languages.js';

/**
 * "Draft a form" (docs/plan/EASY.md, E4): the person says what they want in a few words and the
 * local model proposes short question labels. It is a task of the AI centre and nothing in the
 * rule-based builder (`builder/`, `interpret/`, `import/`) calls it.
 *
 * What it may write is deliberately small: labels, a type from a short list, required or not, and
 * choices. No help text, no declarations, no consent or terms (CLAUDE.md rule 8). Whatever the
 * model says is checked here against the form schema; a field that does not parse is dropped, so
 * the model can only ever produce a valid, plain form that the person then reviews.
 */

export const DRAFT_FORM_LIMITS = { request: 400, fields: 14, label: 80, options: 10, title: 80 };

export interface DraftFormTask {
  kind: 'draft-form';
  /** The person's own words. */
  request: string;
  /** The language of the labels. */
  into: SummaryLocale;
}

export function isDraftFormTask(value: unknown): value is DraftFormTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    task.kind === 'draft-form' &&
    typeof task.request === 'string' &&
    task.request.trim() !== '' &&
    task.request.length <= DRAFT_FORM_LIMITS.request &&
    (SUMMARY_LOCALES as readonly unknown[]).includes(task.into)
  );
}

/**
 * Words that mean the form's *wording* matters in law, medicine, tax or safety. A request with one
 * is not drafted (CLAUDE.md rule 8, ADR 0012): the templates carry structure, and a human writes
 * the words. A word starts a word ("contracts"); matched without accents, in English and Swedish.
 */
const HUMAN_WRITES = [
  'consent',
  'waiver',
  'contract',
  'agreement',
  'declaration',
  'terms',
  'liability',
  'indemn',
  'disclaimer',
  'privacy',
  'gdpr',
  'medical',
  'patient',
  'clinical',
  'diagnos',
  'prescription',
  'accident',
  'incident',
];
/** Swedish joins words ("hyresavtal"), so these count anywhere inside a word. */
const INSIDE = [
  'samtycke',
  'avtal',
  'kontrakt',
  'deklaration',
  'villkor',
  'intyg',
  'skatt',
  'olycka',
  'olycksfall',
  'tillbud',
  'recept',
  'integritet',
];
/** Short words that begin others ("taxi") are whole words only. */
const WHOLE = ['tax', 'nda'];
const HUMAN_WRITES_AT = new RegExp(
  `(^| )(${HUMAN_WRITES.join('|')})|(${INSIDE.join('|')})|(^| )(${WHOLE.join('|')})( |$)`,
);

export function needsAHuman(request: string): boolean {
  return HUMAN_WRITES_AT.test(plain(request));
}

/** The kinds of question a draft may use. */
export const DRAFT_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'time',
  'single_select',
  'multi_select',
  'yes_no',
] as const;
type DraftType = (typeof DRAFT_TYPES)[number];

export interface DraftForm {
  title: string;
  fields: Field[];
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? [...value.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '';

/** The first `{ ... }` in the answer, which models wrap in prose or a code fence. */
function jsonIn(answer: string): unknown {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The model's answer as fields, or null when there is nothing usable. `locale` is the language
 * key the labels are stored under (the form's default language).
 */
export function readDraft(answer: string, locale: string): DraftForm | null {
  const parsed = jsonIn(answer);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { title, fields: list } = parsed as { title?: unknown; fields?: unknown };
  if (!Array.isArray(list)) return null;
  const fields: Field[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, DRAFT_FORM_LIMITS.fields)) {
    if (typeof item !== 'object' || item === null) continue;
    const given = item as Record<string, unknown>;
    const label = text(given.label, DRAFT_FORM_LIMITS.label);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    let type: DraftType = (DRAFT_TYPES as readonly unknown[]).includes(given.type)
      ? (given.type as DraftType)
      : 'short_text';
    const options = (Array.isArray(given.options) ? given.options : [])
      .map((option) => text(option, DRAFT_FORM_LIMITS.label))
      .filter(Boolean)
      .slice(0, DRAFT_FORM_LIMITS.options);
    // A choice with fewer than two things to choose between is just a question.
    if ((type === 'single_select' || type === 'multi_select') && options.length < 2) {
      type = 'short_text';
    }
    const n = fields.length + 1;
    const candidate = {
      id: `q${n}`,
      key: `q${n}`,
      type,
      label: { [locale]: label },
      required: given.required === true,
      ...(type === 'single_select' || type === 'multi_select'
        ? {
            options: options.map((option, i) => ({
              value: `o${i + 1}`,
              label: { [locale]: option },
            })),
          }
        : {}),
    };
    const checked = Field.safeParse(candidate);
    if (checked.success) fields.push(checked.data);
  }
  if (fields.length === 0) return null;
  return { title: text(title, DRAFT_FORM_LIMITS.title), fields };
}
