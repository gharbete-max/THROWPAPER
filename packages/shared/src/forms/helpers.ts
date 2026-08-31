import { PRESENTATIONAL_TYPES, type Field, type FormDefinition } from './definition.js';

const presentational = new Set<string>(PRESENTATIONAL_TYPES);

/** Fields that actually collect an answer. Section breaks, page breaks and rich text do not. */
export function answerableFields(definition: FormDefinition): Field[] {
  return definition.fields.filter((field) => !presentational.has(field.type));
}

/**
 * Fields split into pages on `page_break`. The break itself is not part of either page.
 * Always returns at least one page, so a renderer never has to special-case an empty form.
 */
export function pagesOf(definition: FormDefinition): Field[][] {
  const pages: Field[][] = [[]];
  for (const field of definition.fields) {
    if (field.type === 'page_break') pages.push([]);
    else pages[pages.length - 1]?.push(field);
  }
  return pages;
}

/** Every duplicated field key. Keys address submission data, so collisions silently lose answers. */
export function duplicateKeys(definition: FormDefinition): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const field of definition.fields) {
    if (seen.has(field.key)) duplicates.add(field.key);
    seen.add(field.key);
  }
  return [...duplicates];
}

interface TranslatableText {
  /** Where the text lives, for pointing the editor at it: `field.<id>.label`. */
  path: string;
  fieldId: string | null;
  text: Readonly<Record<string, string>>;
  /** Only required texts block publishing. Help text and placeholders do not. */
  required: boolean;
}

/** Every translatable string in a definition, flattened — drives the completeness indicator. */
export function translatableTexts(definition: FormDefinition): TranslatableText[] {
  const texts: TranslatableText[] = [];

  for (const field of definition.fields) {
    if (field.type === 'page_break') continue;

    if (field.type === 'rich_text') {
      texts.push({
        path: `field.${field.id}.content`,
        fieldId: field.id,
        text: field.content,
        required: true,
      });
      continue;
    }
    if (field.type === 'hidden') continue;

    texts.push({
      path: `field.${field.id}.label`,
      fieldId: field.id,
      text: field.label,
      required: true,
    });

    if ('helpText' in field && field.helpText) {
      texts.push({
        path: `field.${field.id}.helpText`,
        fieldId: field.id,
        text: field.helpText,
        required: false,
      });
    }
    if ('placeholder' in field && field.placeholder) {
      texts.push({
        path: `field.${field.id}.placeholder`,
        fieldId: field.id,
        text: field.placeholder,
        required: false,
      });
    }
    if ('options' in field) {
      for (const [index, option] of field.options.entries()) {
        texts.push({
          path: `field.${field.id}.options.${index}`,
          fieldId: field.id,
          text: option.label,
          required: true,
        });
      }
    }
  }

  texts.push({
    path: 'settings.submitLabel',
    fieldId: null,
    text: definition.settings.submitLabel,
    required: false,
  });
  texts.push({
    path: 'settings.confirmationMessage',
    fieldId: null,
    text: definition.settings.confirmationMessage,
    required: false,
  });

  return texts;
}

export interface LocaleCompleteness {
  locale: string;
  /** Required texts with no content in this locale. Empty means publishable. */
  missing: string[];
  complete: boolean;
}

/**
 * Per-locale completeness. `SPEC-shared.md`: publishing with missing required translations is
 * blocked unless explicitly overridden, so this has to be callable from both the editor and the
 * publish endpoint.
 */
export function definitionCompleteness(
  definition: FormDefinition,
  locales: readonly string[],
): LocaleCompleteness[] {
  const texts = translatableTexts(definition).filter((entry) => entry.required);
  return locales.map((locale) => {
    const missing = texts.filter((entry) => !entry.text[locale]?.trim()).map((entry) => entry.path);
    return { locale, missing, complete: missing.length === 0 };
  });
}

export interface DefinitionProblem {
  code: 'duplicate-key' | 'no-answerable-fields' | 'empty-options';
  message: string;
  fieldId?: string;
}

/** Structural problems that block publishing regardless of translations. */
export function definitionProblems(definition: FormDefinition): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];

  for (const key of duplicateKeys(definition)) {
    problems.push({ code: 'duplicate-key', message: `Field key "${key}" is used more than once` });
  }
  if (answerableFields(definition).length === 0) {
    problems.push({ code: 'no-answerable-fields', message: 'The form collects no answers' });
  }
  for (const field of definition.fields) {
    if ('options' in field && field.options.length === 0) {
      problems.push({
        code: 'empty-options',
        message: 'A choice field has no options',
        fieldId: field.id,
      });
    }
  }
  return problems;
}
