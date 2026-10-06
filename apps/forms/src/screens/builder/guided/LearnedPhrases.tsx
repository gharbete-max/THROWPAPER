import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { BUILDER_GRAPH, optionsOf } from '@tp/shared/builder';
import {
  aliasInert,
  compareAliases,
  type AliasImportResult,
  type AliasRefusalReason,
  type LearnedAlias,
} from '@tp/shared/interpret';
import { useConfirm } from '../../../components/Confirm.js';
import { Icon } from '../../../components/Icon.js';
import { LoadFailed } from '../../../components/LoadFailed.js';
import { Loading } from '../../../components/Loading.js';
import { ApiError, client } from '../../../lib/api.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';

/**
 * Learned phrases — the organisation's learned aliases (`INTENT-LADDER.md`, "Aliases", S6): every
 * way its people have taught Loppa to say an answer, each stored only because someone pressed
 * "Remember" on that exact phrase. An administrator lists, deletes, exports and imports them, and
 * can go back to the built-in ones. Deleting asks first (rule 7); an import shows what it would do
 * — added, already known, refused and why — and stores nothing until it is confirmed.
 */

/** The most remembered first, then the alias file's order. */
export function listed(aliases: readonly LearnedAlias[]): LearnedAlias[] {
  return [...aliases].sort((a, b) => b.count - a.count || compareAliases(a, b));
}

const REFUSED: Record<AliasRefusalReason, string> = {
  present: 'phrases.refused.present',
  collision: 'phrases.refused.collision',
  'shadows-id': 'phrases.refused.shadowsId',
  empty: 'phrases.refused.empty',
  'too-long': 'phrases.refused.tooLong',
  'unknown-node': 'phrases.refused.unknown',
  'unknown-option': 'phrases.refused.unknown',
};

type Preview = { readonly file: unknown; readonly diff: AliasImportResult };

export function LearnedPhrases() {
  const t = useT();
  const confirm = useConfirm();
  const { user, locale } = useSession();
  const [aliases, setAliases] = useState<LearnedAlias[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setFailed(false);
    client
      .learnedAliases()
      .then((result) => setAliases(result.aliases))
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  if (user && user.role !== 'admin') return <Navigate to="/forms" replace />;
  if (failed) return <LoadFailed onRetry={load} />;
  if (!aliases) return <Loading />;

  const question = (nodeId: string) => {
    const node = BUILDER_GRAPH.nodes.find((n) => n.id === nodeId);
    return node ? t(node.ask) : nodeId;
  };
  const answer = (nodeId: string, optionId: string) => {
    const node = BUILDER_GRAPH.nodes.find((n) => n.id === nodeId);
    const option = node ? optionsOf(node).find((o) => o.id === optionId) : undefined;
    return option ? t(option.label) : optionId;
  };
  const language = (code: string) =>
    new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  const date = (day: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    );
  const failedWith = (cause: unknown) =>
    setError(cause instanceof ApiError ? cause.message : t('phrases.failed'));

  async function forget(alias: LearnedAlias) {
    if (!(await confirm(t('phrases.confirmDelete', { phrase: alias.phrase })))) return;
    setError(null);
    try {
      await client.forgetAlias(alias.id);
      load();
    } catch (cause) {
      failedWith(cause);
    }
  }

  async function forgetAll(count: number) {
    if (!(await confirm(t('phrases.confirmClear', { count })))) return;
    setError(null);
    try {
      await client.forgetAllAliases();
      setNotice(t('phrases.cleared'));
      load();
    } catch (cause) {
      failedWith(cause);
    }
  }

  async function exportFile() {
    setError(null);
    try {
      const blob = await client.exportAliases();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = 'aliases.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      failedWith(cause);
    }
  }

  /** A file chosen: what it would do, shown before anything is stored. */
  async function chosen(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError(t('phrases.invalid', { problem: file.name }));
      return;
    }
    try {
      setPreview({ file: parsed, diff: await client.importAliases(parsed, false) });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'invalid-alias-file'
          ? t('phrases.invalid', { problem: cause.message })
          : t('phrases.failed'),
      );
    }
  }

  async function importConfirmed(pending: Preview) {
    setError(null);
    try {
      const done = await client.importAliases(pending.file, true);
      setPreview(null);
      setNotice(t('phrases.imported', { count: done.added.length }));
      load();
    } catch (cause) {
      failedWith(cause);
    }
  }

  const rows = listed(aliases);

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('phrases.title')}</h1>
        <p className="muted small">{t('phrases.intro')}</p>
      </header>

      <div className="row card__actions">
        <button type="button" className="button button--quiet" onClick={() => void exportFile()}>
          <Icon name="download" className="icon--lead" />
          {t('phrases.export')}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => picker.current?.click()}
        >
          <Icon name="upload" className="icon--lead" />
          {t('phrases.import')}
        </button>
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            void chosen(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {rows.length > 0 && (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void forgetAll(rows.length)}
          >
            {t('phrases.clear')}
          </button>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}

      {preview && (
        <ImportPreview
          preview={preview}
          answer={answer}
          onConfirm={() => void importConfirmed(preview)}
          onCancel={() => setPreview(null)}
        />
      )}

      {rows.length === 0 ? (
        <p className="muted">{t('phrases.empty')}</p>
      ) : (
        <ul className="phrases">
          {rows.map((alias) => (
            <li key={alias.id} className="phrases__row">
              <div className="stack stack--tight">
                <q className="phrases__phrase" lang={alias.locale}>
                  {alias.phrase}
                </q>
                <span className="small">
                  {aliasInert(BUILDER_GRAPH, alias)
                    ? t('phrases.inert')
                    : t('phrases.means', {
                        question: question(alias.nodeId),
                        answer: answer(alias.nodeId, alias.optionId),
                      })}
                </span>
                <span className="small muted">
                  {language(alias.locale)} · {date(alias.createdAt)} ·{' '}
                  {t('phrases.count', { count: alias.count })}
                </span>
              </div>
              <button
                type="button"
                className="button button--quiet small"
                onClick={() => void forget(alias)}
                aria-label={t('phrases.deleteNamed', { phrase: alias.phrase })}
              >
                {t('phrases.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What an import would do — nothing is stored until "Add" is pressed. */
export function ImportPreview({
  preview,
  answer,
  onConfirm,
  onCancel,
}: {
  preview: Preview;
  answer: (nodeId: string, optionId: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { added, present, refused } = preview.diff;
  return (
    <div className="card stack" role="region" aria-label={t('phrases.preview.title')}>
      <h2>{t('phrases.preview.title')}</h2>
      <p className="small">
        {t('phrases.preview.added', { count: added.length })} ·{' '}
        {t('phrases.preview.present', { count: present.length })} ·{' '}
        {t('phrases.preview.refused', { count: refused.length })}
      </p>
      {refused.length > 0 && (
        <ul className="small">
          {refused.map(({ entry, reason, means }, i) => (
            <li key={i}>
              <q lang={entry.locale}>{entry.phrase}</q>{' '}
              {t(REFUSED[reason], { option: means ? answer(entry.nodeId, means) : '' })}
            </li>
          ))}
        </ul>
      )}
      <div className="row card__actions">
        <button type="button" className="button" disabled={added.length === 0} onClick={onConfirm}>
          {t('phrases.preview.confirm', { count: added.length })}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {t('phrases.preview.cancel')}
        </button>
      </div>
    </div>
  );
}
