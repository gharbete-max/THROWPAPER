import { useState } from 'react';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';

/**
 * Downloads a file somebody attached to a submission.
 *
 * A button rather than an `<a href>`, and that is forced by the design rather than a preference:
 * the file is behind an authenticated endpoint, and a browser will not attach an `Authorization`
 * header to a plain link. So the bytes are fetched with the session, turned into a blob URL, and
 * handed to a link that is clicked and thrown away.
 *
 * The alternative — a signed URL that needs no session — was rejected where the endpoint was
 * written: a signed URL is a bearer token in a link, and links get forwarded and logged.
 *
 * The object URL is revoked immediately. Holding them is how a long-lived tab quietly accumulates
 * every file anybody has looked at.
 */
export function AttachmentLink({
  submissionId,
  storageKey,
  filename,
}: {
  submissionId: string;
  storageKey: string;
  filename: string;
}) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'fetching' | 'failed'>('idle');

  async function download() {
    setState('fetching');
    try {
      const blob = await client.submissionFile(submissionId, storageKey);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch {
      setState('failed');
    }
  }

  return (
    <button
      type="button"
      className="button button--quiet small attachment"
      onClick={download}
      disabled={state === 'fetching'}
      // The filename can be long; the title gives it back in full when the cell truncates it.
      title={filename}
    >
      <Icon name="paperclip" className="icon--lead" />
      {state === 'failed' ? t('file.error.network') : filename}
    </button>
  );
}
