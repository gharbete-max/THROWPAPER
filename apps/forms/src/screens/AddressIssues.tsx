import { useT } from '../lib/i18n.js';
import { blocks, type AddressIssue } from '../lib/address-hygiene.js';

/**
 * What looks wrong in a list of addresses, row by row, before anything is previewed: not an
 * address, the same address twice, a common mail domain with a slip in it, a shared mailbox.
 * Each row can be edited in place, fixed with the suggestion (never applied unasked) or skipped;
 * only an address that is not one holds the list back. Nothing here sends or deletes anything.
 */
export function AddressIssues({
  addresses,
  issues,
  skipped,
  onEdit,
  onSkip,
  onRestore,
}: {
  /** Every row's address as it stands now; `null` is a row already skipped. */
  addresses: readonly (string | null)[];
  issues: readonly AddressIssue[];
  skipped: number;
  onEdit: (index: number, address: string) => void;
  onSkip: (index: number) => void;
  onRestore?: () => void;
}) {
  const t = useT();
  const byRow = new Map<number, AddressIssue[]>();
  for (const issue of issues) byRow.set(issue.index, [...(byRow.get(issue.index) ?? []), issue]);
  if (byRow.size === 0 && skipped === 0) return null;

  const note = (issue: AddressIssue): string =>
    t(`hygiene.issue.${issue.kind}`, {
      row: issue.kind === 'duplicate' ? issue.of + 1 : 0,
      suggestion: issue.kind === 'typo' ? issue.suggestion : '',
    });

  return (
    <section className="stack stack--tight" data-testid="address-issues">
      {byRow.size > 0 && (
        <>
          <h3>{t('hygiene.heading')}</h3>
          {issues.some(blocks) && (
            <p className="status-down small" role="alert">
              {t('hygiene.blocked')}
            </p>
          )}
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t('hygiene.col.row')}</th>
                  <th>{t('hygiene.col.address')}</th>
                  <th>{t('hygiene.col.note')}</th>
                  <th>
                    <span className="visually-hidden">{t('table.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...byRow].map(([index, found]) => {
                  const typo = found.find((issue) => issue.kind === 'typo');
                  return (
                    <tr key={index} data-testid="address-issue">
                      <td>{index + 1}</td>
                      <td>
                        <input
                          value={addresses[index] ?? ''}
                          aria-label={t('hygiene.edit', { row: index + 1 })}
                          onChange={(event) => onEdit(index, event.target.value)}
                        />
                      </td>
                      <td>
                        <ul className="stack stack--tight">
                          {found.map((issue) => (
                            <li
                              key={issue.kind}
                              className={issue.kind === 'syntax' ? 'status-down small' : 'small'}
                            >
                              {note(issue)}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="row">
                        {typo?.kind === 'typo' && (
                          <button
                            type="button"
                            className="button button--quiet small"
                            onClick={() => onEdit(index, typo.suggestion)}
                          >
                            {t('hygiene.fix', { address: typo.suggestion })}
                          </button>
                        )}
                        <button
                          type="button"
                          className="button button--quiet small"
                          onClick={() => onSkip(index)}
                        >
                          {t('hygiene.skip')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {skipped > 0 && onRestore && (
        <div className="row">
          <button type="button" className="button button--quiet small" onClick={onRestore}>
            {t('hygiene.restore', { count: skipped })}
          </button>
        </div>
      )}
    </section>
  );
}
