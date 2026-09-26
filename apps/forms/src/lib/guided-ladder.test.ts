import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { BUILDER_GRAPH, optionsOf } from '@tp/shared/builder';
import { interpret } from '@tp/shared/interpret';
import { ALL_CATALOGUES } from './messages/all.js';

/**
 * The ladder against the real catalogues — the half `packages/shared` cannot check, because the
 * words on the cards live here. Typing exactly what a card says must choose that card, at T0, in
 * every language: the built-in aliases (`packages/shared/src/interpret/aliases/`) carry each
 * card's label, and this is what keeps them in step when a translation changes.
 */
describe('a card’s own words, typed', () => {
  const cases = LOCALE_CODES.flatMap((locale) =>
    BUILDER_GRAPH.nodes.flatMap((node) =>
      optionsOf(node).map((option) => {
        const catalogue = ALL_CATALOGUES[locale as keyof typeof ALL_CATALOGUES] as Record<
          string,
          string
        >;
        return [locale, node.id, option.id, catalogue[option.label]!] as const;
      }),
    ),
  );

  it('covers every option in every language', () => {
    const options = BUILDER_GRAPH.nodes.flatMap(optionsOf).length;
    expect(cases).toHaveLength(options * LOCALE_CODES.length);
  });

  it.each(cases)('%s %s → %s: %j', (locale, nodeId, optionId, label) => {
    const result = interpret(label, { graph: BUILDER_GRAPH, nodeId, locale });
    expect(result).toMatchObject({ outcome: 'apply', reading: { optionId, tier: 'T0' } });
  });
});
