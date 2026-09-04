import { useState } from 'react';
import { collect, currentQuestion, type WizardTree } from '@tp/shared/wizard';
import { pickText, type LocaleConfig } from '@tp/i18n';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';

/**
 * The standard way of starting something in this product.
 *
 * A few narrow questions, two to four buttons each, and whatever was being started falls out of the
 * answers. It is the same component for a form, a mailing, or a run of invoices — the tree decides
 * what the questions are and what an answer contributes; this only knows how to ask.
 *
 * ## Why the wizard is the default and the editor is "advanced"
 *
 * The editor is more capable and it is the wrong thing to open with. Somebody who builds a form
 * once a year meets seventeen field types and no indication of which three they need, and the
 * honest description of that screen is that it asks them to already know the answer.
 *
 * So the questions come first. Not as a beginner mode — as *the* way in, with the editor one press
 * away for anybody who would rather start from nothing. Both routes end in the same editor with the
 * same document; the wizard is a head start, not a walled garden, which is what stops it having to
 * grow a button for every case the editor already handles.
 *
 * ## Going back
 *
 * Every answer can be undone, and the whole run can be. A wizard without a back button is a wizard
 * people abandon at the second question, because the cost of a wrong press is starting again.
 */
export function Wizard<TItem>({
  tree,
  locales,
  locale,
  onFinish,
  onSkip,
  skipLabel,
  summarise,
}: {
  tree: WizardTree<TItem>;
  /** The organisation's languages, so a question falls back the way every other string does. */
  locales: LocaleConfig;
  locale: string;
  /** Called with everything the run produced, once there is nothing left to ask. */
  onFinish: (items: readonly TItem[], answers: readonly string[]) => void;
  /** The advanced route: skip the questions and start from nothing. */
  onSkip: () => void;
  skipLabel: string;
  /** How to describe one produced item in the running summary. */
  summarise: (item: TItem) => string;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<readonly string[]>([]);

  const question = currentQuestion(tree, answers);
  const items = collect(tree, answers);
  const text = (value: Record<string, string>) => pickText(locales, value, locale).value;

  /*
   * The run is over when there is nothing left to ask.
   *
   * Shown as a review rather than finished silently: the whole promise is that somebody can see
   * what they are about to get before they get it, and a wizard that jumps straight into an editor
   * has spent their attention without showing them the result.
   */
  if (!question) {
    return (
      <div className="wizard stack">
        <p className="wizard__step">{t('wizard.done')}</p>
        <h2 className="wizard__prompt">{t('wizard.review')}</h2>

        <ul className="wizard__summary">
          {items.map((item, index) => (
            <li key={`${summarise(item)}-${index}`}>
              <Icon name="check" /> {summarise(item)}
            </li>
          ))}
        </ul>

        <div className="wizard__actions">
          <button type="button" className="button" onClick={() => onFinish(items, answers)}>
            {t('wizard.open')}
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setAnswers(answers.slice(0, -1))}
          >
            <Icon name="arrow-left" /> {t('wizard.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard stack">
      {/*
        Which question this is, without promising a total.

        The tree branches, so the number of questions left depends on what gets pressed next and a
        progress bar would be a guess presented as a fact.
      */}
      <p className="wizard__step">{t('wizard.step', { n: String(answers.length + 1) })}</p>
      <h2 className="wizard__prompt">{text(question.prompt)}</h2>

      <div className="wizard__options">
        {question.options.map((option) => (
          <button
            type="button"
            className="wizard__option"
            key={option.id}
            onClick={() => setAnswers([...answers, option.id])}
          >
            <strong>{text(option.label)}</strong>
            {option.detail ? <span className="muted small">{text(option.detail)}</span> : null}
          </button>
        ))}
      </div>

      <div className="wizard__actions">
        {answers.length > 0 ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setAnswers(answers.slice(0, -1))}
          >
            <Icon name="arrow-left" /> {t('wizard.back')}
          </button>
        ) : null}

        {/*
          Always here, never buried behind a menu.

          "Advanced" hidden two clicks deep is a way of telling experienced people the product is
          not for them, and they are the ones who notice.
        */}
        <button type="button" className="button button--bare wizard__skip" onClick={onSkip}>
          {skipLabel}
        </button>
      </div>
    </div>
  );
}
