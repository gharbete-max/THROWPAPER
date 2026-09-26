import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { BUILDER_GRAPH, messageKeysOf, optionsOf, validateGraph } from '@tp/shared/builder';
import { ALL_CATALOGUES } from './messages/all.js';

/**
 * The guided builder's graph against the real catalogues — the half of `pnpm builder:validate`
 * that `packages/shared` cannot run, because the words live here.
 *
 * `packages/shared/src/builder/graph/validate.test.ts` proves each rule catches its mistake with
 * a made-up catalogue. This proves the shipped graph and the shipped catalogues pass every rule
 * together: every key in all twelve languages, every question short enough, no banned word, no
 * operative wording in an example chip (`docs/plan/BUILDER-GRAPH.md`, rules G4, G10, G13).
 */
describe('the guided graph and the catalogues', () => {
  it('has a catalogue for every shipped locale', () => {
    expect(Object.keys(ALL_CATALOGUES).sort()).toEqual([...LOCALE_CODES].sort());
  });

  it('passes every rule, structural and catalogue', () => {
    expect(validateGraph(BUILDER_GRAPH, ALL_CATALOGUES)).toEqual([]);
  });

  /**
   * Both directions. A `guided.*` key no node uses is a sentence nobody will ever see — and a
   * sign that a node was renamed and its words left behind.
   */
  it('defines exactly the guided keys the graph uses', () => {
    const used = new Set(BUILDER_GRAPH.nodes.flatMap(messageKeysOf));
    const defined = new Set(
      Object.keys(ALL_CATALOGUES['en-GB']!).filter((key) => key.startsWith('guided.')),
    );
    expect([...defined].filter((key) => !used.has(key as never))).toEqual([]);
    expect([...used].filter((key) => !defined.has(key))).toEqual([]);
  });

  /** An icon the graph names but `Icon.tsx` cannot draw would render as nothing, silently. */
  it('names only icons Icon.tsx has', () => {
    const source = readFileSync(new URL('../components/Icon.tsx', import.meta.url), 'utf8');
    const declared = source.slice(source.indexOf('export type IconName'));
    const icons = BUILDER_GRAPH.nodes.flatMap((node) =>
      optionsOf(node).flatMap((option) => ('icon' in option && option.icon ? [option.icon] : [])),
    );
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.filter((icon) => !declared.includes(`'${icon}'`))).toEqual([]);
  });
});
