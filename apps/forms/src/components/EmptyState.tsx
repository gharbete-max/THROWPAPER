import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';
import { useT } from '../lib/i18n.js';

/**
 * The restrained photographs an empty state may carry (`docs/brand/MEDIA.md`). Each is a CC0 photo
 * of an object, made grey so gold stays the one hue on the page, committed in `public/media/` and
 * served from the app's own origin. Never in the room: the room is the owner's dark grey.
 */
export type EmptyMedia = 'scan' | 'send' | 'sign' | 'forms';

const MEDIA_FILE: Record<EmptyMedia, string> = {
  scan: 'scan-pages',
  send: 'send-plane',
  sign: 'sign-pen',
  forms: 'forms-typewriter',
};

/** The files are cropped to this, so the box is reserved before the picture arrives. */
const MEDIA_SIZE = { width: 1120, height: 400 } as const;

/**
 * Nothing here yet, said in a way that offers the way out.
 *
 * The old empty state was a dashed box with a line of grey text in the middle of it. Two things
 * were wrong with that. A dashed rectangle is what a *drop zone* looks like, so the one place in
 * the product with nothing in it invited people to drag something onto it; and the sentence was
 * grey, which is the colour this app uses for text you are meant to skim past — on a screen where
 * it is the only thing to read.
 *
 * The pattern here is the ordinary one: a quiet mark, a sentence at full contrast, and the action
 * that fixes it within reach. The action is the point — an empty list is not an error, it is a
 * place somebody has arrived before doing the thing, and the screen should offer to start it.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  media,
  level = 'h2',
}: {
  icon: IconName;
  title: string;
  /** Optional second line, for when the title alone would leave somebody guessing. */
  hint?: string;
  /** Omitted where there is nothing to offer — a trash bin has no "create" to suggest. */
  action?: ReactNode;
  /** A photograph above the mark, where this is the first thing somebody sees of a task. */
  media?: EmptyMedia;
  /**
   * A heading, not a paragraph: somebody navigating by heading has to be able to land on "no
   * events yet". `h2` under a screen's own `h1`; `h1` where the empty state *is* the page.
   */
  level?: 'h1' | 'h2';
}) {
  const Title = level;
  const t = useT();
  return (
    <div className={media ? 'empty empty--media' : 'empty'}>
      {media && (
        <img
          className="empty__media"
          src={`/media/${MEDIA_FILE[media]}.webp`}
          width={MEDIA_SIZE.width}
          height={MEDIA_SIZE.height}
          alt={t(`media.alt.${media}`)}
          loading="lazy"
          decoding="async"
        />
      )}
      {/*
        Decorative. The sentence beneath already says what this is, and a screen reader announcing
        "image" before reading it would only be in the way.
      */}
      <span className="empty__mark" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <Title className="empty__title">{title}</Title>
      {hint && <p className="empty__hint small muted">{hint}</p>}
      {action}
    </div>
  );
}
