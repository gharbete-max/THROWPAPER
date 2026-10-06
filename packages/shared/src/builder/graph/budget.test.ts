import { describe, expect, it } from 'vitest';
import { emptyDefinition } from '../../forms/definition.js';
import { vocabularyFor } from '../../interpret/vocabulary.js';
import { LANGUAGES } from '../../interpret/lexicon.js';
import { begin } from '../machine.js';
import { BUILDER_GRAPH } from './nodes.js';
import type { BuilderGraph } from './schema.js';

/**
 * `CAVEATS.md` #42, `perf-budget`: the graph loads in under 50 ms (`docs/plan/POLISH.md`, S13c).
 * Loading it is everything the screen waits on before the first question and the first thing
 * typed: the conversation begun over it, and the ladder's vocabulary in the author's language —
 * every card's label and alias, normalised. (Rules G0–G14 are checked when it is built, by
 * `pnpm builder:validate`, never as it loads.) Each run is on a fresh copy of the graph, as data,
 * so nothing is served from a cache the screen would not have; the median of five, after one to
 * warm the code. The clock is only in this test.
 */

const BUDGET_MS = 50;
const RUNS = 5;

function load(language: (typeof LANGUAGES)[number]): void {
  const graph = JSON.parse(JSON.stringify(BUILDER_GRAPH)) as BuilderGraph;
  vocabularyFor(graph, language);
  begin(graph, { definition: emptyDefinition, title: {}, pending: { brandKitExists: true } });
}

describe('loading the graph', () => {
  it.each(['sv', 'de', 'ja'] as const)(
    `takes under ${BUDGET_MS} ms, with the %s vocabulary`,
    (language) => {
      load(language);
      const times: number[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        const start = performance.now();
        load(language);
        times.push(performance.now() - start);
      }
      const median = times.sort((a, b) => a - b)[Math.floor(RUNS / 2)]!;
      expect(median, `${times.map((t) => t.toFixed(1)).join(', ')} ms`).toBeLessThan(BUDGET_MS);
    },
  );
});
