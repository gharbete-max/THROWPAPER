import { parsePath, resolvePath, type ParsedPath } from './paths.js';

/**
 * `when` guards: a tiny, total expression language, parsed by hand.
 *
 * A guard decides whether a node is asked. It must be impossible for one to loop, to throw at run
 * time, or to reach outside the state it is given, so there is no `eval`, no `Function`, and no
 * arithmetic: a guard is parsed once into a tree and the tree is interpreted. The grammar
 * (`docs/plan/BUILDER-GRAPH.md`, "The when language"):
 *
 *     expr = or
 *     or   = and ( '||' and )*
 *     and  = not ( '&&' not )*
 *     not  = '!' not | cmp
 *     cmp  = atom ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) atom )?
 *     atom = literal | path ( '.length' )? | call | '(' expr ')'
 *     call = answered(nodeId) | decided(slot) | count(path) | has(path)
 *
 * **Total.** A path that does not resolve is `null`. A bare path in a boolean position is true
 * only when its value is exactly `true`. `<`, `<=`, `>` and `>=` are false unless both sides are
 * numbers. `==` and `!=` compare scalars by value; a list or an object is never equal to anything.
 * `.length` of anything but a list is 0.
 *
 * **Bounded.** At most 200 characters and 8 levels of nesting, checked when the guard is parsed —
 * which `builder:validate` does for every guard in the graph (rule G8), so a guard that would be
 * refused is refused before it ships, not while somebody is building a form.
 */

export const MAX_GUARD_LENGTH = 200;
export const MAX_GUARD_DEPTH = 8;

export type Scalar = number | string | boolean | null;
type Span = readonly [number, number];

export type GuardExpr =
  | { readonly t: 'lit'; readonly value: Scalar; readonly span: Span }
  | { readonly t: 'path'; readonly path: ParsedPath; readonly length: boolean; readonly span: Span }
  | {
      readonly t: 'call';
      readonly fn: 'answered' | 'decided' | 'count' | 'has';
      readonly arg: string;
      readonly path: ParsedPath | null;
      readonly span: Span;
    }
  | { readonly t: 'not'; readonly e: GuardExpr; readonly span: Span }
  | { readonly t: 'and' | 'or'; readonly l: GuardExpr; readonly r: GuardExpr; readonly span: Span }
  | {
      readonly t: 'cmp';
      readonly op: '==' | '!=' | '<' | '<=' | '>' | '>=';
      readonly l: GuardExpr;
      readonly r: GuardExpr;
      readonly span: Span;
    };

export class GuardError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

/**
 * The state a guard reads: the builder state's roots, plus which nodes have been answered.
 * Plain data — the machine (slice S2) builds it; tests build it by hand.
 */
export interface GuardState {
  readonly draft?: unknown;
  readonly sidecar?: unknown;
  readonly pending?: unknown;
  readonly focus?: string | null;
  readonly guess?: unknown;
  readonly answered?: readonly string[];
}

type Token =
  | { readonly k: 'op'; readonly v: string; readonly at: number }
  | { readonly k: 'num'; readonly v: number; readonly at: number; readonly end: number }
  | { readonly k: 'str'; readonly v: string; readonly at: number; readonly end: number }
  | { readonly k: 'word'; readonly v: string; readonly at: number; readonly end: number };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '!', '(', ')'];
const WORD = /^[a-zA-Z][a-zA-Z0-9_.-]*(\[[^\]]*\][a-zA-Z0-9_.-]*)*/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (/^\s/.test(rest)) {
      i += 1;
      continue;
    }
    const op = OPS.find((candidate) => rest.startsWith(candidate));
    if (op) {
      tokens.push({ k: 'op', v: op, at: i });
      i += op.length;
      continue;
    }
    const num = /^-?\d{1,9}/.exec(rest);
    if (num) {
      tokens.push({ k: 'num', v: Number(num[0]), at: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    if (rest.startsWith("'")) {
      const close = rest.indexOf("'", 1);
      if (close < 0) throw new GuardError('an unclosed string', i);
      tokens.push({ k: 'str', v: rest.slice(1, close), at: i, end: i + close + 1 });
      i += close + 1;
      continue;
    }
    const word = WORD.exec(rest);
    if (word) {
      tokens.push({ k: 'word', v: word[0], at: i, end: i + word[0].length });
      i += word[0].length;
      continue;
    }
    throw new GuardError(`an unexpected "${rest[0]}"`, i);
  }
  return tokens;
}

const CALLS = ['answered', 'decided', 'count', 'has'] as const;

/** Parses a guard into its tree, or throws a `GuardError` saying where and why. */
export function parseGuard(source: string): GuardExpr {
  if (source.length > MAX_GUARD_LENGTH) {
    throw new GuardError(`longer than ${MAX_GUARD_LENGTH} characters`, MAX_GUARD_LENGTH);
  }
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value: string) => {
    const token = peek();
    return token?.k === 'op' && token.v === value;
  };
  const expectOp = (value: string) => {
    const token = peek();
    if (token?.k !== 'op' || token.v !== value) {
      throw new GuardError(`"${value}" expected`, token?.at ?? source.length);
    }
    pos += 1;
    return token;
  };
  const endOf = (expr: GuardExpr) => expr.span[1];

  const or = (depth: number): GuardExpr => {
    let left = and(depth);
    while (isOp('||')) {
      pos += 1;
      const right = and(depth);
      left = { t: 'or', l: left, r: right, span: [left.span[0], endOf(right)] };
    }
    return left;
  };
  const and = (depth: number): GuardExpr => {
    let left = not(depth);
    while (isOp('&&')) {
      pos += 1;
      const right = not(depth);
      left = { t: 'and', l: left, r: right, span: [left.span[0], endOf(right)] };
    }
    return left;
  };
  const not = (depth: number): GuardExpr => {
    if (depth > MAX_GUARD_DEPTH) {
      throw new GuardError(`nested more than ${MAX_GUARD_DEPTH} deep`, peek()?.at ?? 0);
    }
    if (isOp('!')) {
      const at = expectOp('!').at;
      const inner = not(depth + 1);
      return { t: 'not', e: inner, span: [at, endOf(inner)] };
    }
    return cmp(depth);
  };
  const cmp = (depth: number): GuardExpr => {
    const left = atom(depth);
    const token = peek();
    if (token?.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(token.v)) {
      pos += 1;
      const right = atom(depth);
      return {
        t: 'cmp',
        op: token.v as '==' | '!=' | '<' | '<=' | '>' | '>=',
        l: left,
        r: right,
        span: [left.span[0], endOf(right)],
      };
    }
    return left;
  };
  const atom = (depth: number): GuardExpr => {
    const token = peek();
    if (!token) throw new GuardError('an expression expected', source.length);
    if (token.k === 'op' && token.v === '(') {
      pos += 1;
      if (depth + 1 > MAX_GUARD_DEPTH) {
        throw new GuardError(`nested more than ${MAX_GUARD_DEPTH} deep`, token.at);
      }
      const inner = or(depth + 1);
      const close = expectOp(')');
      return { ...inner, span: [token.at, close.at + 1] } as GuardExpr;
    }
    if (token.k === 'num' || token.k === 'str') {
      pos += 1;
      return { t: 'lit', value: token.v, span: [token.at, token.end] };
    }
    if (token.k !== 'word')
      throw new GuardError(`"${token.v}" where a value was expected`, token.at);
    pos += 1;
    if (token.v === 'true' || token.v === 'false' || token.v === 'null') {
      const value = token.v === 'null' ? null : token.v === 'true';
      return { t: 'lit', value, span: [token.at, token.end] };
    }
    if ((CALLS as readonly string[]).includes(token.v) && isOp('(')) {
      pos += 1;
      const arg = peek();
      if (arg?.k !== 'word') throw new GuardError(`${token.v}() needs one argument`, arg?.at ?? 0);
      pos += 1;
      const close = expectOp(')');
      const fn = token.v as (typeof CALLS)[number];
      const path = fn === 'count' || fn === 'has' ? parsePath(arg.v) : null;
      if ((fn === 'count' || fn === 'has') && !path) {
        throw new GuardError(`"${arg.v}" is not a path`, arg.at);
      }
      return { t: 'call', fn, arg: arg.v, path, span: [token.at, close.at + 1] };
    }
    const length = token.v.endsWith('.length');
    const path = parsePath(length ? token.v.slice(0, -'.length'.length) : token.v);
    if (!path) throw new GuardError(`"${token.v}" is not a path`, token.at);
    return { t: 'path', path, length, span: [token.at, token.end] };
  };

  const tree = or(0);
  const leftover = peek();
  if (leftover) throw new GuardError(`"${String(leftover.v)}" after the end`, leftover.at);
  return tree;
}

const isScalar = (value: unknown): value is Scalar =>
  value === null || ['number', 'string', 'boolean'].includes(typeof value);

function valueOf(expr: GuardExpr, state: GuardState): unknown {
  switch (expr.t) {
    case 'lit':
      return expr.value;
    case 'path': {
      const value = resolvePath(state, expr.path);
      if (expr.length) return Array.isArray(value) ? value.length : 0;
      return value === undefined ? null : value;
    }
    case 'call': {
      if (expr.fn === 'answered') return (state.answered ?? []).includes(expr.arg);
      if (expr.fn === 'decided') {
        const decided = resolvePath(state, {
          root: 'sidecar',
          steps: [
            { kind: 'key', key: 'fields' },
            { kind: 'key', key: String(state.focus ?? '') },
            { kind: 'key', key: 'decided' },
            { kind: 'key', key: expr.arg },
          ],
        });
        return decided === true;
      }
      const value = expr.path ? resolvePath(state, expr.path) : undefined;
      if (expr.fn === 'count') return Array.isArray(value) ? value.length : 0;
      return value !== undefined && value !== null;
    }
    default:
      return evaluateGuard(expr, state);
  }
}

/** Whether the guard holds in `state`. Total: never throws for a parsed guard. */
export function evaluateGuard(expr: GuardExpr, state: GuardState): boolean {
  switch (expr.t) {
    case 'and':
      return evaluateGuard(expr.l, state) && evaluateGuard(expr.r, state);
    case 'or':
      return evaluateGuard(expr.l, state) || evaluateGuard(expr.r, state);
    case 'not':
      return !evaluateGuard(expr.e, state);
    case 'cmp': {
      const l = valueOf(expr.l, state);
      const r = valueOf(expr.r, state);
      if (expr.op === '==' || expr.op === '!=') {
        const equal = isScalar(l) && isScalar(r) && l === r;
        return expr.op === '==' ? equal : !equal;
      }
      if (typeof l !== 'number' || typeof r !== 'number') return false;
      if (expr.op === '<') return l < r;
      if (expr.op === '<=') return l <= r;
      if (expr.op === '>') return l > r;
      return l >= r;
    }
    default:
      return valueOf(expr, state) === true;
  }
}

/**
 * Why a guard came out the way it did: the source text of the part that decided it.
 *
 * For `a && b` that is false, the first false side; for `a || b` that is true, the first true
 * side; otherwise the whole expression. It is for the trail's "why was this skipped?" and the debug
 * panel — the sentence a person reads is the node's own `skip` message.
 */
export function explainGuard(
  source: string,
  expr: GuardExpr,
  state: GuardState,
): { result: boolean; because: string } {
  const result = evaluateGuard(expr, state);
  const decisive = (node: GuardExpr): GuardExpr => {
    if (node.t === 'and' && !evaluateGuard(node, state)) {
      return decisive(evaluateGuard(node.l, state) ? node.r : node.l);
    }
    if (node.t === 'or' && evaluateGuard(node, state)) {
      return decisive(evaluateGuard(node.l, state) ? node.l : node.r);
    }
    return node;
  };
  const span = decisive(expr).span;
  return { result, because: source.slice(span[0], span[1]).trim() };
}
