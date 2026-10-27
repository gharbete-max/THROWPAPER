import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { pickText } from '@tp/i18n';
import { emptyDefinition, type FormTemplate } from '@tp/shared/forms';
import type { DraftForm } from '@tp/shared/ai';
import { ApiError, client } from '../../lib/api.js';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { Icon } from '../../components/Icon.js';
import { Doors } from './builder/guided/Doors.js';

/**
 * New form: one question on an empty page (`docs/plan/EASY.md`).
 *
 * No rail, no top bar, no list of forms and no template gallery: just "What do you want to make?"
 * and a way back. Typed words lead to a template, to another part of the app, or (with an AI model
 * installed) to a draft; the other starts sit under the box as small links. Nothing is created
 * until something is pressed, so leaving this page leaves nothing behind.
 */
export function NewForm() {
  const t = useT();
  const navigate = useNavigate();
  const { locale, locales, interfaceLocales } = useSession();
  const door = useSearchParams()[0].get('door');
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetched once and kept: the catalogue ships with the product and does not change under us.
  useEffect(() => {
    client
      .formTemplates()
      .then((result) => setTemplates(result.templates))
      .catch(() => setTemplates([]));
  }, []);

  const nameIn = (template: FormTemplate) =>
    pickText(interfaceLocales, template.name, locale).value;

  /** The conversation (no form yet: its first answer makes one) or the paper import (a blank form). */
  async function openBlank(which: 'questions' | 'paper') {
    setError(null);
    if (which === 'questions') {
      void navigate(`/forms/${crypto.randomUUID()}/guided`, { state: { fresh: true } });
      return;
    }
    await make({ title: t('forms.untitled') }, (id) => `/forms/${id}/import`);
  }

  async function make(
    input: { title: string; templateId?: string; draft?: DraftForm },
    to: (id: string) => string = (id) => `/forms/${id}`,
  ) {
    setError(null);
    setOpening(true);
    try {
      // The slug is derived rather than asked for; it is editable afterwards like everything else.
      const created = await client.createForm({
        slug: `form-${Date.now().toString(36)}`,
        title: { [locales.default]: input.title },
        ...(input.templateId ? { templateId: input.templateId } : {}),
      });
      if (input.draft) {
        await client.saveDraft(created.id, { ...emptyDefinition, fields: input.draft.fields });
      }
      void navigate(to(created.id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
      setOpening(false);
    }
  }

  return (
    <main className="newform" id="main">
      <Link className="button button--bare small newform__back" to="/forms">
        <Icon name="arrow-left" className="icon--lead" />
        {t('forms.title')}
      </Link>
      <Doors
        templates={templates}
        nameIn={nameIn}
        onTemplate={(id) => {
          const template = templates.find((candidate) => candidate.id === id);
          if (template) void make({ title: nameIn(template), templateId: id });
        }}
        onRoute={(path) => void navigate(path)}
        onDraft={(draft) => void make({ title: draft.title || t('forms.untitled'), draft })}
        locale={locales.default}
        onQuestions={() => void openBlank('questions')}
        onPaper={() => void openBlank('paper')}
        onMyself={() => void navigate('/forms?new=manual')}
        focus={door === 'paper' ? 'paper' : door === 'questions' ? 'questions' : undefined}
        busy={opening}
        error={error}
      />
    </main>
  );
}
