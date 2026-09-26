/**
 * `pnpm builder:validate` — the guided builder's graph against every rule, with the catalogues,
 * and the ladder's built-in aliases against the graph.
 *
 * The same checks `apps/forms/src/lib/guided-graph.test.ts` and
 * `packages/shared/src/interpret/data.test.ts` run inside `pnpm verify`, as a command that lists
 * every problem at once, by rule and node, for whoever is editing the graph, its translations or
 * its aliases. `docs/plan/BUILDER-GRAPH.md`, "Validation", says what each graph rule means;
 * `docs/plan/INTENT-LADDER.md`, "Aliases", what each alias rule means.
 */
import { BUILDER_GRAPH, validateGraph } from '@tp/shared/builder';
import { BUILTIN_ALIASES, aliasProblems } from '@tp/shared/interpret';
import { ALL_CATALOGUES } from '../apps/forms/src/lib/messages/all.js';

const problems = validateGraph(BUILDER_GRAPH, ALL_CATALOGUES);
const aliases = aliasProblems(BUILDER_GRAPH);
const nodes = BUILDER_GRAPH.nodes.length;
const locales = Object.keys(ALL_CATALOGUES).length;

for (const problem of problems) {
  console.error(`${problem.rule}${problem.nodeId ? ` ${problem.nodeId}` : ''}: ${problem.message}`);
}
for (const problem of aliases) {
  const at = [problem.nodeId, problem.optionId].filter(Boolean).join('/');
  const phrase = problem.phrase === undefined ? '' : ` "${problem.phrase}"`;
  console.error(
    `aliases/${problem.language}.json ${problem.rule}${at ? ` ${at}` : ''}${phrase}: ${problem.message}`,
  );
}

if (problems.length + aliases.length === 0) {
  console.log(
    `builder:validate passed — ${nodes} nodes, ${locales} catalogues, rules G0–G13; ` +
      `${BUILTIN_ALIASES.length} aliases in 12 languages`,
  );
} else {
  console.error(`builder:validate failed — ${problems.length + aliases.length} problem(s)`);
  process.exitCode = 1;
}
