/**
 * `pnpm builder:validate` — the guided builder's graph against every rule, with the catalogues.
 *
 * The same check `apps/forms/src/lib/guided-graph.test.ts` runs inside `pnpm verify`, as a
 * command that lists every problem at once, by rule and node, for whoever is editing the graph or
 * its translations. `docs/plan/BUILDER-GRAPH.md`, "Validation", says what each rule means.
 */
import { BUILDER_GRAPH, validateGraph } from '@tp/shared/builder';
import { ALL_CATALOGUES } from '../apps/forms/src/lib/messages/all.js';

const problems = validateGraph(BUILDER_GRAPH, ALL_CATALOGUES);
const nodes = BUILDER_GRAPH.nodes.length;
const locales = Object.keys(ALL_CATALOGUES).length;

if (problems.length === 0) {
  console.log(`builder:validate passed — ${nodes} nodes, ${locales} catalogues, rules G0–G13`);
} else {
  for (const problem of problems) {
    console.error(
      `${problem.rule}${problem.nodeId ? ` ${problem.nodeId}` : ''}: ${problem.message}`,
    );
  }
  console.error(`builder:validate failed — ${problems.length} problem(s)`);
  process.exitCode = 1;
}
