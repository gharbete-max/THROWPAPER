import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDocument,
} from 'pdf-lib';
import { ArrangeRefusal, openChecked } from './arrange.js';

/**
 * A PDF's own form fields (AcroForm): listed, and written. Nothing here is stored.
 *
 * The file goes through the same door as page work (`openChecked`): encrypted refused, signed
 * refused until the person agrees to lose the signature, the guard's worker before pdf-lib.
 * Fields are written and kept as fields, so the person can open the result and keep typing.
 */

export interface PdfField {
  name: string;
  kind: 'text' | 'checkbox' | 'choice';
  /** The choices of a drop-down, list or radio group. */
  options?: string[];
  value: string | boolean;
}

export type FieldValues = Record<string, string | boolean>;

type Choice = PDFDropdown | PDFOptionList | PDFRadioGroup;
const isChoice = (field: unknown): field is Choice =>
  field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup;

const open = (bytes: Uint8Array, acceptSignatureLoss?: boolean): Promise<PDFDocument> =>
  openChecked(bytes, 0, acceptSignatureLoss);

export async function pdfFields(
  bytes: Uint8Array,
  options: { acceptSignatureLoss?: boolean } = {},
): Promise<PdfField[]> {
  const fields: PdfField[] = [];
  for (const field of (await open(bytes, options.acceptSignatureLoss)).getForm().getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      fields.push({ name, kind: 'text', value: field.getText() ?? '' });
    } else if (field instanceof PDFCheckBox) {
      fields.push({ name, kind: 'checkbox', value: field.isChecked() });
    } else if (isChoice(field)) {
      const chosen = field instanceof PDFRadioGroup ? [field.getSelected()] : field.getSelected();
      fields.push({
        name,
        kind: 'choice',
        options: field.getOptions(),
        value: chosen.filter(Boolean).join(', '),
      });
    }
    // Buttons and signature fields are not something a person types into.
  }
  if (fields.length === 0) throw new ArrangeRefusal('no-fields');
  return fields;
}

export async function fillPdf(
  bytes: Uint8Array,
  values: FieldValues,
  options: { acceptSignatureLoss?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await open(bytes, options.acceptSignatureLoss);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new ArrangeRefusal('no-such-field');
    try {
      if (field instanceof PDFTextField && typeof value === 'string') field.setText(value);
      else if (field instanceof PDFCheckBox && typeof value === 'boolean') {
        if (value) field.check();
        else field.uncheck();
      } else if (isChoice(field) && typeof value === 'string') {
        if (value === '') field.clear();
        else if (field.getOptions().includes(value)) field.select(value);
        else throw new ArrangeRefusal('bad-value');
      } else throw new ArrangeRefusal('bad-value');
    } catch (error) {
      if (error instanceof ArrangeRefusal) throw error;
      throw new ArrangeRefusal('bad-value');
    }
  }
  try {
    // Appearances are drawn here so a text the standard fonts cannot encode fails now, as a
    // refusal, rather than as a 500 when the file is saved.
    form.updateFieldAppearances();
    return await doc.save();
  } catch {
    // ponytail: the PDF's standard fonts only; embed a font to take Cyrillic and CJK (ADR 0015).
    throw new ArrangeRefusal('unencodable');
  }
}
