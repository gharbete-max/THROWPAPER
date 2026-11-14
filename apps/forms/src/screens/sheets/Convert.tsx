import { useMemo, useState, type DragEvent } from 'react';
import { saveBlob } from '../../lib/email-handoff.js';
import { useEdition } from '../../lib/edition.js';
import { useT } from '../../lib/i18n.js';
import '../../styles/sheets.css';
import { PartNav } from './PartNav.js';
import {
  analyse,
  convert,
  ENCODINGS,
  SEPARATORS,
  type DecimalMark,
  type Encoding,
  type OutEncoding,
  type Separator,
} from './csv.js';

const MAX_BYTES = 20 * 1024 * 1024;
const PREVIEW_ROWS = 8;
const PREVIEW_COLUMNS = 8;

/** Encoding names are what programs call them, not words to translate. */
const ENCODING_NAMES: Record<Encoding, string> = {
  'utf-8': 'UTF-8',
  'windows-1252': 'Windows-1252',
  'utf-16le': 'UTF-16',
  shift_jis: 'Shift_JIS',
};

/** What this computer's Excel expects: a country that writes 1,5 uses a semicolon between fields. */
function localStyle(): { decimal: DecimalMark; separator: Separator } {
  const decimal: DecimalMark = new Intl.NumberFormat(navigator.language).format(1.5).includes(',')
    ? ','
    : '.';
  return { decimal, separator: decimal === ',' ? ';' : ',' };
}

/**
 * Spreadsheets, Convert: a CSV file read for what it is and written again the way this computer's
 * Excel wants it (`docs/plan/SPREADSHEETS.md` §2, Convert). Everything happens in the window: the
 * file is read here, shown here and saved from here; nothing is sent anywhere and the original is
 * never touched.
 */
export function Convert() {
  const t = useT();
  const edition = useEdition();
  const local = useMemo(localStyle, []);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [encoding, setEncoding] = useState<Encoding | null>(null);
  const [separator, setSeparator] = useState<Separator | null>(null);
  const [outSeparator, setOutSeparator] = useState<Separator>(local.separator);
  const [outDecimal, setOutDecimal] = useState<DecimalMark | 'keep'>('keep');
  const [outEncoding, setOutEncoding] = useState<OutEncoding>('utf-8-bom');
  const [error, setError] = useState<'sheets.errBig' | 'sheets.errEmpty' | 'sheets.errRead' | null>(
    null,
  );
  const [result, setResult] = useState<{
    name: string;
    changed: number;
    unencodable: number;
  } | null>(null);

  const analysis = useMemo(
    () => (file ? analyse(file.bytes, encoding, separator) : null),
    [file, encoding, separator],
  );

  async function open(chosen: File | undefined) {
    if (!chosen) return;
    setResult(null);
    if (chosen.size > MAX_BYTES) return fail('sheets.errBig');
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      if (bytes.length === 0) return fail('sheets.errEmpty');
      const found = analyse(bytes);
      setError(null);
      setFile({ name: chosen.name, bytes });
      setEncoding(null);
      setSeparator(null);
      // Offered, never forced: turn the numbers into this computer's style when they are not in it.
      setOutDecimal(
        found.decimal !== null && found.decimal !== local.decimal ? local.decimal : 'keep',
      );
    } catch {
      fail('sheets.errRead');
    }
  }

  function fail(key: 'sheets.errBig' | 'sheets.errEmpty' | 'sheets.errRead') {
    setFile(null);
    setError(key);
  }

  function save() {
    if (!file || !analysis) return;
    const out = convert(analysis.rows, {
      separator: outSeparator,
      from: analysis.decimal,
      to: outDecimal,
      encoding: outEncoding,
    });
    const name = `${file.name.replace(/\.[^.]*$/, '')}-converted.csv`;
    saveBlob(new Blob([out.bytes as BlobPart], { type: 'text/csv' }), name);
    setResult({ name, changed: out.changed, unencodable: out.unencodable });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    void open(event.dataTransfer.files[0]);
  }

  const separatorName: Record<Separator, string> = {
    ';': t('sheets.sepSemicolon'),
    ',': t('sheets.sepComma'),
    '\t': t('sheets.sepTab'),
    '|': t('sheets.sepBar'),
  };
  const columns = analysis ? Math.max(0, ...analysis.rows.map((row) => row.length)) : 0;
  const decimalName =
    analysis?.decimal === ','
      ? t('sheets.decComma')
      : analysis?.decimal === '.'
        ? t('sheets.decDot')
        : t('sheets.decNone');

  return (
    <main
      className="sheets"
      id="main"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <PartNav current="convert" />
      <header className="sheets__head">
        <h1>
          {t('room.spreadsheets')}: {t('sheets.convert')}
        </h1>
        {edition === 'server' ? (
          <p>{t('sheets.desktopOnly')}</p>
        ) : (
          <p className="muted">{t('sheets.convertIntro')}</p>
        )}
      </header>

      {edition === 'server' ? null : (
        <>
          <section className="card">
            <label className="button">
              {t('sheets.pick')}
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                hidden
                data-testid="sheets-file"
                onChange={(event) => {
                  void open(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>{' '}
            <span className="muted">{t('sheets.drop')}</span>
            {error && (
              <p role="alert" className="sheets__error">
                {t(error)}
              </p>
            )}
          </section>

          {file && analysis && (
            <>
              <section className="card" aria-labelledby="sheets-found">
                <h2 id="sheets-found">
                  {t('sheets.found')}: {file.name}
                </h2>
                <div className="sheets__fields">
                  <label className="field">
                    <span className="small muted">{t('sheets.sepLabel')}</span>
                    <select
                      value={analysis.separator}
                      onChange={(event) => setSeparator(event.target.value as Separator)}
                    >
                      {SEPARATORS.map((s) => (
                        <option key={s} value={s}>
                          {separatorName[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="small muted">{t('sheets.encLabel')}</span>
                    <select
                      value={analysis.decoded.encoding}
                      onChange={(event) => setEncoding(event.target.value as Encoding)}
                    >
                      {ENCODINGS.map((e) => (
                        <option key={e} value={e}>
                          {ENCODING_NAMES[e]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <dl className="sheets__facts">
                  <dt>{t('sheets.rows')}</dt>
                  <dd>{analysis.rows.length}</dd>
                  <dt>{t('sheets.columns')}</dt>
                  <dd>{columns}</dd>
                  <dt>{t('sheets.decLabel')}</dt>
                  <dd>{decimalName}</dd>
                </dl>
                <h3>{t('sheets.preview')}</h3>
                <div className="sheets__preview" tabIndex={0}>
                  <table>
                    <tbody>
                      {analysis.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                        <tr key={r}>
                          {row.slice(0, PREVIEW_COLUMNS).map((cell, c) =>
                            r === 0 ? (
                              <th key={c} scope="col">
                                {cell}
                              </th>
                            ) : (
                              <td key={c}>{cell}</td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card" aria-labelledby="sheets-out">
                <h2 id="sheets-out">{t('sheets.outTitle')}</h2>
                <p className="muted small">{t('sheets.outHint')}</p>
                <div className="sheets__fields">
                  <label className="field">
                    <span className="small muted">{t('sheets.sepLabel')}</span>
                    <select
                      value={outSeparator}
                      onChange={(event) => setOutSeparator(event.target.value as Separator)}
                    >
                      {SEPARATORS.map((s) => (
                        <option key={s} value={s}>
                          {separatorName[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="small muted">{t('sheets.decLabel')}</span>
                    <select
                      value={outDecimal}
                      onChange={(event) =>
                        setOutDecimal(event.target.value as DecimalMark | 'keep')
                      }
                    >
                      <option value="keep">{t('sheets.keepAsIs')}</option>
                      <option value=",">{t('sheets.decComma')}</option>
                      <option value=".">{t('sheets.decDot')}</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="small muted">{t('sheets.encLabel')}</span>
                    <select
                      value={outEncoding}
                      onChange={(event) => setOutEncoding(event.target.value as OutEncoding)}
                    >
                      <option value="utf-8-bom">{t('sheets.outEncBom')}</option>
                      <option value="utf-8">{t('sheets.outEncPlain')}</option>
                      <option value="windows-1252">{t('sheets.outEnc1252')}</option>
                    </select>
                  </label>
                </div>
                <p className="small muted">{t('sheets.leftAlone')}</p>
                <div className="sheets__actions">
                  <button type="button" className="button" onClick={save}>
                    {t('sheets.save')}
                  </button>
                  <span className="small" role="status">
                    {result && (
                      <>
                        {t('sheets.saved', { name: result.name })}{' '}
                        {result.changed > 0 &&
                          t('sheets.numbersChanged', { count: result.changed })}{' '}
                        {result.unencodable > 0 && t('sheets.lost', { count: result.unencodable })}
                      </>
                    )}
                  </span>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
