import { FormDefinition, type Field, type FieldType } from './definition.js';

/**
 * Reads the fields of a PDF form and produces one of ours.
 *
 * `docs/adr/0004-old-forms-on-paper.md` argues for this over an embedded PDF editor: the request
 * behind "a PDF editor" is "let people keep their old forms", and an importer answers it better
 * because the output is a form this product can actually run — twelve languages, a brand kit,
 * conditional visibility, a CSV that opens in Excel, an admission card, a door screen. An overlaid
 * PDF has none of that.
 *
 * ## Why this module takes field descriptors rather than bytes
 *
 * Reading an AcroForm needs `pdfjs-dist`. Mapping one does not.
 *
 * `packages/shared` is imported by the browser, and this workspace enforces a bundle budget on
 * exactly that — so pulling a PDF parser in here to serve a feature an author uses once per form
 * would be paid for by every member of the public opening `/f/spring-meeting` on a phone. The
 * extraction lives in `apps/api-forms`, which already has the parser and already has somewhere to
 * put an uploaded file.
 *
 * It also makes the mapping testable without a PDF, which is the half most likely to be wrong.
 *
 * ## What it refuses to do
 *
 * `CLAUDE.md` rule 8 applies with force here. A membership form carries data-protection wording
 * and a trade sheet carries safety wording, and **copying what the document says is fine while
 * improving it is not**. Every label here comes out of the file verbatim; nothing is rephrased,
 * expanded or tidied, and a field whose label cannot be read is reported rather than given one.
 */

/**
 * One field, as the document describes it — not as `pdfjs` happens to shape it.
 *
 * Deliberately our own interface. Pinning this module to a parser's exact object shape would mean
 * a `pdfjs` upgrade rewriting the mapping's tests, and the extractor is the right place to absorb
 * that: it is one adapter, in the app that owns the dependency.
 */
export interface AcroField {
  /** The field's name in the document — what its value is keyed by. */
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'choice' | 'signature' | 'button';
  /**
   * The field's own label, from its alternate name (`/TU`) — the string a screen reader announces.
   *
   * Absent on plenty of real documents, whose fields are named things like
   * `topmostSubform[0].Page1[0].f1_01[0]`. There is nothing to be done about that here: a label is
   * either in the file or it is not, and inventing one is the thing rule 8 forbids.
   */
  label?: string;
  /** A text field that accepts line breaks. */
  multiline?: boolean;
  /** `/MaxLen`, when the document sets one. */
  charLimit?: number;
  required?: boolean;
  /** Filled in by something other than the person: a calculation, or a prefilled reference. */
  readOnly?: boolean;
  hidden?: boolean;
  /** For a radio group or a choice list: the stored value and what the reader sees. */
  options?: Array<{ value: string; label: string }>;
  /** A list box that accepts more than one selection. */
  multiSelect?: boolean;
}

export interface SkippedAcroField {
  name: string;
  type: string;
  reason:
    /** A push button. It runs an action; it collects nothing. */
    | 'no-answer'
    /** Read-only: the document fills it in, so it is not a question. */
    | 'not-a-question'
    /** A radio group or choice list with no readable options. */
    | 'unreadable'
    /** A field type this mapping does not know. */
    | 'unknown-type';
}

export interface AcroFormImport {
  definition: FormDefinition;
  skipped: SkippedAcroField[];
}

/**
 * The fields of a PDF form, as one of ours.
 *
 * `locale` is which language the document is written in, and it is asked for rather than guessed:
 * a PDF carries no locale at all, so the alternative is putting Swedish labels under `en-GB` and
 * leaving the author to move twelve of them by hand. It defaults to `en-GB` only because that is
 * the last link in every fallback chain here, so a label placed there is readable from any
 * language rather than invisible.
 */
export function importAcroFields(
  fields: readonly AcroField[],
  options: { locale?: string } = {},
): AcroFormImport {
  const locale = options.locale ?? 'en-GB';
  const skipped: SkippedAcroField[] = [];
  const mapped: Field[] = [];
  const taken = new Set<string>();

  for (const field of fields) {
    /*
     * A push button runs an action — submit, reset, open a URL. It holds no value, so there is no
     * question to import and nothing is lost by saying so.
     */
    if (field.type === 'button') {
      skipped.push({ name: field.name, type: field.type, reason: 'no-answer' });
      continue;
    }

    /*
     * Read-only fields are the document talking to itself: a total, a reference copied from
     * elsewhere, a date stamped at print time. Importing one would put a box on the form that the
     * respondent is asked to fill in and the original never asked anybody for.
     */
    if (field.readOnly) {
      skipped.push({ name: field.name, type: field.type, reason: 'not-a-question' });
      continue;
    }

    const type = mapType(field);
    if (!type) {
      skipped.push({ name: field.name, type: field.type, reason: 'unknown-type' });
      continue;
    }

    const key = acroFieldKey(field.name, mapped.length, taken);

    /*
     * A hidden field carries a value nobody sees and nobody types — which is exactly what ours is
     * for. It keeps no label, because there is nothing to label.
     */
    if (type === 'hidden') {
      mapped.push({ id: `pdf_${mapped.length + 1}`, key, type: 'hidden' } as Field);
      continue;
    }

    const built: Record<string, unknown> = {
      id: `pdf_${mapped.length + 1}`,
      key,
      type,
      /*
       * The document's own words, verbatim.
       *
       * `label` is the alternate field name, which is what the document offers a screen reader.
       * Falling back to the field's name is not pretty on a form whose fields are called
       * `f1_01[0]`, but it is what the file says — and rule 8 is the reason there is no third
       * option where something here writes a nicer question than the one that was asked.
       */
      label: { [locale]: field.label?.trim() || field.name },
      required: field.required === true,
      width: 'full',
    };

    if (type === 'short_text' || type === 'long_text') {
      /* `/MaxLen` is a real constraint from the original form, so it survives the import. */
      if (field.charLimit && field.charLimit > 0) built['maxLength'] = field.charLimit;
    }

    if (type === 'single_select' || type === 'multi_select') {
      const options = toOptions(field.options, locale);
      /* A choice with no readable choices is not a choice. */
      if (options.length === 0) {
        skipped.push({ name: field.name, type: field.type, reason: 'unreadable' });
        taken.delete(key);
        continue;
      }
      built['options'] = options;
      /*
       * A radio group is radios and a list box is a dropdown — the appearance the reader already
       * had. Presentation never changes what is stored, so this is free to match the original.
       */
      built['appearance'] = type === 'single_select' ? 'radio' : 'checkboxes';
    }

    mapped.push(built as Field);
  }

  /*
   * Parsed rather than cast, exactly as the SurveyJS importer does it: a mapping that produces
   * something subtly invalid fails here, in this module's own tests, instead of in somebody's
   * form.
   */
  const definition = FormDefinition.parse({ schemaVersion: 1, fields: mapped, settings: {} });
  return { definition, skipped };
}

/**
 * Their field type as ours.
 *
 * A PDF text field carries **no** semantic type: there is nothing in the format that distinguishes
 * an email box from a name box, so every one of them becomes text. Reading a type out of the
 * field's name — `email_address` becoming an `email` field — was considered and refused. It is a
 * guess dressed as a mapping, and the failure is silent: an author who never notices ends up with
 * a form that rejects an address the original accepted.
 */
function mapType(field: AcroField): FieldType | null {
  if (field.hidden) return 'hidden';

  switch (field.type) {
    case 'text':
      return field.multiline ? 'long_text' : 'short_text';
    /* A tick box is yes or no, which is a question this product has a field for. */
    case 'checkbox':
      return 'yes_no';
    case 'radio':
      return 'single_select';
    case 'choice':
      return field.multiSelect ? 'multi_select' : 'single_select';
    case 'signature':
      return 'signature';
    default:
      return null;
  }
}

function toOptions(options: AcroField['options'], locale: string) {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: Record<string, string>; image: null }> = [];

  for (const option of options ?? []) {
    const value = option.value.trim().slice(0, 128);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    /* The reader's text where the document has one, and the stored value where it does not. */
    out.push({ value, label: { [locale]: option.label.trim() || value }, image: null });
  }
  return out;
}

/**
 * A field name as a key ours will accept.
 *
 * PDF field names are frequently paths — `topmostSubform[0].Page1[0].f1_01[0]` — so the last
 * segment is taken and everything `FieldKey` refuses is replaced. A name that reduces to nothing
 * falls back to its position, which is ugly and unambiguous; the alternative is two fields sharing
 * a key, and `duplicateKeys` exists because that silently merges their answers into one column.
 */
export function acroFieldKey(name: string, position: number, taken: Set<string>): string {
  const last = name.split('.').pop() ?? name;
  const base =
    last
      .toLowerCase()
      .replace(/\[\d+\]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([^a-z])/, 'f$1')
      .slice(0, 56) || `field_${position + 1}`;

  let key = base;
  let suffix = 2;
  while (taken.has(key)) key = `${base}_${suffix++}`;
  taken.add(key);
  return key;
}
