import { useRef, useState } from 'react';
import { extensionsFor, type FileAccept } from '@tp/shared/forms';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';

/**
 * Attaching a file, from the person filling in the form.
 *
 * The upload happens **when the file is chosen**, not when the form is submitted, and the answer
 * is the key that comes back. Two reasons: a page with three attachments would otherwise post
 * thirty megabytes in one request and fail as a unit, and somebody who fills in a long form only
 * to lose it to a failed upload at the last step has no way to recover.
 *
 * The trade is an upload that may never be claimed — which is why the row it writes records that
 * nothing has taken it, and why the server treats an unclaimed row as the thing an answer is
 * allowed to name.
 */
type State =
  | { phase: 'empty' }
  | { phase: 'uploading'; filename: string }
  | { phase: 'attached'; filename: string; bytes: number }
  | { phase: 'failed'; code: string };

export function FileField({
  slug,
  fieldKey,
  accept,
  maxBytes,
  value,
  onChange,
}: {
  /** Which form this belongs to — the endpoint is per form, and so is the check on the answer. */
  slug: string;
  fieldKey: string;
  accept: FileAccept;
  maxBytes: number;
  value: string;
  onChange: (key: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>(
    value ? { phase: 'attached', filename: value, bytes: 0 } : { phase: 'empty' },
  );

  /** `.png,.jpg,…` — a hint for the picker only. The bytes are what the server believes. */
  const acceptAttribute = extensionsFor(accept)
    .map((extension) => `.${extension}`)
    .join(',');

  async function send(file: File) {
    // Checked here so an obviously oversized file is refused instantly rather than after a
    // minute of uploading. The server enforces the same cap regardless.
    if (file.size > maxBytes) {
      setState({ phase: 'failed', code: 'too-large' });
      return;
    }

    setState({ phase: 'uploading', filename: file.name });
    const body = new FormData();
    body.append('file', file);

    try {
      const response = await fetch(
        `/api/public/forms/${slug}/uploads?field=${encodeURIComponent(fieldKey)}`,
        { method: 'POST', body },
      );
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        setState({ phase: 'failed', code: problem?.error?.code ?? 'unsupported-format' });
        return;
      }
      const stored = (await response.json()) as { key: string; filename: string; bytes: number };
      onChange(stored.key);
      setState({ phase: 'attached', filename: stored.filename, bytes: stored.bytes });
    } catch {
      setState({ phase: 'failed', code: 'network' });
    }
  }

  function clear() {
    onChange('');
    setState({ phase: 'empty' });
    if (input.current) input.current.value = '';
  }

  return (
    <div className="file-field stack stack--tight">
      {/* Kept mounted rather than swapped out, so the label stays attached to one control and a
          screen reader is not told the field disappeared and came back. */}
      <input
        ref={input}
        type="file"
        accept={acceptAttribute}
        hidden={state.phase === 'attached'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
        }}
      />

      {state.phase === 'uploading' && (
        <span className="small muted">{t('file.uploading', { name: state.filename })}</span>
      )}

      {state.phase === 'attached' && (
        <span className="row file-field__attached">
          <Icon name="paperclip" className="icon--lead" />
          <span className="small">{state.filename}</span>
          <button type="button" className="button button--quiet small" onClick={clear}>
            {t('file.remove')}
          </button>
        </span>
      )}

      {state.phase === 'failed' && (
        <span className="small status-down">{t(`file.error.${state.code}`)}</span>
      )}

      <span className="small muted">
        {t('file.hint', {
          kinds: t(`file.accept.${accept}`),
          size: Math.floor(maxBytes / 1024 / 1024),
        })}
      </span>
    </div>
  );
}
