import { useMemo, useRef, useState } from 'react';
import { guessColumns, parseTable, rowsFrom, type BatchRow, type ColumnMap } from '@tp/shared/api';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';

const COLUMNS = ['name', 'email', 'amount', 'reference'] as const;

/**
 * The list a send is made from — pasted, or a CSV file read in this browser — and the mapping of
 * its columns to name, email, amount and reference. Shared by the batch of documents and the
 * campaign, so a list is read the same way for both.
 */
export function useList() {
  const [text, setText] = useState('');
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>({ name: 0, email: 1, amount: 2, reference: 3 });
  const cells = useMemo(() => parseTable(text), [text]);
  const rows: BatchRow[] = useMemo(
    () => rowsFrom(header ? cells.slice(1) : cells, map),
    [cells, header, map],
  );
  /** A new list: guess the mapping from its first line. */
  const load = (content: string) => {
    setText(content);
    setMap(guessColumns(header ? (parseTable(content)[0] ?? []) : []));
  };
  return { text, header, setHeader, map, setMap, cells, rows, load };
}

export type List = ReturnType<typeof useList>;

/** The input half of the list step: file, paste, header toggle, mapping, and the row count. */
export function ListStep({
  list,
  intro,
  cap,
  capText,
}: {
  list: List;
  intro: string;
  /** The most rows one press takes, and what to say when the list is longer. */
  cap: number;
  capText: string;
}) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const { header, cells, map, rows } = list;
  const columnNames = header ? (cells[0] ?? []) : (cells[0] ?? []).map((_, i) => String(i + 1));

  return (
    <div className="stack">
      <p className="muted small">{intro}</p>
      <div className="row">
        <input
          ref={picker}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          hidden
          data-testid="batch-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void file.text().then(list.load);
            event.target.value = '';
          }}
        />
        <button type="button" className="button" onClick={() => picker.current?.click()}>
          <Icon name="upload" className="icon--lead" />
          {t('batch.list.file')}
        </button>
      </div>
      <label className="field">
        <span>{t('batch.list.paste')}</span>
        <textarea
          rows={8}
          value={list.text}
          data-testid="batch-text"
          onChange={(event) => list.load(event.target.value)}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={header}
          onChange={(event) => list.setHeader(event.target.checked)}
        />
        <span>{t('batch.list.header')}</span>
      </label>
      {cells.length > 0 && (
        <div className="row">
          {COLUMNS.map((field) => (
            <label key={field} className="field">
              <span>{t(`batch.map.${field}`)}</span>
              <select
                value={map[field]}
                onChange={(event) => list.setMap({ ...map, [field]: Number(event.target.value) })}
              >
                <option value={-1}>{t('batch.map.none')}</option>
                {columnNames.map((name, index) => (
                  <option key={index} value={index}>
                    {name || t('batch.column', { n: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <p className="small" aria-live="polite" data-testid="batch-count">
        {t('batch.rows', { count: rows.length })}
      </p>
      {rows.length > cap && (
        <p className="status-down small" role="alert">
          {capText}
        </p>
      )}
    </div>
  );
}
