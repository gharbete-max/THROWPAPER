import { FORM_TEMPLATES } from '../../forms/templates.js';
import { regulatedWordsIn } from '../../forms/wording.js';
import { GuardError, parseGuard, type GuardExpr } from './guards.js';
import { opProblem, type ParsedPath } from './paths.js';
import {
  BuilderGraphSchema,
  KIND_KEYS,
  optionsOf,
  patchesOf,
  type BuilderGraph,
  type MessageKey,
  type Node,
} from './schema.js';
import voice from './voice.json';

/**
 * `pnpm builder:validate` — the rules the conversation graph must satisfy before it ships.
 *
 * Each rule has an id, a broken-graph test in `validate.test.ts`, and a line in
 * `docs/plan/BUILDER-GRAPH.md` ("Validation"). The rules split in two:
 *
 * - **Structural** (G0–G3, G5–G9, G11, G12) need only the graph, and run here and in
 *   `graph.test.ts`.
 * - **Catalogue** (G4, G10, G13) need the twelve message catalogues, which live in `apps/forms`
 *   and which `packages/shared` must not import. So they take the catalogues as an argument, and
 *   the app's test and the root script pass them in. `validateGraph` without catalogues is not a
 *   full validation, and its callers say so.
 *
 * A problem is data, never an exception: the script lists every one, not the first.
 */

export type GraphRule =
  | 'G0'
  | 'G1'
  | 'G2'
  | 'G3'
  | 'G4'
  | 'G5'
  | 'G6'
  | 'G7'
  | 'G8'
  | 'G9'
  | 'G10'
  | 'G11'
  | 'G12'
  | 'G13';

export interface GraphProblem {
  readonly rule: GraphRule;
  readonly nodeId?: string;
  readonly message: string;
}

/** Locale code → message key → text. Every shipped locale, as `apps/forms` has them. */
export type Catalogues = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The longest chain inside one group before a preview or the end (G11; ADR 0006's promise). */
export const MAX_CHAIN = 6;

const SIBLINGS = /^menu\.siblings\(([a-zA-Z0-9]+)\)$/;

function targetsOf(next: unknown): string[] {
  if (typeof next === 'string') return [next];
  if (Array.isArray(next)) return next.map((branch: { to: string }) => branch.to);
  return [];
}

/** Every `next` edge of a node, with whether taking it depends on an answer or a guard (G6). */
function edgesOf(node: Node): { to: string; conditional: boolean }[] {
  const edges: { to: string; conditional: boolean }[] = [];
  if ('next' in node) {
    if (typeof node.next === 'string') edges.push({ to: node.next, conditional: false });
    else for (const b of node.next) edges.push({ to: b.to, conditional: b.when.trim() !== 'true' });
  }
  for (const option of optionsOf(node)) {
    for (const to of targetsOf(option.next)) edges.push({ to, conditional: true });
  }
  return edges;
}

/** Every message key a node uses, including those its kind renders by itself. */
export function messageKeysOf(node: Node): MessageKey[] {
  const keys: MessageKey[] = [node.ask, node.help, ...KIND_KEYS[node.kind]];
  if (typeof node.skip === 'string') keys.push(node.skip);
  else if (node.skip) keys.push(...node.skip.map((reason) => reason.skip));
  for (const option of optionsOf(node)) {
    keys.push(option.label);
    if (option.detail) keys.push(option.detail);
  }
  if (node.kind === 'text-entry') keys.push(...node.examples);
  return keys;
}

/** Every guarded list a node has: its `next` lists and its `skip` list. */
function guardedListsOf(node: Node): (readonly { readonly when: string }[])[] {
  const lists: (readonly { readonly when: string }[])[] = [];
  const nexts = ['next' in node ? node.next : undefined, ...optionsOf(node).map((o) => o.next)];
  for (const candidate of [...nexts, node.skip]) {
    if (Array.isArray(candidate)) lists.push(candidate);
  }
  return lists;
}

function guardsOf(node: Node): string[] {
  const guards: string[] = node.when ? [node.when] : [];
  for (const list of guardedListsOf(node)) guards.push(...list.map((branch) => branch.when));
  return guards;
}

function pathsRead(expr: GuardExpr): ParsedPath[] {
  switch (expr.t) {
    case 'path':
      return [expr.path];
    case 'call':
      return expr.path ? [expr.path] : [];
    case 'not':
      return pathsRead(expr.e);
    case 'and':
    case 'or':
    case 'cmp':
      return [...pathsRead(expr.l), ...pathsRead(expr.r)];
    default:
      return [];
  }
}

/** Structural equality of plain data, where a key holding `undefined` still counts as a key. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

/** G0–G3, G5–G9, G11, G12. Needs nothing but the graph. */
export function structuralProblems(input: unknown): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const add = (rule: GraphRule, message: string, nodeId?: string) =>
    problems.push({ rule, message, ...(nodeId ? { nodeId } : {}) });

  // G12 first: a function or an `undefined` can pass a schema and still not survive JSON.
  let roundTrip: unknown;
  try {
    roundTrip = JSON.parse(JSON.stringify(input));
  } catch {
    roundTrip = undefined;
  }
  if (!sameData(input, roundTrip)) add('G12', 'the graph does not survive a JSON round trip');

  const parsed = BuilderGraphSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 10)) {
      add('G0', `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return problems;
  }
  const graph = input as BuilderGraph;
  const byId = new Map<string, Node>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) add('G1', `the id ${node.id} is used twice`, node.id);
    byId.set(node.id, node);
  }
  const groups = new Set(graph.nodes.map((node) => node.group));
  const exists = (id: string) => byId.has(id);

  // G1 — every reference resolves.
  if (!exists(graph.start)) add('G1', `start names ${graph.start}, which does not exist`);
  for (const node of graph.nodes) {
    const refs = [
      ...edgesOf(node).map((edge) => edge.to),
      ...(node.kind === 'menu' ? node.entries : []),
    ];
    for (const ref of refs)
      if (!exists(ref)) add('G1', `names ${ref}, which does not exist`, node.id);
    if ('escape' in node) {
      const siblings = SIBLINGS.exec(node.escape);
      if (siblings ? !groups.has(siblings[1]!) : !exists(node.escape)) {
        add('G1', `escapes to ${node.escape}, which does not exist`, node.id);
      }
    }
    const optionIds = optionsOf(node).map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) add('G1', 'two options share an id', node.id);
    if (node.negative && !optionIds.includes(node.negative)) {
      add('G1', `its negative option ${node.negative} does not exist`, node.id);
    }
  }

  // G2 — every node is reachable from the start.
  const reached = new Set<string>();
  const queue = exists(graph.start) ? [graph.start] : [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reached.has(id)) continue;
    reached.add(id);
    const node = byId.get(id)!;
    const onward = [
      ...edgesOf(node).map((edge) => edge.to),
      ...(node.kind === 'menu' ? node.entries : []),
    ];
    if ('escape' in node) {
      const siblings = SIBLINGS.exec(node.escape);
      if (siblings)
        onward.push(...graph.nodes.filter((n) => n.group === siblings[1]).map((n) => n.id));
      else onward.push(node.escape);
    }
    for (const to of onward) if (exists(to) && !reached.has(to)) queue.push(to);
  }
  for (const node of graph.nodes) {
    if (!reached.has(node.id)) add('G2', 'cannot be reached from the start', node.id);
  }

  // G3 — every node but the end has a way out, and it leads to a menu.
  for (const node of graph.nodes) {
    if (node.kind === 'end') continue;
    const siblings = SIBLINGS.exec(node.escape);
    const ok = siblings ? groups.has(siblings[1]!) : byId.get(node.escape)?.kind === 'menu';
    if (!ok) add('G3', `its escape ${node.escape} is not a menu`, node.id);
  }

  // G5 — every patch writes a path the schema has, with a value it accepts.
  const pendingWritten = new Set<string>();
  for (const node of graph.nodes) {
    for (const patch of patchesOf(node)) {
      for (const op of patch) {
        const problem = opProblem(op);
        if (problem) add('G5', problem, node.id);
        if (op.path.startsWith('pending.')) pendingWritten.add(op.path);
      }
    }
  }

  // G7 — option counts, and quantities that make sense.
  for (const node of graph.nodes) {
    const count = optionsOf(node).length;
    if (node.kind === 'question' && (count < 2 || count > 4)) {
      add('G7', `a question offers 2–4 answers, this one ${count}`, node.id);
    }
    if ((node.kind === 'pick-one' || node.kind === 'pick-many') && (count < 2 || count > 8)) {
      add('G7', `a chooser offers 2–8 answers, this one ${count}`, node.id);
    }
    if (node.kind === 'quantity' && !(node.min <= node.default && node.default <= node.max)) {
      add(
        'G7',
        `min ${node.min} ≤ default ${node.default} ≤ max ${node.max} does not hold`,
        node.id,
      );
    }
  }

  // G8 — every guard parses, within bounds, reads only what something provides, and says why.
  const provided = new Set([...graph.inputs, ...pendingWritten]);
  for (const node of graph.nodes) {
    if (node.when && !node.skip) add('G8', 'has a `when` but no `skip` reason', node.id);
    for (const list of guardedListsOf(node)) {
      // Read top to bottom, the first that holds wins; a list whose last is not `true` can have
      // none hold, and the conversation would have nowhere to go, or nothing to say.
      if (list[list.length - 1]?.when.trim() !== 'true') {
        add('G8', "a guarded list does not end with `when: 'true'`", node.id);
      }
    }
    for (const guard of guardsOf(node)) {
      let tree: GuardExpr;
      try {
        tree = parseGuard(guard);
      } catch (error) {
        const where = error instanceof GuardError ? ` at ${error.at}` : '';
        add('G8', `"${guard}": ${(error as Error).message}${where}`, node.id);
        continue;
      }
      for (const path of pathsRead(tree)) {
        if (path.root !== 'pending' && path.root !== 'guess') continue;
        const name = `${path.root}.${path.steps[0]?.kind === 'key' ? path.steps[0].key : ''}`;
        if (!provided.has(name)) {
          add('G8', `"${guard}" reads ${name}, which nothing writes or provides`, node.id);
        }
      }
    }
  }

  // G9 — scores name real templates, in whole millinats.
  const templates = new Set(FORM_TEMPLATES.map((template) => template.id));
  for (const node of graph.nodes) {
    for (const option of optionsOf(node)) {
      for (const [template, value] of Object.entries(option.score ?? {})) {
        if (!templates.has(template))
          add('G9', `scores ${template}, which is not a template`, node.id);
        if (!Number.isInteger(value))
          add('G9', `scores ${template} with ${value}, not an integer`, node.id);
      }
    }
  }

  // G6 — no cycle turns by itself, and every cycle has a way out.
  const edges = new Map(
    graph.nodes.map((node) => [node.id, edgesOf(node).filter((e) => exists(e.to))]),
  );
  for (const component of stronglyConnected(
    graph.nodes.map((n) => n.id),
    edges,
  )) {
    const inside = new Set(component);
    const cyclic =
      component.length > 1 || (edges.get(component[0]!) ?? []).some((e) => e.to === component[0]);
    if (!cyclic) continue;
    const internal = component.flatMap((id) =>
      (edges.get(id) ?? []).filter((e) => inside.has(e.to)),
    );
    const exits = component.flatMap((id) => (edges.get(id) ?? []).filter((e) => !inside.has(e.to)));
    const label = [...component].sort().join(', ');
    if (!internal.some((edge) => edge.conditional)) {
      add('G6', `the cycle ${label} turns without anybody answering anything`);
    }
    if (exits.length === 0) add('G6', `the cycle ${label} has no way out`);
  }

  // G11 — no group asks more than MAX_CHAIN questions in a row before showing something.
  for (const node of graph.nodes) {
    const longest = longestChain(node, byId, edges);
    if (longest > MAX_CHAIN) {
      add('G11', `a chain of ${longest} nodes before a preview (at most ${MAX_CHAIN})`, node.id);
    }
  }

  return problems;
}

/** Tarjan's algorithm, iteration order fixed by the node order, so the output is deterministic. */
function stronglyConnected(
  ids: readonly string[],
  edges: ReadonlyMap<string, readonly { to: string }[]>,
): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const { to } of edges.get(v) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(v, Math.min(low.get(v)!, low.get(to)!));
      } else if (onStack.has(to)) low.set(v, Math.min(low.get(v)!, index.get(to)!));
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      out.push(component);
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return out;
}

/** Nodes in the longest simple path from `start` within its group, stopping at a preview or end. */
function longestChain(
  start: Node,
  byId: ReadonlyMap<string, Node>,
  edges: ReadonlyMap<string, readonly { to: string }[]>,
): number {
  const walk = (node: Node, seen: ReadonlySet<string>): number => {
    if (node.kind === 'preview-moment' || node.kind === 'end') return 1;
    let best = 0;
    for (const { to } of edges.get(node.id) ?? []) {
      const next = byId.get(to);
      if (!next || next.group !== start.group || seen.has(to)) continue;
      best = Math.max(best, walk(next, new Set([...seen, to])));
    }
    return 1 + best;
  };
  return walk(start, new Set([start.id]));
}

const language = (locale: string) => locale.split('-')[0]!;
const WITHOUT_SPACES = new Set(Object.keys(voice.maxCharacters));
const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function containsPhrase(text: string, phrase: string, lang: string): boolean {
  if (WITHOUT_SPACES.has(lang)) return text.includes(phrase);
  const hay = tokens(text);
  const needle = tokens(phrase);
  return hay.some((_, i) => needle.every((word, j) => hay[i + j] === word));
}

/** G4, G10, G13. Needs the catalogues, which only `apps/forms` has. */
export function catalogueProblems(graph: BuilderGraph, catalogues: Catalogues): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const add = (rule: GraphRule, message: string, nodeId: string) =>
    problems.push({ rule, message, nodeId });
  const banned = voice.banned as Record<string, string[]>;
  const maxWords = voice.maxWords as Record<string, number>;
  const maxCharacters = voice.maxCharacters as Record<string, number>;

  for (const node of graph.nodes) {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const lang = language(locale);
      // G4 — every key, in every locale, and not empty.
      for (const key of messageKeysOf(node)) {
        if (!catalogue[key]?.trim()) add('G4', `${key} is missing or empty in ${locale}`, node.id);
      }
      // G10 — the question is short, and nothing the node says uses a banned word.
      const ask = (catalogue[node.ask] ?? '').replace(/\{[^}]*\}/g, '').trim();
      if (WITHOUT_SPACES.has(lang)) {
        const limit = maxCharacters[lang]!;
        if ([...ask].length > limit)
          add('G10', `${locale} question is over ${limit} characters`, node.id);
      } else {
        const limit = maxWords[lang] ?? 12;
        const words = ask.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
        if (words > limit)
          add('G10', `${locale} question has ${words} words (at most ${limit})`, node.id);
      }
      const spoken = messageKeysOf(node)
        .filter((key) => node.kind !== 'text-entry' || !node.examples.includes(key))
        .map((key) => catalogue[key] ?? '');
      for (const word of banned[lang] ?? []) {
        if (spoken.some((text) => containsPhrase(text, word, lang))) {
          add('G10', `${locale} uses the banned word "${word}"`, node.id);
        }
      }
      // G13 — an example chip is a label, never operative wording (ADR 0012).
      if (node.kind === 'text-entry') {
        for (const key of node.examples) {
          const found = regulatedWordsIn(catalogue[key] ?? '');
          if (found.length > 0)
            add('G13', `${locale} ${key} mentions ${found.join(', ')}`, node.id);
        }
      }
    }
  }
  return problems;
}

/** Every rule. Catalogue rules run only once the graph's shape is sound. */
export function validateGraph(graph: unknown, catalogues: Catalogues): GraphProblem[] {
  const structural = structuralProblems(graph);
  if (structural.some((problem) => problem.rule === 'G0')) return structural;
  return [...structural, ...catalogueProblems(graph as BuilderGraph, catalogues)];
}
