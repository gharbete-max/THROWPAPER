import { useState } from 'react';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';

/**
 * Choose an image, or clear it.
 *
 * The file goes straight to `/v1/uploads` and what is stored is the path that came back — never a
 * URL somebody typed. The server decides what an image is by reading its bytes, so the failure
 * worth showing here is the server's own message, verbatim: "SVG is not supported, upload a PNG
 * instead" tells somebody what to do next; "upload failed" does not.
 *
 * Shared by the brand editor and the form builder, because "pick a picture" should not behave
 * differently depending on which screen you are on.
 */
export function ImagePicker({
  value,
  disabled = false,
  compact = false,
  label,
  onChange,
}: {
  value: string | null;
  disabled?: boolean;
  /** A smaller preview, for a row in a list of options. */
  compact?: boolean;
  label?: string;
  onChange: (path: string | null) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const uploaded = await client.upload(file);
      onChange(uploaded.path);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {value && (
        <div
          className={
            compact
              ? 'image-picker__preview image-picker__preview--compact'
              : 'image-picker__preview'
          }
        >
          <img src={value} alt={t('image.previewAlt')} />
        </div>
      )}

      <label className="field">
        <span>{label ?? (value ? t('image.replace') : t('image.add'))}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={disabled || busy}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            // Cleared so choosing the same file twice still fires a change.
            event.target.value = '';
          }}
        />
        {!compact && <span className="small muted">{t('image.hint')}</span>}
      </label>

      {busy && <p className="small muted">{t('image.uploading')}</p>}
      {problem && <p className="small status-down">{problem}</p>}

      {value && !disabled && (
        <button type="button" className="secondary small" onClick={() => onChange(null)}>
          {t('image.remove')}
        </button>
      )}
    </div>
  );
}
