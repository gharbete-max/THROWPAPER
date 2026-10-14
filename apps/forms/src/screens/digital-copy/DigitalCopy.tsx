import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { LOCALE_CODES, localeLabel } from '@tp/i18n';
import {
  digitalCopy,
  editWord,
  isUncertain,
  uncertainWords,
  type DigitalCopy as Copy,
} from '@tp/shared/import';
import { Icon } from '../../components/Icon.js';
import { copyToForm } from '../../lib/copy-handoff.js';
import { useT } from '../../lib/i18n.js';
import { useSession } from '../../lib/session.js';
import { useToast } from '../../lib/toast.js';
import { keepPdf, keepSvg, keepText, startForm } from './keep.js';
import { readForCopy, withFixes, type CopyRead } from './read.js';
import { INK, PAPER, Sheet } from './Sheet.js';

/**
 * "Make a digital copy" (`docs/plan/IMPROVEMENTS.md`, Track B): a photographed page as lines and
 * text only, read on this device. A lazy chunk, opened from Scan by one button on a page.
 *
 * The photograph and its copy are side by side. Nothing is guessed in silence: every word the
 * reader was unsure of is underlined (in this view only) and can be fixed, one by one or by
 * stepping through the words with the buttons, before the copy is kept. The photograph itself is
 * never changed; what is read is a copy drawn here, upright.
 */

interface Props {
  /** The page: a photograph, or a page drawn from a PDF. */
  source: Blob | HTMLCanvasElement;
  /** Degrees clockwise the person turned the page by in Scan. */
  turn: number;
  onClose: () => void;
}

type Kind = 'pdf' | 'searchable' | 'svg' | 'text' | 'form';

export default function DigitalCopy({ source, turn, onClose }: Props) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { locale, locales } = useSession();
  const [language, setLanguage] = useState<string>(
    LOCALE_CODES.includes(locale as never) ? locale : 'en-GB',
  );
  const [phase, setPhase] = useState<'reading' | 'failed' | 'ready'>('reading');
  const [read, setRead] = useState<CopyRead | null>(null);
  const [copy, setCopy] = useState<Copy | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<Kind | null>(null);
  const field = useRef<HTMLInputElement>(null);

  // The page is read again when the language is changed; an older reading that finishes late is dropped.
  useEffect(() => {
    let live = true;
    setPhase('reading');
    setSelected(null);
    readForCopy(source, turn, language).then(
      (done) => {
        if (!live) return;
        setRead(done);
        setCopy(digitalCopy(done.recognised, done.found));
        setPhase('ready');
      },
      () => live && setPhase('failed'),
    );
    return () => {
      live = false;
    };
  }, [source, turn, language]);

  useEffect(() => {
    if (!read) return;
    const url = URL.createObjectURL(read.picture);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [read]);

  const unsure = useMemo(() => (copy ? uncertainWords(copy) : []), [copy]);

  function select(index: number | null) {
    setSelected(index);
    setDraft(index === null || !copy ? '' : copy.words[index]!.text);
    if (index !== null) requestAnimationFrame(() => field.current?.focus());
  }

  function step(by: 1 | -1) {
    if (!copy || copy.words.length === 0) return;
    const count = copy.words.length;
    select(((((selected ?? (by === 1 ? -1 : 0)) + by) % count) + count) % count);
  }

  /** The next uncertain word after the one being looked at, wrapping round. */
  function nextUnsure() {
    if (unsure.length === 0) return;
    select(unsure.find((index) => index > (selected ?? -1)) ?? unsure[0]!);
  }

  function apply() {
    if (!copy || selected === null) return;
    setCopy(editWord(copy, selected, draft));
  }

  async function keep(kind: Kind) {
    if (!copy || !read) return;
    setBusy(kind);
    try {
      if (kind === 'pdf' || kind === 'searchable') {
        const replaced = await keepPdf(copy, kind === 'pdf' ? 'copy' : 'searchable', read.picture);
        toast.show(t('copy.kept'), 'success');
        if (replaced > 0) toast.show(t('copy.replaced', { count: replaced }), 'info');
      } else if (kind === 'svg') {
        keepSvg(copy, {
          ink: INK,
          paper: PAPER,
          font:
            getComputedStyle(document.documentElement)
              .getPropertyValue('--tp-type-body-font')
              .trim() || 'sans-serif',
        });
        toast.show(t('copy.kept'), 'success');
      } else if (kind === 'text') {
        keepText(copy);
        toast.show(t('copy.kept'), 'success');
      } else {
        const id = await startForm({ [locales.default]: t('forms.untitled') });
        const photo = new File([read.picture], 'photo.jpg', { type: 'image/jpeg' });
        navigate(...copyToForm(id, { photo, recognised: withFixes(read.recognised, copy) }));
      }
    } catch {
      toast.show(t(kind === 'form' ? 'copy.error.formFailed' : 'copy.error.failed'), 'error');
    } finally {
      setBusy(null);
    }
  }

  const word = copy && selected !== null ? copy.words[selected] : undefined;
  const nameOf = (index: number) => {
    const w = copy!.words[index]!;
    return isUncertain(w) ? `${w.text}, ${t('copy.unsure', { percent: w.confidence })}` : w.text;
  };

  return (
    <section className="stack copy" aria-label={t('copy.heading')} data-testid="digital-copy">
      <header className="stack stack--tight">
        <h2>{t('copy.heading')}</h2>
        <p className="muted small">{t('copy.intro')}</p>
      </header>

      <div className="copy__bar">
        <label className="copy__language">
          {t('copy.language')}
          <select
            value={language}
            data-testid="copy-language"
            onChange={(event) => setLanguage(event.target.value)}
          >
            {LOCALE_CODES.map((code) => (
              <option key={code} value={code}>
                {localeLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button button--quiet" onClick={onClose}>
          <Icon name="close" /> {t('copy.close')}
        </button>
      </div>

      <p className="small" aria-live="polite" data-testid="copy-status">
        {phase === 'reading' ? t('copy.reading') : null}
        {phase === 'failed' ? t('copy.readFailed') : null}
        {phase === 'ready' && copy
          ? copy.words.length === 0
            ? t('copy.noWords')
            : t('copy.summary', {
                words: copy.words.length,
                lines: copy.lines.length,
                unsure: unsure.length,
              })
          : null}
      </p>

      {copy && photoUrl ? (
        <>
          <div
            className="copy__panes"
            data-testid="copy-panes"
            data-words={copy.words.length}
            data-lines={copy.lines.length}
            data-unsure={unsure.length}
          >
            <figure className="copy__figure">
              <figcaption className="small muted">{t('copy.photo')}</figcaption>
              <img className="copy__photo" src={photoUrl} alt={t('copy.photoAlt')} />
            </figure>
            <figure className="copy__figure">
              <figcaption className="small muted">{t('copy.sheet')}</figcaption>
              <Sheet
                copy={copy}
                label={t('copy.sheetLabel')}
                selected={selected}
                nameOf={nameOf}
                onSelect={select}
              />
            </figure>
          </div>
          <p className="small muted">{t('copy.legend')}</p>

          <form
            className="copy__edit"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            {word ? (
              <p className="small" aria-live="polite" data-testid="copy-word-info">
                {t('copy.word', { n: selected! + 1, total: copy.words.length })} ·{' '}
                {word.edited
                  ? t('copy.edited')
                  : t('copy.confidence', { percent: word.confidence })}
              </p>
            ) : null}
            <label className="copy__field">
              {t('copy.wordField')}
              <input
                ref={field}
                type="text"
                dir="auto"
                value={draft}
                disabled={!word}
                data-testid="copy-word-input"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') select(null);
                }}
              />
            </label>
            <button
              type="submit"
              className="button"
              disabled={!word || draft.trim() === '' || draft.trim() === word.text}
              data-testid="copy-word-apply"
            >
              <Icon name="check" /> {t('copy.apply')}
            </button>
            <button type="button" className="button button--quiet" onClick={() => step(-1)}>
              <Icon name="arrow-left" /> {t('copy.previous')}
            </button>
            <button type="button" className="button button--quiet" onClick={() => step(1)}>
              <Icon name="arrow-right" /> {t('copy.next')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={unsure.length === 0}
              data-testid="copy-next-unsure"
              onClick={nextUnsure}
            >
              <Icon name="warning" /> {t('copy.nextUnsure')}
            </button>
            {unsure.length === 0 ? (
              <span className="small muted">{t('copy.noneUnsure')}</span>
            ) : null}
          </form>

          <fieldset className="copy__keep">
            <legend>{t('copy.keep')}</legend>
            <KeepButton
              kind="pdf"
              icon="download"
              busy={busy}
              onKeep={keep}
              label={t('copy.pdf')}
            />
            <KeepButton
              kind="searchable"
              icon="download"
              busy={busy}
              onKeep={keep}
              label={t('copy.searchable')}
              hint={t('copy.searchableHint')}
            />
            <KeepButton kind="svg" icon="image" busy={busy} onKeep={keep} label={t('copy.svg')} />
            <KeepButton
              kind="text"
              icon="long_text"
              busy={busy}
              onKeep={keep}
              label={t('copy.text')}
            />
            <KeepButton kind="form" icon="forms" busy={busy} onKeep={keep} label={t('copy.form')} />
          </fieldset>
          <p className="small muted">{t('copy.privacy')}</p>
        </>
      ) : null}
    </section>
  );
}

function KeepButton({
  kind,
  icon,
  busy,
  label,
  hint,
  onKeep,
}: {
  kind: Kind;
  icon: 'download' | 'image' | 'long_text' | 'forms';
  busy: Kind | null;
  label: string;
  hint?: string;
  onKeep: (kind: Kind) => void;
}) {
  const t = useT();
  return (
    <span className="copy__option">
      <button
        type="button"
        className="button"
        disabled={busy !== null}
        data-testid={`copy-keep-${kind}`}
        aria-describedby={hint ? `copy-hint-${kind}` : undefined}
        onClick={() => onKeep(kind)}
      >
        <Icon name={icon} /> {busy === kind ? t('copy.working') : label}
      </button>
      {hint ? (
        <span id={`copy-hint-${kind}`} className="small muted">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
