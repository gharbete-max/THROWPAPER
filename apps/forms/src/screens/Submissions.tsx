import { useEffect, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { pickText } from '@tp/i18n';
import {
  answerableFields,
  columnsFor,
  toCsv,
  toSheetRows,
  type ExportColumn,
  type FormDefinition,
  type SubmissionResponse,
} from '@tp/shared/forms';
import type { SheetData } from 'write-excel-file/browser';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { formatDateTime, useT } from '../lib/i18n.js';

/**
 * The submissions table.
 *
 * TanStack Table with client-side sort and filter — START-HERE says to use a library here and
 * defer the real grid from `SPEC-shared.md` to A4, and v0.1 is ~200 rows, not 100,000.
 *
 * Export runs from the rows the table is currently showing, which is what makes export parity
 * true by construction rather than by a second implementation agreeing with the first.
 */
export function Submissions({ formId }: { formId: string }) {
  const t = useT();
  const { locale, locales } = useSession();
  const [rows, setRows] = useState<SubmissionResponse[] | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [separator, setSeparator] = useState<';' | ',' | '\t'>(';');

  useEffect(() => {
    client
      .listSubmissions(formId)
      .then((result) => {
        setRows(result.submissions);
        setDefinition(result.definition);
      })
      .catch(() => setRows([]));
  }, [formId]);

  /** Header text per column, in the operator's language. */
  const exportColumns: ExportColumn[] = useMemo(() => {
    if (!definition) return [];
    const fieldLabels = new Map(
      answerableFields(definition).map((field) => [
        field.key,
        pickText(locales, 'label' in field ? field.label : {}, locale).value || field.key,
      ]),
    );
    return columnsFor(definition, {
      header: (key) => t(`submissions.column.${key}`),
      fieldHeader: (key) => fieldLabels.get(key) ?? key,
    });
  }, [definition, locale, locales, t]);

  const data = useMemo(
    () =>
      (rows ?? []).map((row) => ({
        reference: row.reference,
        submittedAt: row.submittedAt ?? row.createdAt,
        locale: row.locale,
        status: row.status,
        ...row.data,
      })),
    [rows],
  );

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      exportColumns.map((column) => ({
        id: column.key,
        accessorKey: column.key,
        header: column.header,
        cell: (info) => renderCell(info.getValue(), column, locale),
      })),
    [exportColumns, locale],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  /** Exactly what is on screen: visible columns, current sort, current filter. */
  function visibleExport() {
    const visibleKeys = new Set(table.getVisibleLeafColumns().map((column) => column.id));
    const cols = exportColumns.filter((column) => visibleKeys.has(column.key));
    const visibleRows = table.getSortedRowModel().rows.map((row) => row.original);
    return { cols, visibleRows };
  }

  function exportCsv() {
    const { cols, visibleRows } = visibleExport();
    // UTF-8 BOM comes from toCsv; the charset here is what makes the browser keep it.
    download(
      new Blob([toCsv(cols, visibleRows, { separator })], {
        type: 'text/csv;charset=utf-8',
      }),
      'submissions.csv',
    );
  }

  async function exportXlsx() {
    const { cols, visibleRows } = visibleExport();
    // Loaded on demand, and from the browser entry point — the package has no root export.
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const sheet = toSheetRows(cols, visibleRows);

    // The cell type is left to the library to infer from the JavaScript value — toSheetRows
    // already produces real Date, number and boolean values, which is the whole point of it.
    // Every cell carries the same keys so the rows stay one homogeneous type; a header row of a
    // different shape makes TypeScript pick the library's "objects" overload instead.
    const data: SheetData = [
      cols.map((column) => ({ value: column.header, fontWeight: 'bold' as const })),
      ...sheet.map((row) =>
        row.map((cell) => ({
          value: cell.value ?? undefined,
          ...(cell.type === 'date' && { format: 'yyyy-mm-dd hh:mm' }),
        })),
      ),
    ];

    // v4 of the browser build returns a writer rather than taking a fileName option.
    await writeXlsxFile(data, { stickyRowsCount: 1 }).toFile('submissions.xlsx');
  }

  if (rows === null) return <p className="muted">{t('app.loading')}</p>;

  return (
    <section className="stack">
      <div className="row row--between">
        <h2>{t('submissions.title', { n: table.getFilteredRowModel().rows.length })}</h2>
        <div className="row">
          <select
            aria-label={t('submissions.separator')}
            value={separator}
            onChange={(event) => setSeparator(event.target.value as ';' | ',' | '\t')}
          >
            <option value=";">;</option>
            <option value=",">,</option>
            <option value="&#9;">tab</option>
          </select>
          <button className="button button--quiet" onClick={exportCsv}>
            {t('submissions.exportCsv')}
          </button>
          <button className="button button--quiet" onClick={exportXlsx}>
            {t('submissions.exportXlsx')}
          </button>
        </div>
      </div>

      <label className="field">
        <span className="small muted">{t('submissions.search')}</span>
        <input value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} />
      </label>

      <details className="card">
        <summary className="small">{t('submissions.columns')}</summary>
        <div className="stack">
          {table.getAllLeafColumns().map((column) => (
            <label className="field field--inline" key={column.id}>
              <input
                type="checkbox"
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
              />
              <span className="small">{String(column.columnDef.header)}</span>
            </label>
          ))}
        </div>
      </details>

      {table.getRowModel().rows.length === 0 ? (
        <p className="muted">{t('submissions.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id}>
                      <button
                        type="button"
                        className="grid__sort"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                      </button>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function renderCell(value: unknown, column: ExportColumn, locale: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'date') return formatDateTime(locale, String(value));
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '—';
  return String(value);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
