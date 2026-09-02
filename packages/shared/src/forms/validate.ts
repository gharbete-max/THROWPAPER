import {
  answerableFields,
  isDangerousPattern,
  isVisible,
  MAX_MATCHED_LENGTH,
  type AnswerableField,
  type FormDefinition,
} from './index.js';

/**
 * One validator, run on both sides.
 *
 * The server is authoritative — the client copy exists only so somebody gets feedback before they
 * press submit. Anything enforced here must be enforced by the same call on the server, which is
 * why it lives in `packages/shared` and takes no browser or database dependency.
 *
 * Messages are returned as **keys plus parameters**, not sentences. The caller renders them
 * through the locale catalogue; a hard-coded English string here would break CLAUDE.md rule 4 and
 * reach a Swedish visitor untranslated.
 */
export type AnswerValue = string | number | boolean | string[] | null | undefined;
export type SubmissionValues = Record<string, AnswerValue>;

export interface ValidationIssue {
  key: string;
  /** Message key, e.g. `validation.required`. */
  code: string;
  params?: Record<string, string | number>;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Values coerced to their field's type, ready to store. Only present when `ok`. */
  values: SubmissionValues;
}

/** Loose on purpose: the definitive check on an address is whether mail to it arrives. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits, spaces and the usual punctuation. Numbering plans vary too much to be stricter. */
const PHONE_PATTERN = /^[+()\-.\s0-9]{5,32}$/;

export function validateSubmission(
  definition: FormDefinition,
  input: SubmissionValues,
  options: { partial?: boolean } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const values: SubmissionValues = {};

  for (const field of answerableFields(definition)) {
    /**
     * A field the conditions have hidden collects nothing and blocks nothing.
     *
     * Without this, a required question behind a condition would refuse the submission with an
     * error attached to a field that is not on the page — the classic conditional-logic dead end,
     * where the form cannot be submitted and cannot be corrected either. Its key is written as
     * empty rather than omitted, so the column still exists in the export and a blank means
     * "was not asked" consistently across every row.
     */
    if (!isVisible(field, input)) {
      values[field.key] = field.type === 'multi_select' ? [] : null;
      continue;
    }

    const raw = input[field.key];
    const empty = isEmpty(raw);

    // A partial save (save-and-resume) keeps whatever has been entered without demanding the rest.
    if (empty) {
      if (!options.partial && 'required' in field && field.required) {
        issues.push({ key: field.key, code: 'validation.required' });
      }
      values[field.key] = field.type === 'multi_select' ? [] : null;
      continue;
    }

    const outcome = validateField(field, raw);
    if (outcome.issue) issues.push({ key: field.key, ...outcome.issue });
    else values[field.key] = outcome.value;
  }

  // Answers for fields that are not in the definition are dropped rather than stored. A stray key
  // is either a stale client or someone probing, and neither should end up in the export.
  return { ok: issues.length === 0, issues, values };
}

function validateField(
  field: AnswerableField,
  raw: AnswerValue,
): { value?: AnswerValue; issue?: Omit<ValidationIssue, 'key'> } {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
    case 'phone': {
      const value = String(raw).trim();
      if (field.minLength !== undefined && value.length < field.minLength) {
        return { issue: { code: 'validation.tooShort', params: { min: field.minLength } } };
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return { issue: { code: 'validation.tooLong', params: { max: field.maxLength } } };
      }
      if (field.pattern && !safeMatch(field.pattern, value)) {
        return { issue: { code: 'validation.pattern' } };
      }
      if (field.type === 'phone' && !PHONE_PATTERN.test(value)) {
        return { issue: { code: 'validation.phone' } };
      }
      return { value };
    }

    case 'email': {
      const value = String(raw).trim().toLowerCase();
      if (!EMAIL_PATTERN.test(value)) return { issue: { code: 'validation.email' } };
      return { value };
    }

    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(value)) return { issue: { code: 'validation.number' } };
      if (field.min !== undefined && value < field.min) {
        return { issue: { code: 'validation.min', params: { min: field.min } } };
      }
      if (field.max !== undefined && value > field.max) {
        return { issue: { code: 'validation.max', params: { max: field.max } } };
      }
      if (field.decimals !== undefined && decimalPlaces(value) > field.decimals) {
        return { issue: { code: 'validation.decimals', params: { decimals: field.decimals } } };
      }
      return { value };
    }

    case 'date': {
      const value = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        return { issue: { code: 'validation.date' } };
      }
      if (field.min && value < field.min) {
        return { issue: { code: 'validation.dateMin', params: { min: field.min } } };
      }
      if (field.max && value > field.max) {
        return { issue: { code: 'validation.dateMax', params: { max: field.max } } };
      }
      return { value };
    }

    case 'single_select': {
      const value = String(raw);
      if (!field.options.some((option) => option.value === value)) {
        return { issue: { code: 'validation.option' } };
      }
      return { value };
    }

    case 'multi_select': {
      const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const allowed = new Set(field.options.map((option) => option.value));
      if (list.some((entry) => !allowed.has(entry))) {
        return { issue: { code: 'validation.option' } };
      }
      if (field.minSelected !== undefined && list.length < field.minSelected) {
        return { issue: { code: 'validation.minSelected', params: { min: field.minSelected } } };
      }
      if (field.maxSelected !== undefined && list.length > field.maxSelected) {
        return { issue: { code: 'validation.maxSelected', params: { max: field.maxSelected } } };
      }
      return { value: list };
    }

    case 'yes_no': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
      return { issue: { code: 'validation.yesNo' } };
    }

    case 'rating': {
      const value = typeof raw === 'number' ? raw : Number(String(raw));
      if (!Number.isInteger(value) || value < 1 || value > field.scale) {
        return { issue: { code: 'validation.rating', params: { max: field.scale } } };
      }
      return { value };
    }

    case 'time': {
      const value = String(raw).trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return { issue: { code: 'validation.time' } };
      }
      // `HH:MM` is fixed-width and zero-padded, so string order is clock order.
      if (field.min && value < field.min) {
        return { issue: { code: 'validation.timeMin', params: { min: field.min } } };
      }
      if (field.max && value > field.max) {
        return { issue: { code: 'validation.timeMax', params: { max: field.max } } };
      }
      return { value };
    }

    case 'hidden':
      return { value: String(raw).slice(0, 500) };

    default:
      /**
       * Not a fallback — a bug.
       *
       * This used to `return { value: null }`, which meant a new answerable field type added to
       * the schema without a case here would accept anything and store nothing, in silence, all
       * the way through to an empty column in the export. `never` makes it a compile error
       * instead, so the switch cannot fall behind the union.
       */
      return assertHandled(field);
  }
}

function assertHandled(field: never): { issue: Omit<ValidationIssue, 'key'> } {
  const type = (field as { type?: string }).type ?? 'unknown';
  throw new Error(`validateField has no case for field type "${type}"`);
}

function isEmpty(value: AnswerValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Operator-authored patterns are matched with a length cap and no user-supplied flags. A form
 * builder is not a place to accept arbitrary regular expressions unguarded.
 */
function safeMatch(pattern: string, value: string): boolean {
  /**
   * A pattern that can backtrack catastrophically is **skipped**, not failed.
   *
   * Publishing refuses these, so reaching here means a form was written through the API before
   * that check existed. Two bad options: fail every answer, which makes a live public form
   * unfillable by anybody with no way for the visitor to fix it; or skip that one rule, leaving
   * the field validated by its type and its length limits. Skipping degrades; failing breaks.
   */
  if (isDangerousPattern(pattern)) return true;

  try {
    // Bounded input bounds the work even if the structural check missed something.
    return new RegExp(`^(?:${pattern})$`).test(value.slice(0, MAX_MATCHED_LENGTH));
  } catch {
    // An unparseable pattern must not silently pass everything.
    return false;
  }
}

/**
 * How many digits this number carries after the point.
 *
 * Reading them out of `String(value)` looks obvious and is wrong: JavaScript switches to
 * exponential notation below 1e-6, so `String(0.0000001)` is `"1e-7"` — no `.` to find, zero
 * decimal places reported, and a `decimals: 0` rule that a visitor could walk straight past by
 * typing a small enough number.
 *
 * `toExponential()` always produces the same shape, so the answer comes out of the exponent
 * instead of out of how the value happened to be printed.
 */
function decimalPlaces(value: number): number {
  const match = /^-?(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(value.toExponential());
  if (!match) return 0;
  const fractionDigits = match[2]?.length ?? 0;
  const exponent = Number(match[3]);
  return Math.max(0, fractionDigits - exponent);
}
