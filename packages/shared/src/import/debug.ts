import { sha256Hex } from './sha256.js';

/**
 * The debug artifact every import stage emits — `docs/plan/IMPORT-PIPELINE.md`, "Debug".
 *
 * It says, for each thing a stage decided, which rule decided it and on what evidence, so a wrong
 * import can be traced to one rule and one number. Snapshots of these are the fixtures' and the
 * corpus's second expectation; they are never stored on the server.
 */

export type StageName =
  'extract' | 'reassemble' | 'enumerate' | 'segment' | 'classify' | 'map' | 'score';

/** Integers and short strings only, so the artifact is canonical JSON. */
export type Evidence = Record<string, number | string | boolean>;

export interface Decision {
  /** `<stage>:<subject>`, e.g. `enumerate:p1-l3`; unique within the artifact. */
  id: string;
  /** The rule that decided, as its document names it: `R4`, `V1`, `G2-grid`, … */
  rule: string;
  /** Line, item or segment ids. */
  subject: string[];
  verdict: string;
  evidence: Evidence;
}

export interface StageDebug {
  stage: StageName;
  /** Bumped when the stage's behaviour changes on purpose. */
  stageVersion: number;
  irVersion: 1;
  /** Of the canonical JSON of the stage's input. */
  inputSha256: string;
  decisions: Decision[];
}

/** What every stage returns: its output and how it got there. */
export interface StageResult<T> {
  output: T;
  debug: StageDebug;
}

/** Code-point order, not UTF-16 code-unit order (they differ above U+FFFF). */
function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < x.length && i < y.length; i += 1) {
    const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, integers only. So two equal
 * values always serialise to the same bytes and "byte-identical" is a meaningful test. Anything
 * that is not plain JSON data — a fraction, `undefined`, a function, a `Map` — is a programming
 * error in a stage, and throws rather than serialising to something that only looks equal.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new TypeError(`canonicalJson: ${value} is not an integer`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      byCodePoint(a, b),
    );
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: ${typeof value} is not JSON data`);
}

/**
 * Digests already taken, by the object: every stage after the second reads the same layout
 * document, and hashing it anew at each stage cost more than all the stages' own work together.
 * The stages never change their inputs, so an object's digest does not go stale.
 */
const DIGESTS = new WeakMap<object, string>();

/** The hash a debug artifact names its input by. */
export function inputSha256(input: unknown): string {
  if (input === null || typeof input !== 'object') return sha256Hex(canonicalJson(input));
  const known = DIGESTS.get(input);
  if (known) return known;
  const digest = sha256Hex(canonicalJson(input));
  DIGESTS.set(input, digest);
  return digest;
}

/**
 * The hash of a stage that reads several inputs: each part is hashed by itself (the layout
 * document once per import, however many stages read it), then the parts' hashes by their names.
 * As exact an identity of the input as hashing it whole, at a fraction of the cost.
 */
export function inputsSha256(parts: Record<string, unknown>): string {
  return sha256Hex(
    canonicalJson(
      Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, inputSha256(part)])),
    ),
  );
}

/**
 * A debug artifact as a snapshot file (`fixtures/numbering/debug/`, `fixtures/documents/debug/`):
 * the header, then one decision per line with its id first and its evidence in key order — valid
 * JSON a reviewer can read as a diff, decision by decision.
 */
export function debugSnapshot(debug: StageDebug): string {
  const decisions = debug.decisions.map(({ id, rule, verdict, subject, evidence }) =>
    JSON.stringify({
      id,
      rule,
      verdict,
      subject,
      evidence: Object.fromEntries(Object.entries(evidence).sort(([a], [b]) => byCodePoint(a, b))),
    }),
  );
  const header = (['stage', 'stageVersion', 'irVersion', 'inputSha256'] as const).map(
    (key) => `  ${JSON.stringify(key)}: ${JSON.stringify(debug[key])},`,
  );
  return `{\n${header.join('\n')}\n  "decisions": [\n    ${decisions.join(',\n    ')}\n  ]\n}\n`;
}
