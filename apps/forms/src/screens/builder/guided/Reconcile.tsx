import { useState } from 'react';
import type { LocaleConfig } from '@tp/i18n';
import type { Conversation } from '@tp/shared/builder';
import type { Field, FormDefinition } from '@tp/shared/forms';
import { useT } from '../../../lib/i18n.js';
import { FormPreview } from '../FormPreview.js';
import { Cards } from './NodeView.js';

/**
 * "You changed this by hand. Keep your version, or use the guided one?" — Keep mine / Use guided /
 * Show both (`PREDICTIVE-BUILDER.md`, "Reconciliation"). Asked when the conversation would have
 * changed a question a person had changed; until it is answered the draft keeps the person's
 * version and the conversation's waits. One question at a time, one decision on the screen.
 *
 * "Show both" puts the two side by side as real previews, then asks the same question again.
 */
export function Reconcile({
  conversation,
  fieldId,
  contentLocales,
  contentLocale,
  onKeepMine,
  onUseGuided,
}: {
  conversation: Conversation;
  fieldId: string;
  contentLocales: LocaleConfig;
  contentLocale: string;
  onKeepMine: () => void;
  onUseGuided: () => void;
}) {
  const t = useT();
  const [both, setBoth] = useState(false);
  const { definition } = conversation.state.draft;
  const mine = definition.fields.find((field) => field.id === fieldId);
  const guided = conversation.state.sidecar.fields[fieldId]?.proposal as Field | undefined;
  if (!mine || !guided) return null;
  const only = (field: Field): FormDefinition => ({ ...definition, fields: [field] });

  return (
    <>
      <Cards
        items={[
          { id: 'mine', label: 'conversation.reconcile.mine' },
          { id: 'guided', label: 'conversation.reconcile.guided' },
          ...(both ? [] : [{ id: 'both', label: 'conversation.reconcile.both' }]),
        ]}
        onPick={(id) => {
          if (id === 'mine') onKeepMine();
          else if (id === 'guided') onUseGuided();
          else setBoth(true);
        }}
      />
      <div className={both ? 'reconcile reconcile--both' : 'reconcile'}>
        <figure className="reconcile__side">
          <figcaption className="small muted">{t('conversation.reconcile.yours')}</figcaption>
          <FormPreview
            definition={only(mine)}
            locale={contentLocale}
            locales={contentLocales}
            selectedId={null}
          />
        </figure>
        {both && (
          <figure className="reconcile__side">
            <figcaption className="small muted">{t('conversation.reconcile.theirs')}</figcaption>
            <FormPreview
              definition={only(guided)}
              locale={contentLocale}
              locales={contentLocales}
              selectedId={null}
            />
          </figure>
        )}
      </div>
    </>
  );
}
