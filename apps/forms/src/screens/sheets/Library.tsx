import { useEffect, useMemo, useState } from 'react';
import script from '../../../../../packs/spreadsheets/Loppa-Sheets.ps1?raw';
import { Icon } from '../../components/Icon.js';
import { saveBlob } from '../../lib/email-handoff.js';
import { useEdition } from '../../lib/edition.js';
import { useT } from '../../lib/i18n.js';
import { useSession } from '../../lib/session.js';
import '../../styles/sheets.css';
import { PartNav } from './PartNav.js';
import { COMMANDS, matches, pick, SCRIPT_NAME } from './library.js';

/**
 * Spreadsheets, the Library: the spreadsheet pack's script and what each of its commands does, to
 * copy or save (`docs/plan/SPREADSHEETS.md`, `packs/spreadsheets/README.md`).
 *
 * Loppa shows and hands over text. It never runs the script, never opens a workbook and never
 * touches a file of the person's: they save it and run it themselves, so the safety is in what the
 * script is (one readable file that only reads and writes new files), not in a promise made here.
 *
 * This catcher is desktop only (`ADR 0027` §3); a server edition says so and shows nothing else.
 */
export function Library() {
  const t = useT();
  const { locale } = useSession();
  const edition = useEdition();
  const language = locale.slice(0, 2).toLowerCase();
  const [query, setQuery] = useState('');
  const [said, setSaid] = useState<{ id: string; ok: boolean } | null>(null);

  // A confirmation is a moment, not a mode.
  useEffect(() => {
    if (said === null) return;
    const timer = setTimeout(() => setSaid(null), 2500);
    return () => clearTimeout(timer);
  }, [said]);

  const shown = useMemo(() => COMMANDS.filter((command) => matches(command, query)), [query]);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSaid({ id, ok: true });
    } catch {
      // Refused (no secure context, or no permission): say so, never pretend.
      setSaid({ id, ok: false });
    }
  }

  /** With a byte-order mark, so Windows PowerShell 5.1 reads å ä ö as the UTF-8 they are. */
  function save() {
    saveBlob(new Blob(['﻿', script], { type: 'text/plain;charset=utf-8' }), SCRIPT_NAME);
  }

  return (
    <main className="sheets" id="main">
      <PartNav current="library" />
      <header className="sheets__head">
        <h1>
          {t('room.spreadsheets')}: {t('sheets.library')}
        </h1>
        {edition === 'server' ? (
          <p>{t('sheets.desktopOnly')}</p>
        ) : (
          <p className="muted">{t('sheets.intro')}</p>
        )}
      </header>

      {edition === 'server' ? null : (
        <>
          <section className="card sheets__script" aria-labelledby="sheets-script">
            <p className="small muted">{t('sheets.kind')}</p>
            <h2 id="sheets-script">{SCRIPT_NAME}</h2>
            <p>{t('sheets.scriptNote')}</p>
            <div className="sheets__actions">
              <button type="button" className="button" onClick={() => void copy('script', script)}>
                <Icon name="copy" className="icon--lead" />
                {t('sheets.copyScript')}
              </button>
              <button type="button" className="button button--quiet" onClick={save}>
                <Icon name="download" className="icon--lead" />
                {t('sheets.saveScript')}
              </button>
              <Said said={said} id="script" />
            </div>
            <h3>{t('sheets.howTitle')}</h3>
            <ul className="sheets__how">
              <li>{t('sheets.howRun')}</li>
              <li>{t('sheets.howBlocked')}</li>
              <li>{t('sheets.howCsv')}</li>
            </ul>
          </section>

          <section aria-labelledby="sheets-commands">
            <h2 id="sheets-commands">{t('sheets.commands')}</h2>
            <label className="field field--search">
              <span className="small muted">{t('sheets.search')}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {shown.length === 0 ? (
              <p className="muted" aria-live="polite">
                {t('sheets.noMatch')}
              </p>
            ) : (
              <ul className="sheets__list">
                {shown.map((command) => {
                  const title = pick(command.title, language);
                  const summary = pick(command.summary, language);
                  const own = title.fallback ? { lang: 'en' } : {};
                  return (
                    <li key={command.id} className="card sheets__card" data-command={command.id}>
                      <h3 {...own}>{title.text}</h3>
                      <p {...own}>
                        {summary.text}
                        {title.fallback && (
                          <span className="small muted"> ({t('sheets.inEnglish')})</span>
                        )}
                      </p>
                      <pre className="sheets__code" tabIndex={0}>
                        <code>{command.usage}</code>
                      </pre>
                      <div className="sheets__actions">
                        <button
                          type="button"
                          className="button button--quiet small"
                          onClick={() => void copy(command.id, command.usage)}
                        >
                          <Icon name="copy" className="icon--lead" />
                          {t('sheets.copyCommand')}
                        </button>
                        <Said said={said} id={command.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/** "Copied", or why not, beside the button that was pressed; read aloud, and gone after a moment. */
function Said({ said, id }: { said: { id: string; ok: boolean } | null; id: string }) {
  const t = useT();
  const mine = said?.id === id ? said : null;
  return (
    <span className="small" role="status">
      {mine ? (mine.ok ? t('sheets.copied') : t('sheets.copyFailed')) : ''}
    </span>
  );
}
