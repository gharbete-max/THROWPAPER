import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';

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
}: {
  icon: IconName;
  title: string;
  /** Optional second line, for when the title alone would leave somebody guessing. */
  hint?: string;
  /** Omitted where there is nothing to offer — a trash bin has no "create" to suggest. */
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {/*
        Decorative. The sentence beneath already says what this is, and a screen reader announcing
        "image" before reading it would only be in the way.
      */}
      <span className="empty__mark" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint small muted">{hint}</p>}
      {action}
    </div>
  );
}
