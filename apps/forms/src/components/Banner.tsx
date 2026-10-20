import { MEDIA, type MediaName } from '../lib/media.js';
import { useT } from '../lib/i18n.js';

/**
 * A photograph across the top of a screen or card (`docs/brand/MEDIA.md`). Lazy, async, with its
 * size so nothing shifts; nothing is ever written over it, so there is no contrast to keep. The
 * one with a dark twin is drawn twice and the stylesheet shows the one for the theme (a hidden
 * lazy image is not fetched). `decorative` is for a second use of a picture already described on
 * the page.
 */
export function Banner({
  name,
  decorative = false,
  className = '',
}: {
  name: MediaName;
  decorative?: boolean;
  className?: string;
}) {
  const t = useT();
  const entry: { file: string; dark?: string; width: number; height: number } = MEDIA[name];
  const draw = (file: string, theme: string) => (
    <img
      className={`banner banner--${theme} ${className}`.trim()}
      src={`/media/${file}.webp`}
      width={entry.width}
      height={entry.height}
      alt={decorative ? '' : t(`media.alt.${name}`)}
      loading="lazy"
      decoding="async"
    />
  );
  return entry.dark ? (
    <>
      {draw(entry.file, 'light')}
      {draw(entry.dark, 'dark')}
    </>
  ) : (
    draw(entry.file, 'one')
  );
}
