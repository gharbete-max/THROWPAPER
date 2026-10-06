import { useEffect, useState } from 'react';
import { pickText, type LocaleConfig } from '@tp/i18n';
import { changedByHand, type BuilderGraph, type Conversation, type Op } from '@tp/shared/builder';
import type { FormDefinition, LogoSlot } from '@tp/shared/forms';
import { Masthead, MastheadFoot } from '../../../components/Masthead.js';
import { useT } from '../../../lib/i18n.js';
import { FormPreview } from '../FormPreview.js';
import { assumed, focusedField, type PreviewSpec, type Said } from './conversation.js';
import { InlineEdit, SlotEdit } from './InlineEdit/InlineEdit.js';

/**
 * The preview moment — `PREDICTIVE-BUILDER.md`, "The preview contract"; `DESIGN-LANGUAGE.md`,
 * "Fixed sentences".
 *
 * The real control, never a picture of one: `FormPreview`, which renders the same `FieldInput` the
 * public page does, painted with the organisation's own brand kit — the signed-in app is painted
 * with it already (`lib/brand.tsx`), so the preview wears exactly what the form will
 * (`CAVEATS.md` #31). A whole-form preview puts the organisation's logo where the form says, with
 * the same `Masthead` the public page uses.
 *
 * Under it, always, the one sentence: "Not completely happy with the preview? Click it to edit."
 * Clicking the preview, the sentence, or pressing E opens inline editing — on the same reducer, in
 * the same log. A question changed by hand wears the badge and its way back.
 */

export interface PreviewBrand {
  /** Whether the organisation has a brand kit of its own; if not, the form wears Loppa's. */
  readonly customised: boolean;
  readonly logo: string | null;
  readonly organisationName: string;
}

export interface PreviewMomentProps {
  readonly spec: PreviewSpec;
  readonly graph: BuilderGraph;
  readonly conversation: Conversation;
  readonly contentLocales: LocaleConfig;
  readonly contentLocale: string;
  readonly brand: PreviewBrand;
  readonly editing: boolean;
  readonly onEditing: (open: boolean) => void;
  readonly onEdit: (ops: Op[]) => void;
  readonly onUseGuided: (fieldId: string) => void;
  readonly onBackTo: (step: number) => void;
}

/** Whether the screen is a touch screen: the fixed sentence says "Tap" there, not "Click". */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(pointer: coarse)');
    setCoarse(query.matches);
    const onChange = () => setCoarse(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

export function PreviewMoment({
  spec,
  graph,
  conversation,
  contentLocales,
  contentLocale,
  brand,
  editing,
  onEditing,
  onEdit,
  onUseGuided,
  onBackTo,
}: PreviewMomentProps) {
  const t = useT();
  const coarse = useCoarsePointer();
  const { draft } = conversation.state;
  const focused = spec === 'choice.control' ? focusedField(conversation) : null;
  // The whole form (`form.whole`, what "Right" added): any question of it, picked, is edited.
  const [picked, setPicked] = useState<string | null>(null);
  const field =
    focused ??
    (spec === 'form.whole'
      ? (draft.definition.fields.find((candidate) => candidate.id === picked) ?? null)
      : null);
  const slot = draft.definition.settings.layout?.logoSlot;
  const byHand = field !== null && changedByHand(conversation.state, field.id);
  const shown: FormDefinition = focused
    ? { ...draft.definition, fields: [focused] }
    : draft.definition;
  const words = (said: readonly Said[]) =>
    said.map((one) => ('key' in one ? t(one.key, one.values) : one.text)).join(', ');

  return (
    <section
      className="conversation__preview preview-moment"
      aria-label={t('conversation.preview.label')}
    >
      {byHand && (
        <p className="preview-moment__badge">
          <span className="preview-moment__by-hand">{t('conversation.byHand')}</span>
          <button
            type="button"
            className="button button--bare"
            onClick={() => onUseGuided(field.id)}
          >
            {t('conversation.revert')}
          </button>
        </p>
      )}

      {/* Clicking the preview is how editing starts; its own controls still answer to a click,
          so an author can see a chosen state as well as change the look. */}
      <div
        className="preview-moment__frame"
        onClick={() => {
          if (!editing) onEditing(true);
        }}
      >
        {spec === 'brand.masthead' ? (
          <div className="preview-moment__page">
            <Masthead
              slot={slot}
              logo={brand.logo}
              organisationName={brand.organisationName}
              title={pickText(contentLocales, draft.title, contentLocale).value}
            />
            <FormPreview
              definition={shown}
              locale={contentLocale}
              locales={contentLocales}
              selectedId={null}
            />
            <MastheadFoot slot={slot} logo={brand.logo} organisationName={brand.organisationName} />
          </div>
        ) : (
          <FormPreview
            definition={shown}
            locale={contentLocale}
            locales={contentLocales}
            selectedId={null}
          />
        )}
      </div>

      {!brand.customised && <p className="small muted">{t('conversation.preview.noBrand')}</p>}

      <button
        type="button"
        className="preview-moment__sentence"
        aria-expanded={editing}
        onClick={() => onEditing(!editing)}
      >
        {t(coarse ? 'conversation.preview.editTouch' : 'conversation.preview.edit')}
      </button>

      {editing &&
        (spec === 'brand.masthead' ? (
          <SlotEdit
            slot={slot}
            onPick={(logoSlot: LogoSlot) =>
              onEdit([
                { op: 'set', path: 'draft.definition.settings.layout.logoSlot', value: logoSlot },
              ])
            }
            onDone={() => onEditing(false)}
          />
        ) : spec === 'form.whole' && field === null ? (
          <PickQuestion
            fields={draft.definition.fields}
            locale={contentLocale}
            locales={contentLocales}
            onPick={setPicked}
          />
        ) : field ? (
          <InlineEdit
            field={field}
            locale={contentLocale}
            onEdit={onEdit}
            onDone={() => onEditing(false)}
          />
        ) : null)}

      <AssumedList crumbs={assumed(graph, conversation)} words={words} onBackTo={onBackTo} />
    </section>
  );
}

/** Which question of the whole form to edit: each one that has words, by its words. */
function PickQuestion({
  fields,
  locale,
  locales,
  onPick,
}: {
  fields: FormDefinition['fields'];
  locale: string;
  locales: LocaleConfig;
  onPick: (fieldId: string) => void;
}) {
  const t = useT();
  const named = fields.filter(
    (field): field is Extract<typeof field, { label: unknown }> => 'label' in field,
  );
  return (
    <fieldset className="inline-edit" aria-label={t('conversation.preview.pick')}>
      <legend>{t('conversation.preview.pick')}</legend>
      <div className="inline-edit__row">
        {named.map((field) => (
          <button
            key={field.id}
            type="button"
            className="button button--quiet"
            onClick={() => onPick(field.id)}
          >
            {pickText(locales, field.label, locale).value || field.key}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** "What Loppa assumed": the last few decisions in plain words, each a way back to its question. */
function AssumedList({
  crumbs,
  words,
  onBackTo,
}: {
  crumbs: ReturnType<typeof assumed>;
  words: (said: readonly Said[]) => string;
  onBackTo: (step: number) => void;
}) {
  const t = useT();
  if (crumbs.length === 0) return null;
  return (
    <details className="preview-moment__assumed">
      <summary>{t('conversation.preview.assumed')}</summary>
      <ul>
        {crumbs.map((crumb) => (
          <li key={crumb.step}>
            <button
              type="button"
              className="button button--bare"
              onClick={() => onBackTo(crumb.step)}
            >
              <span className="muted">{t(crumb.question)}</span> {words(crumb.said)}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
