import { useState } from 'react';
import {
  importAcroFields,
  MAX_PAPER_PAGES,
  type AcroField,
  type FormDefinition,
  type SkippedAcroField,
} from '@tp/shared/forms';
import { client } from '../../../lib/api.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { Icon } from '../../../components/Icon.js';
import { openPdf, TooManyPages } from './extract.js';
import { CropPhoto, WHOLE_PICTURE } from './CropPhoto.js';
import { isUsable, straightenFile, type Corners } from './warp.js';

/**
 * A form from the paper somebody already has.
 *
 * `docs/adr/0004-old-forms-on-paper.md`. A PDF made by a form tool declares its fields, and they
 * come in as questions with their place on the page; a photograph, or a PDF that is only a
 * picture, comes in as pages to draw on. Either way the result is an ordinary form — the paper
 * is where it came from, not what it is.
 *
 * ## Read first, store on confirm
 *
 * The file is opened in the browser to describe what importing it would do — pages, fields,
 * what was skipped and why — before anything is uploaded. Rule 7 as `ImportSurvey` does it:
 * importing replaces the draft, so the description comes first and the button is the
 * confirmation. Nothing reaches the server until it is pressed, so a wrong file costs nothing.
 */
export function ImportPaper({
  formId,
  onImport,
}: {
  formId: string;
  onImport: (definition: FormDefinition) => void;
}) {
  const t = useT();
  const { contentLocale: locale } = useSession();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: 'empty' });

  async function choose(files: FileList | null) {
    if (!files || files.length === 0) return;
    setState({ kind: 'reading' });
    try {
      setState(await read(Array.from(files), locale));
    } catch (error) {
      setState(
        error instanceof TooManyPages
          ? {
              kind: 'error',
              message: t('paper.tooManyPages', { count: error.pages, max: MAX_PAPER_PAGES }),
            }
          : { kind: 'error', message: t('paper.notReadable') },
      );
    }
  }

  async function apply() {
    if (state.kind !== 'ready') return;
    setState({ ...state, kind: 'storing' });
    try {
      const sources = [];
      for (const { file, pages, corners } of state.files) {
        // A photograph is straightened here, once, on the corners the author placed.
        const page = corners ? await straightenFile(file, corners) : file;
        const stored = await client.addPaper(formId, page);
        sources.push({ key: stored.key, pages });
      }
      onImport({ ...state.definition, paper: { sources } });
      setOpen(false);
      setState({ kind: 'empty' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!open) {
    return (
      <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>
        <Icon name="file" />
        {t('paper.open')}
      </button>
    );
  }

  return (
    <div className="card stack import">
      <div className="row row--between">
        <strong>{t('paper.heading')}</strong>
        <button
          type="button"
          className="button button--quiet button--icon"
          onClick={() => setOpen(false)}
          aria-label={t('import.cancel')}
        >
          <Icon name="close" />
        </button>
      </div>

      <p className="small muted">{t('paper.explain')}</p>

      {/*
        One picker for both. A phone's file picker already offers the camera beside the library,
        so `capture` — which on iOS *removes* the library — would take a choice away, not add one.
      */}
      <label className="field">
        <span>{t('paper.choose')}</span>
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => void choose(event.target.files)}
        />
      </label>

      <div className="stack small" role="status">
        {state.kind === 'reading' && <span className="muted">{t('paper.reading')}</span>}
        {state.kind === 'error' && <span className="status-down">{state.message}</span>}
        {(state.kind === 'ready' || state.kind === 'storing') && (
          <>
            <span className="status-up">{t('paper.pages', { count: state.pages })}</span>
            <span className={state.definition.fields.length > 0 ? 'status-up' : 'muted'}>
              {state.definition.fields.length > 0
                ? t('paper.fieldsFound', { count: state.definition.fields.length })
                : t('paper.noFields')}
            </span>
            {state.skipped.length > 0 && (
              <>
                <span className="status-warning">
                  {t('paper.skipped', { count: state.skipped.length })}
                </span>
                <ul className="import__skipped">
                  {state.skipped.map((entry, at) => (
                    <li key={at}>
                      {entry.name || entry.type} — {t(`paper.reason.${entry.reason}`)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {(state.kind === 'ready' || state.kind === 'storing') &&
        state.files.map((entry, index) =>
          entry.corners ? (
            <CropPhoto
              key={index}
              file={entry.file}
              corners={entry.corners}
              onChange={(corners) =>
                setState((was) =>
                  was.kind === 'ready'
                    ? {
                        ...was,
                        files: was.files.map((f, i) => (i === index ? { ...f, corners } : f)),
                      }
                    : was,
                )
              }
            />
          ) : null,
        )}

      <p className="small status-warning">{t('import.replaces')}</p>

      <div className="row">
        <button
          type="button"
          className="button"
          onClick={() => void apply()}
          disabled={
            state.kind !== 'ready' || state.files.some((f) => f.corners && !isUsable(f.corners))
          }
        >
          {state.kind === 'storing' ? t('paper.storing') : t('import.confirm')}
        </button>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
          {t('import.cancel')}
        </button>
      </div>
    </div>
  );
}

type Ready = {
  kind: 'ready' | 'storing';
  /** `corners` only on a photograph: where the author says the page is, as fractions. */
  files: Array<{ file: File; pages: number; corners?: Corners }>;
  pages: number;
  definition: FormDefinition;
  skipped: SkippedAcroField[];
};

type State = { kind: 'empty' } | { kind: 'reading' } | { kind: 'error'; message: string } | Ready;

/** What these files would become. Throws `TooManyPages`, or whatever pdfjs throws at a non-PDF. */
async function read(files: File[], locale: string): Promise<Ready> {
  const fields: AcroField[] = [];
  const counted: Ready['files'] = [];
  let pages = 0;

  for (const file of files) {
    if (file.type === 'application/pdf') {
      const pdf = await openPdf(await file.arrayBuffer(), pages);
      fields.push(...pdf.fields);
      counted.push({ file, pages: pdf.pageCount });
      pages += pdf.pageCount;
      await pdf.close();
    } else {
      counted.push({ file, pages: 1, corners: WHOLE_PICTURE });
      pages += 1;
    }
    if (pages > MAX_PAPER_PAGES) throw new TooManyPages(pages);
  }

  const imported = importAcroFields(fields, { locale });
  return {
    kind: 'ready',
    files: counted,
    pages,
    definition: imported.definition,
    skipped: imported.skipped,
  };
}
