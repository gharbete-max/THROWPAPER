import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../../../lib/session.js';
import { useT } from '../../../lib/i18n.js';
import { filesForSize, KEEP_SIZES, sizeText, type KeepSize } from '../../../lib/keep-size.js';
import { suggestName } from '../../../lib/suggest-name.js';
import { Banner } from '../../../components/Banner.js';
import { isPhoto } from '../../scan/scan-photo.js';

type Made = { files: File[]; bytes: number };

/**
 * Asked when a PDF is kept: its name, suggested from the first page and editable, and how big it
 * should be, with what each choice comes to shown before anything is downloaded. Lazy: it is
 * loaded when somebody presses the button.
 */
export default function KeepPanel({
  files,
  used,
  firstText,
  busy,
  onCancel,
  onKeep,
}: {
  files: File[];
  /** Which of `files` the page list uses. */
  used: number[];
  firstText: () => Promise<string>;
  busy: boolean;
  onCancel: () => void;
  onKeep: (files: File[], name: string) => void;
}) {
  const t = useT();
  const { locale } = useSession();
  const [name, setName] = useState(() => suggestName('', t('room.scan')));
  const [size, setSize] = useState<KeepSize>('original');
  const [made, setMade] = useState<Partial<Record<KeepSize, Made>>>({});
  const touched = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const photos = used.filter((index) => isPhoto(files[index]!));

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    let live = true;
    void firstText().then((text) => {
      if (live && !touched.current) setName(suggestName(text, t('room.scan')));
    });
    return () => {
      live = false;
    };
    // The suggestion is made once, from the first page as it is when this opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    for (const choice of KEEP_SIZES) {
      void filesForSize(files, (file) => isPhoto(file), choice).then((result) => {
        if (live) setMade((current) => ({ ...current, [choice]: result }));
      });
    }
    return () => {
      live = false;
    };
    // Sizes are worked out for the files as they are when this opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = made[size];
  const total = (choice: KeepSize) => {
    const result = made[choice];
    if (!result) return null;
    return used.reduce((sum, index) => sum + result.files[index]!.size, 0);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen && name.trim() !== '') onKeep(chosen.files, name);
  }

  return (
    <form className="keep stack" onSubmit={submit} data-testid="keep-panel">
      <Banner name="keep" />
      <h2>{t('docs.keep.heading')}</h2>
      <label className="field">
        {t('docs.keep.name')}
        <input
          ref={input}
          value={name}
          data-testid="keep-name"
          onChange={(event) => {
            touched.current = true;
            setName(event.target.value);
          }}
        />
      </label>
      {photos.length > 0 ? (
        <fieldset className="keep__sizes">
          <legend>{t('docs.keep.size')}</legend>
          {KEEP_SIZES.map((choice) => {
            const bytes = total(choice);
            return (
              <label key={choice} className="keep__size">
                <input
                  type="radio"
                  name="keep-size"
                  value={choice}
                  checked={size === choice}
                  onChange={() => setSize(choice)}
                />
                {t(`docs.keep.${choice}`)}
                <span
                  className="muted small"
                  data-testid={`keep-size-${choice}`}
                  data-bytes={bytes ?? undefined}
                >
                  {bytes === null
                    ? t('docs.keep.working')
                    : t('docs.keep.about', { size: sizeText(bytes, locale) })}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <p className="muted small">{t('docs.keep.pdfNote')}</p>
      )}
      <div className="row">
        <button type="submit" className="button" disabled={busy || !chosen || name.trim() === ''}>
          {t('docs.keep.save')}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {t('docs.keep.cancel')}
        </button>
      </div>
    </form>
  );
}
