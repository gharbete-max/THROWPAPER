import { useEffect, useRef } from 'react';
import type { BuilderGraph, Conversation } from '@tp/shared/builder';
import { useT } from '../../../lib/i18n.js';
import { crumbs, type Said } from './conversation.js';

/**
 * The trail — one line of what has been answered, small and muted, each answer a way back to its
 * question (`DESIGN-LANGUAGE.md`, "One decision per screen"). A question passed over is greyed as
 * its reason, and is not a link: there is nothing there to go back to.
 *
 * One line on every width: it scrolls sideways and keeps its newest end in view, rather than
 * wrapping into a second line that pushes the answers down on a phone.
 */
export function Trail({
  graph,
  conversation,
  onBackTo,
}: {
  graph: BuilderGraph;
  conversation: Conversation;
  onBackTo: (step: number) => void;
}) {
  const t = useT();
  const list = useRef<HTMLOListElement>(null);
  const all = crumbs(graph, conversation);

  useEffect(() => {
    const element = list.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [all.length]);

  if (all.length === 0) return null;

  const words = (said: readonly Said[]) =>
    said.map((one) => ('key' in one ? t(one.key) : one.text)).join(', ');

  return (
    <nav className="conversation__trail" aria-label={t('conversation.trail')}>
      <ol ref={list}>
        {all.map((crumb) => [
          <li key={crumb.step}>
            <button
              type="button"
              className="conversation__crumb"
              title={t(crumb.question)}
              onClick={() => onBackTo(crumb.step)}
            >
              <span className="visually-hidden">{t(crumb.question)} </span>
              {words(crumb.said)}
            </button>
          </li>,
          ...crumb.skipped.map((skipped) => (
            // The reason alone: it says what was passed over ("Nothing to guess yet").
            <li key={`${crumb.step}:${skipped.question}`} className="conversation__skipped">
              {t(skipped.reason)}
            </li>
          )),
        ])}
      </ol>
    </nav>
  );
}
