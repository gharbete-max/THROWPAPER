import { useState } from 'react';
import {
  importAcroFields,
  MAX_PAPER_PAGES,
  type AcroField,
  type FormDefinition,
  type SkippedAcroField,
} from '@tp/shared/forms';
import { ApiError, client } from '../../../lib/api.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { Icon } from '../../../components/Icon.js';
import { MAX_PASTE } from '@tp/shared/import';
import { fieldBoxes, openPdf, TooManyPages } from './extract.js';
import { CropPhoto, WHOLE_PICTURE } from './CropPhoto.js';
import { detectPage } from './detect.js';
import { CameraScan } from '../../../components/CameraScan.js';
import { isUsable, straightenFile, type Corners } from './warp.js';
import { clipboardText } from './clipboard.js';
import { isDocx, readDocx } from './docx.js';
import type { Reading } from './reading.js';
import { NoWorker, ReadingTooSlow, readInWorker } from './read-in-worker.js';
import { ReadingView } from './ReadingView.js';
import { DocxRefused } from './refusal.js';

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
 *
 * ## What was read (S7)
 *
 * A PDF's printed text, a Word document and pasted text are also read by the import's stages
 * (`docs/plan/IMPORT-PIPELINE.md`, in a worker), and what they read is shown: the numbered items
 * in reading order, and the whole reading as a download. Reading changes nothing — a Word
 * document or a paste has no page to import, so for those the confirmation stays shut — until
 * the review screen (S10) turns what was read into questions.
 */
export function ImportPaper({
  formId,
  onImport,
  startOpen = false,
}: {
  formId: string;
  onImport: (definition: FormDefinition) => void;
  /** Open on arrival: the "Start from paper" door lands here. */
  startOpen?: boolean;
}) {
  const t = useT();
  const { contentLocale: locale } = useSession();
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState<State>({ kind: 'empty' });

  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  function failed(error: unknown) {
    setState({
      kind: 'error',
      message:
        error instanceof TooManyPages
          ? t('paper.tooManyPages', { count: error.pages, max: MAX_PAPER_PAGES })
          : error instanceof DocxRefused
            ? t(`paper.docx.${error.reason}`)
            : error instanceof ReadingTooSlow
              ? t('paper.tooSlow')
              : error instanceof NoWorker
                ? t('paper.noWorker')
                : t('paper.notReadable'),
    });
  }

  async function choose(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setState({ kind: 'reading' });
    try {
      setState(await read(Array.from(files), locale));
    } catch (error) {
      failed(error);
    }
  }

  async function readPasted() {
    setState({ kind: 'reading' });
    try {
      const reading = await readInWorker({ kind: 'paste', text: pasted });
      setState({
        kind: 'ready',
        files: [],
        pages: 0,
        definition: importAcroFields([], { locale }).definition,
        skipped: [],
        readings: [{ name: t('paper.read.pasted'), reading }],
      });
    } catch (error) {
      failed(error);
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
      // The two refusals the server gives a PDF have their own words; anything else says what
      // the server said.
      const code = error instanceof ApiError ? error.code : '';
      setState({
        kind: 'error',
        message:
          code === 'pdf-too-costly'
            ? t('paper.tooCostly')
            : code === 'unreadable-pdf'
              ? t('paper.notReadable')
              : error instanceof Error
                ? error.message
                : String(error),
      });
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
      {scanning ? (
        // Pages from the live camera come in exactly as photographs picked from disk would.
        <CameraScan
          onCancel={() => setScanning(false)}
          onDone={(pages) => {
            setScanning(false);
            void choose(pages);
          }}
        />
      ) : (
        <div className="row">
          <label className="field">
            <span>{t('paper.choose')}</span>
            <input
              type="file"
              accept={`application/pdf,image/png,image/jpeg,image/webp,${DOCX_TYPE},.docx`}
              multiple
              onChange={(event) => void choose(event.target.files)}
            />
          </label>
          <button type="button" className="button button--quiet" onClick={() => setScanning(true)}>
            <Icon name="image" />
            {t('camera.open')}
          </button>
          <button
            type="button"
            className="button button--quiet"
            aria-expanded={pasting}
            onClick={() => setPasting((open) => !open)}
          >
            <Icon name="long_text" />
            {t('paper.paste.open')}
          </button>
        </div>
      )}

      {pasting && !scanning && (
        <div className="stack">
          <label className="field">
            <span>{t('paper.paste.label')}</span>
            <textarea
              rows={8}
              maxLength={MAX_PASTE}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              onPaste={(event) => {
                // Plain text is pasted by the browser as it is; only HTML alone is read here.
                if (event.clipboardData.getData('text/plain').trim() !== '') return;
                const text = clipboardText(event.clipboardData);
                if (text === '') return;
                event.preventDefault();
                const area = event.currentTarget;
                area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
                setPasted(area.value);
              }}
            />
          </label>
          <div className="row">
            <button
              type="button"
              className="button button--quiet"
              disabled={pasted.trim() === '' || state.kind === 'reading'}
              onClick={() => void readPasted()}
            >
              {t('paper.paste.read')}
            </button>
          </div>
        </div>
      )}

      <div className="stack small" role="status">
        {state.kind === 'reading' && <span className="muted">{t('paper.reading')}</span>}
        {state.kind === 'error' && <span className="status-down">{state.message}</span>}
        {(state.kind === 'ready' || state.kind === 'storing') && state.files.length > 0 && (
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

      {(state.kind === 'ready' || state.kind === 'storing') &&
        state.readings.map(({ name, reading }, index) => (
          <ReadingView key={index} name={name} reading={reading} />
        ))}

      {!((state.kind === 'ready' || state.kind === 'storing') && state.files.length === 0) && (
        <p className="small status-warning">{t('import.replaces')}</p>
      )}

      <div className="row">
        <button
          type="button"
          className="button"
          onClick={() => void apply()}
          disabled={
            state.kind !== 'ready' ||
            state.files.length === 0 ||
            state.files.some((f) => f.corners && !isUsable(f.corners))
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
  /**
   * The files that become the form's paper: PDFs and photographs. `corners` only on a
   * photograph: where the author says the page is, as fractions. A Word document or a paste has
   * no page, so it is read and shown but is not one of these.
   */
  files: Array<{ file: File; pages: number; corners?: Corners }>;
  pages: number;
  definition: FormDefinition;
  skipped: SkippedAcroField[];
  /** What the import's stages read from each document with text, by its name. */
  readings: Array<{ name: string; reading: Reading }>;
};

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type State = { kind: 'empty' } | { kind: 'reading' } | { kind: 'error'; message: string } | Ready;

/**
 * What these files would become, and what their text reads as. Throws `TooManyPages`,
 * `DocxRefused`, `ReadingTooSlow`, `NoWorker`, or whatever pdfjs throws at a non-PDF.
 */
async function read(files: File[], locale: string): Promise<Ready> {
  const fields: AcroField[] = [];
  const counted: Ready['files'] = [];
  const readings: Ready['readings'] = [];
  let pages = 0;

  for (const file of files) {
    if (isDocx(file)) {
      const raw = await readDocx(await file.arrayBuffer());
      readings.push({ name: file.name, reading: await readInWorker({ kind: 'raw', raw }) });
    } else if (file.type === 'application/pdf') {
      const pdf = await openPdf(await file.arrayBuffer(), pages);
      fields.push(...pdf.fields);
      const boxes = fieldBoxes(pdf.fields, pages);
      counted.push({ file, pages: pdf.pageCount });
      pages += pdf.pageCount;
      const raw = await pdf.raw();
      await pdf.close();
      readings.push({
        name: file.name,
        reading: await readInWorker({ kind: 'raw', raw, fields: boxes }),
      });
    } else {
      counted.push({ file, pages: 1, corners: (await detectPage(file)) ?? WHOLE_PICTURE });
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
    readings,
  };
}
