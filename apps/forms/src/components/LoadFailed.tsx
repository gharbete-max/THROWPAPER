import { useT } from '../lib/i18n.js';
import { EmptyState } from './EmptyState.js';

/**
 * A list that could not be fetched, said as that — with the way to try again.
 *
 * Not an empty list, and not a spinner. Several screens turned a failed request into `[]`, so a
 * server that did not answer read as "no forms yet" or "no responses yet": a claim about the data
 * from a request that learned nothing about it, and on Forms an invitation to make a duplicate.
 * Two others waited on the request forever. `Inbox` already did this right; this is its pattern.
 */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon="warning"
      title={t('app.loadFailed')}
      action={
        <button className="button button--quiet" type="button" onClick={onRetry}>
          {t('public.retry')}
        </button>
      }
    />
  );
}
