import {
  PRESENTATIONAL_TYPES,
  type AnswerableField,
  type Condition,
  type EntryField,
  type Field,
  type FieldWidth,
  type FormDefinition,
  type RepeatingGroupField,
} from './definition.js';
import { isDangerousPattern } from './pattern-safety.js';

const presentational = new Set<string>(PRESENTATIONAL_TYPES);

/** Fields that actually collect an answer. Section breaks, page breaks and rich text do not. */
export function answerableFields(definition: FormDefinition): AnswerableField[] {
  return definition.fields.filter(
    (field): field is AnswerableField => !presentational.has(field.type),
  );
}

/** The children of a group that collect an answer. Same rule, one level down. */
export function answerableChildren(group: RepeatingGroupField): EntryField[] {
  return group.fields.filter((child) => !presentational.has(child.type));
}

/** Every repeating group on a form, in the order they appear. */
export function repeatingGroups(definition: FormDefinition): RepeatingGroupField[] {
  return definition.fields.filter(
    (field): field is RepeatingGroupField => field.type === 'repeating_group',
  );
}

/**
 * The group whose entries are admitted in their own right, if a form has one.
 *
 * At most one, enforced by `definitionProblems` — an entry's identity is its submission's reference
 * plus an ordinal, and an ordinal that could mean "second guest" or "second vehicle" depending on
 * which group you had in mind is not an identity. See `docs/adr/0003-repeating-groups.md`.
 */
export function admittingGroup(definition: FormDefinition): RepeatingGroupField | null {
  return repeatingGroups(definition).find((group) => group.admits) ?? null;
}

/**
 * How few entries a group will accept.
 *
 * `required` on the group is the author's shorthand for "at least one", so it raises a `min` of
 * nought to one and leaves a larger `min` alone. Two ways to say the same thing exist because the
 * builder's required toggle is the one every other field type has, and an author should not have
 * to know that this field type spells it with a number.
 */
export function minEntries(group: Pick<RepeatingGroupField, 'min' | 'required'>): number {
  return group.required ? Math.max(1, group.min) : group.min;
}

/**
 * Where an answer inside a group lives, as one string: `guests[0].name`.
 *
 * Validation issues and rendered inputs both need to name a box inside an entry, and they have to
 * agree or an error is attached to nothing. One function, so they cannot disagree.
 */
export function entryIssueKey(groupKey: string, index: number, childKey?: string): string {
  const entry = `${groupKey}[${index}]`;
  return childKey === undefined ? entry : `${entry}.${childKey}`;
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
    collectTexts(field, texts);

    /**
     * A group's children are translated too, and a missing one blocks publishing just as it would
     * at the top level.
     *
     * Walked here rather than forgotten: a group whose children were skipped would report a form
     * as fully translated while half its questions existed in one language, and the person who
     * found out would be the respondent.
     */
    if (field.type === 'repeating_group') {
      for (const child of field.fields) collectTexts(child, texts);
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

function collectTexts(field: Field, texts: TranslatableText[]): void {
  if (field.type === 'page_break') return;

  if (field.type === 'rich_text') {
    texts.push({
      path: `field.${field.id}.content`,
      fieldId: field.id,
      text: field.content,
      required: true,
    });
    return;
  }
  /**
   * Alt text is translatable but **not required**, unlike a label.
   *
   * An empty alt is a real choice — it means "decorative, skip this" — and a banner across the
   * top of a form is exactly that. Requiring it would push people to type something rather than
   * nothing, and a screen reader announcing "image" over and over is worse than silence.
   */
  if (field.type === 'image') {
    texts.push({
      path: `field.${field.id}.alt`,
      fieldId: field.id,
      text: field.alt,
      required: false,
    });
    return;
  }

  /**
   * Some fields carry no text at all, so there is nothing here to translate.
   *
   * Asked structurally rather than as a list of types. A hidden field has no label because
   * nobody sees it; a shape and a drawing have none because a decoration that announced itself
   * would be read aloud to somebody who gains nothing from hearing it. Either way the question
   * is "does this have a label", and a list of type names would need extending every time the
   * answer becomes true for a new one — which is exactly the drift these helpers exist to avoid.
   */
  if (!('label' in field)) return;

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

  /**
   * A group's own wording, beyond its label: the button and the per-entry heading.
   *
   * Neither is required. Both fall back to a catalogue string — "Add another", "Entry 1" — which
   * is translated into every language already, so an author who never writes them still gets a
   * form that reads correctly in all twelve.
   */
  if (field.type === 'repeating_group') {
    if (field.addLabel) {
      texts.push({
        path: `field.${field.id}.addLabel`,
        fieldId: field.id,
        text: field.addLabel,
        required: false,
      });
    }
    if (field.entryLabel) {
      texts.push({
        path: `field.${field.id}.entryLabel`,
        fieldId: field.id,
        text: field.entryLabel,
        required: false,
      });
    }
  }
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
  code:
    | 'duplicate-key'
    | 'no-answerable-fields'
    | 'empty-options'
    | 'condition-unknown-field'
    | 'condition-forward-reference'
    | 'unsafe-pattern'
    /** `min` above `max` is a group that can never be filled in correctly. */
    | 'group-min-above-max'
    /** Child keys are scoped to their group, so this is a collision *within* one. */
    | 'group-duplicate-child-key'
    /** `admitNameKey` names a child that is not there, so every card would say "—". */
    | 'group-admit-name-unknown'
    /** Two admitting groups make an entry's ordinal ambiguous — see ADR 0003. */
    | 'multiple-admitting-groups';
  /**
   * English, for logs and for an API client that has no catalogue.
   *
   * **Not** what the builder shows. `CLAUDE.md` rule 4 keeps user-facing strings in
   * `packages/i18n`, and these were being rendered straight to the operator — the one place in
   * the product where an English sentence reached a Swedish screen. The app renders
   * `problem.<code>` with `params` instead.
   */
  message: string;
  /** Values the translated message interpolates, e.g. the duplicated key. */
  params?: Record<string, string>;
  fieldId?: string;
}

/** Structural problems that block publishing regardless of translations. */
export function definitionProblems(definition: FormDefinition): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];

  for (const key of duplicateKeys(definition)) {
    problems.push({
      code: 'duplicate-key',
      message: `Field key "${key}" is used more than once`,
      params: { key },
    });
  }
  if (answerableFields(definition).length === 0) {
    problems.push({ code: 'no-answerable-fields', message: 'The form collects no answers' });
  }
  /**
   * Conditions may only ask about a field that exists and comes **earlier**.
   *
   * Forward references are refused rather than supported, and that is what makes cycles impossible
   * by construction: A can depend on B only if B is above it, so no chain can close. The
   * alternative is a cycle detector, which is more code, is only exercised by a mistake, and would
   * still have to say something at publish time anyway.
   *
   * A reference to a deleted field is worse than a forward one: the condition silently never
   * holds, so the field simply never appears and nothing says why.
   */
  checkFieldList(definition.fields, problems);

  for (const group of repeatingGroups(definition)) {
    /**
     * An entry's own fields are checked as their own list.
     *
     * Which is also what refuses a condition reaching out of an entry: `showWhen` inside a group
     * may only name a child that came earlier in the same entry, and a reference to a top-level
     * field simply is not in this list, so it is reported as unknown. That is the same rule that
     * makes cycles impossible between pages, applied one level down rather than reimplemented.
     */
    checkFieldList(group.fields, problems);

    if (minEntries(group) > group.max) {
      problems.push({
        code: 'group-min-above-max',
        message: `"${group.key}" asks for at least ${minEntries(group)} entries but allows at most ${group.max}`,
        params: { key: group.key, min: String(minEntries(group)), max: String(group.max) },
        fieldId: group.id,
      });
    }

    const seenChildKeys = new Set<string>();
    for (const child of group.fields) {
      if (seenChildKeys.has(child.key)) {
        problems.push({
          code: 'group-duplicate-child-key',
          message: `Field key "${child.key}" is used more than once inside "${group.key}"`,
          params: { key: child.key, group: group.key },
          fieldId: group.id,
        });
      }
      seenChildKeys.add(child.key);
    }

    if (group.admitNameKey !== undefined && !seenChildKeys.has(group.admitNameKey)) {
      problems.push({
        code: 'group-admit-name-unknown',
        message: `"${group.key}" names "${group.admitNameKey}" as the attendee's name, but has no such question`,
        params: { key: group.admitNameKey, group: group.key },
        fieldId: group.id,
      });
    }
  }

  /**
   * One admitting group, or none.
   *
   * Reported on every offending group rather than only the second, because "one of these is the
   * problem" is not something an author can act on without being told which ones.
   */
  const admitting = repeatingGroups(definition).filter((group) => group.admits);
  if (admitting.length > 1) {
    for (const group of admitting) {
      problems.push({
        code: 'multiple-admitting-groups',
        message: 'Only one group on a form can give its entries their own admission card',
        params: { key: group.key },
        fieldId: group.id,
      });
    }
  }

  return problems;
}

/**
 * The checks that apply to any ordered list of fields — a form, or one entry of a group.
 *
 * Shared because an entry is a list of fields in every way that matters to these rules, and a
 * second copy would be a second copy that stops agreeing.
 */
function checkFieldList(fields: readonly Field[], problems: DefinitionProblem[]): void {
  /**
   * Conditions may only ask about a field that exists and comes **earlier**.
   *
   * Forward references are refused rather than supported, and that is what makes cycles impossible
   * by construction: A can depend on B only if B is above it, so no chain can close. The
   * alternative is a cycle detector, which is more code, is only exercised by a mistake, and would
   * still have to say something at publish time anyway.
   *
   * A reference to a deleted field is worse than a forward one: the condition silently never
   * holds, so the field simply never appears and nothing says why.
   */
  const seenKeys = new Set<string>();

  for (const field of fields) {
    if ('options' in field && field.options.length === 0) {
      problems.push({
        code: 'empty-options',
        message: 'A choice field has no options',
        fieldId: field.id,
      });
    }

    /**
     * A pattern that can backtrack catastrophically never reaches a live form.
     *
     * Refused here rather than only skipped at validation time, because this is the one moment a
     * person is present and can be told. The alternative is a rule that silently does nothing.
     */
    if ('pattern' in field && field.pattern && isDangerousPattern(field.pattern)) {
      problems.push({
        code: 'unsafe-pattern',
        message:
          'A format rule can take exponential time to check. Avoid a repeat inside a repeated ' +
          'group, such as (a+)+.',
        fieldId: field.id,
      });
    }

    const rule = 'showWhen' in field ? field.showWhen : undefined;
    for (const condition of rule?.conditions ?? []) {
      if (seenKeys.has(condition.fieldKey)) continue;
      const existsLater = fields.some((other) => other.key === condition.fieldKey);
      problems.push(
        existsLater
          ? {
              code: 'condition-forward-reference',
              message: `A condition asks about "${condition.fieldKey}", which comes later in the form`,
              params: { key: condition.fieldKey },
              fieldId: field.id,
            }
          : {
              code: 'condition-unknown-field',
              message: `A condition asks about "${condition.fieldKey}", which no field uses`,
              params: { key: condition.fieldKey },
              fieldId: field.id,
            },
      );
    }

    seenKeys.add(field.key);
  }
}

/**
 * How wide a field asks to be, defaulting to the whole row.
 *
 * `page_break` and `hidden` have no width because neither ever occupies a cell — one is stripped
 * when the form is split into pages and the other renders nothing at all.
 */
export function widthOf(field: Field): FieldWidth {
  return 'width' in field ? field.width : 'full';
}

/**
 * Whether one condition holds against the answers given so far.
 *
 * Comparison is on the **stored** answer, never on anything displayed, so restyling or
 * retranslating a form cannot change which fields it shows.
 *
 * Everything is compared as a trimmed string except the ordering operators, which fall back to
 * string order when either side is not a number — that is what makes `greaterThan` work for a
 * date (`2026-05-14`) and a time (`09:30`) as well as for a number.
 */
export function conditionHolds(condition: Condition, values: Record<string, unknown>): boolean {
  const answer = values[condition.fieldKey];
  const given = !isBlank(answer);

  if (condition.operator === 'answered') return given;
  if (condition.operator === 'empty') return !given;

  // Every other operator compares something. An unanswered field satisfies none of them —
  // including `notEquals`, because "not equal to Sweden" should not be true of a blank.
  if (!given) return false;

  const wanted = condition.value.trim();

  // A multi-select answer is a list, and "equals" against a list means "is one of the chosen".
  if (Array.isArray(answer)) {
    const chosen = answer.map((entry) => String(entry));
    switch (condition.operator) {
      case 'equals':
        return chosen.includes(wanted);
      case 'notEquals':
        return !chosen.includes(wanted);
      case 'contains':
        return chosen.some((entry) => entry.toLowerCase().includes(wanted.toLowerCase()));
      default:
        // Ordering a list against a scalar has no sensible meaning, so it is false rather than
        // some accident of how JavaScript stringifies an array.
        return false;
    }
  }

  const actual = typeof answer === 'boolean' ? String(answer) : String(answer).trim();

  switch (condition.operator) {
    case 'equals':
      return actual === wanted;
    case 'notEquals':
      return actual !== wanted;
    case 'contains':
      return actual.toLowerCase().includes(wanted.toLowerCase());
    case 'greaterThan':
    case 'lessThan': {
      const left = Number(actual);
      const right = Number(wanted);
      const numeric = Number.isFinite(left) && Number.isFinite(right);
      const after = numeric ? left > right : actual > wanted;
      return condition.operator === 'greaterThan' ? after : !after && actual !== wanted;
    }
    default:
      return false;
  }
}

/** Whether a field is shown, given the answers so far. A field with no rule is always shown. */
export function isVisible(field: Field, values: Record<string, unknown>): boolean {
  const rule = 'showWhen' in field ? field.showWhen : undefined;
  if (!rule || rule.conditions.length === 0) return true;
  return rule.match === 'any'
    ? rule.conditions.some((condition) => conditionHolds(condition, values))
    : rule.conditions.every((condition) => conditionHolds(condition, values));
}

/**
 * The fields actually on show, given the answers so far.
 *
 * Used by the renderer *and* the validator. If only the renderer knew about visibility, a hidden
 * required field would block submission with an error pointing at a question nobody can see — the
 * classic conditional-logic dead end.
 */
export function visibleFields(
  definition: FormDefinition,
  values: Record<string, unknown>,
): Field[] {
  return definition.fields.filter((field) => isVisible(field, values));
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
