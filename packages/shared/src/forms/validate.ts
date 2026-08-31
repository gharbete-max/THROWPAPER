import { answerableFields, type Field, type FormDefinition } from './index.js';

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
  field: Field,
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

    case 'hidden':
      return { value: String(raw).slice(0, 500) };

    default:
      return { value: null };
  }
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
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    // An unparseable pattern must not silently pass everything.
    return false;
  }
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const index = text.indexOf('.');
  return index < 0 ? 0 : text.length - index - 1;
}
