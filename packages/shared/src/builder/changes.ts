import type { Json } from './graph/schema.js';
import { MachineError } from './state.js';

/**
 * Resolved changes: what the log stores, and the only thing that ever changes the builder's state.
 *
 * A graph option declares a patch in the path language (`draft.definition.fields[focus].label`,
 * `{ $answer: true }`), which means different things in different states. When the machine applies
 * it, it resolves it into these: every selector pinned to an id, every reference replaced by the
 * value it stood for. A change means one thing in any state it applies to, so the log replays
 * without the graph — a session recorded against one graph version replays identically after the
 * next has changed what that option does (`BUILDER-GRAPH.md`, "Patches").
 *
 * Each change has an exact inverse, computed against the state it is applied to. Back is "apply
 * the last inverse"; a breadcrumb is "replay the log up to there"; the tests hold the two to each
 * other. Equal here means equal as canonical JSON: an inverse that puts a key back puts it at the
 * end of its object, which no reader of the draft can tell (and Postgres' `jsonb` re-sorts anyway).
 */

/** An array element, by its `id` (fields) or its `value` (options). */
export type Selector = { readonly id: string } | { readonly value: string };

/** A step into the state: an object key, or an array element by selector. */
export type Segment = string | Selector;

/** From the state's root: `['draft', 'definition', 'fields', { id: 'q-…' }, 'label']`. */
export type Pointer = readonly Segment[];

export type Change =
  | { readonly op: 'set'; readonly at: Pointer; readonly value: Json }
  | { readonly op: 'unset'; readonly at: Pointer }
  /** Into the array at `at`, after the element `after` selects, or first when null. */
  | {
      readonly op: 'insert';
      readonly at: Pointer;
      readonly value: Json;
      readonly after: Selector | null;
    }
  /** The element `at` points to. */
  | { readonly op: 'remove'; readonly at: Pointer }
  /** The element `at` points to, moved to after `after`, or first when null. */
  | { readonly op: 'reorder'; readonly at: Pointer; readonly after: Selector | null };

type Obj = { readonly [key: string]: unknown };

const isRecord = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const matches = (item: unknown, selector: Selector): boolean =>
  isRecord(item) &&
  ('id' in selector ? item['id'] === selector.id : item['value'] === selector.value);

/** How an array element is addressed: by its id, or by its value when it has no id. */
export function identityOf(element: unknown): Selector | null {
  if (!isRecord(element)) return null;
  if (typeof element['id'] === 'string') return { id: element['id'] };
  if (typeof element['value'] === 'string') return { value: element['value'] };
  return null;
}

const describe = (at: Pointer) =>
  at
    .map((s) => (typeof s === 'string' ? s : 'id' in s ? `[id=${s.id}]` : `[value=${s.value}]`))
    .join('.');

/** What `at` holds in `root`, or undefined. Total; own properties only. */
export function get(root: unknown, at: Pointer): unknown {
  let here: unknown = root;
  for (const segment of at) {
    if (typeof segment === 'string') {
      here = isRecord(here) && Object.hasOwn(here, segment) ? here[segment] : undefined;
    } else {
      here = Array.isArray(here) ? here.find((item: unknown) => matches(item, segment)) : undefined;
    }
    if (here === undefined) return undefined;
  }
  return here;
}

const REMOVE = Symbol('remove');

/**
 * `root` with the value at `at` replaced by `update(current)` — or removed, when it returns
 * `REMOVE`. Copies only along the path; nothing is mutated. A missing object on the way is created
 * (setting `style.shape` on a question with no `style` yet); a missing array element is an error.
 */
function updateAt(
  node: unknown,
  at: Pointer,
  depth: number,
  update: (current: unknown) => unknown,
): unknown {
  if (depth === at.length) return update(node);
  const segment = at[depth]!;
  if (typeof segment === 'string') {
    const record = node === undefined ? {} : node;
    if (!isRecord(record)) throw new MachineError('not-found', `${describe(at)}: not an object`);
    const current = Object.hasOwn(record, segment) ? record[segment] : undefined;
    const next = updateAt(current, at, depth + 1, update);
    if (next === REMOVE)
      return Object.fromEntries(Object.entries(record).filter(([k]) => k !== segment));
    return { ...record, [segment]: next };
  }
  if (!Array.isArray(node)) throw new MachineError('not-found', `${describe(at)}: not a list`);
  const index = node.findIndex((item: unknown) => matches(item, segment));
  if (index < 0) throw new MachineError('not-found', `${describe(at)}: no such element`);
  const next = updateAt(node[index], at, depth + 1, update);
  return next === REMOVE
    ? node.filter((_, i) => i !== index)
    : node.map((item: unknown, i) => (i === index ? next : item));
}

/** The position just after `after` in `list`, or 0 when null. */
function positionAfter(list: readonly unknown[], after: Selector | null, at: Pointer): number {
  if (after === null) return 0;
  const index = list.findIndex((item) => matches(item, after));
  if (index < 0) throw new MachineError('not-found', `${describe(at)}: nothing to insert after`);
  return index + 1;
}

function insertInto(list: unknown, value: unknown, after: Selector | null, at: Pointer): unknown[] {
  if (!Array.isArray(list)) throw new MachineError('not-found', `${describe(at)}: not a list`);
  const position = positionAfter(list, after, at);
  return [...list.slice(0, position), value, ...list.slice(position)];
}

/** `root` with one change applied. */
export function applyChange<T>(root: T, change: Change): T {
  switch (change.op) {
    case 'set':
      return updateAt(root, change.at, 0, () => change.value) as T;
    case 'unset':
      return get(root, change.at) === undefined
        ? root
        : (updateAt(root, change.at, 0, () => REMOVE) as T);
    case 'insert':
      return updateAt(root, change.at, 0, (list) =>
        insertInto(list, change.value, change.after, change.at),
      ) as T;
    case 'remove':
      return updateAt(root, change.at, 0, () => REMOVE) as T;
    case 'reorder': {
      const element = get(root, change.at);
      if (element === undefined) {
        throw new MachineError('not-found', `${describe(change.at)}: no such element`);
      }
      const without = updateAt(root, change.at, 0, () => REMOVE);
      return updateAt(without, change.at.slice(0, -1), 0, (list) =>
        insertInto(list, element, change.after, change.at),
      ) as T;
    }
  }
}

/** The element just before the one `at` points to, as a selector, or null when it is first. */
function predecessor(root: unknown, at: Pointer): Selector | null {
  const list = get(root, at.slice(0, -1));
  const segment = at[at.length - 1];
  if (!Array.isArray(list) || segment === undefined || typeof segment === 'string') {
    throw new MachineError('not-found', `${describe(at)}: not a list element`);
  }
  const index = list.findIndex((item: unknown) => matches(item, segment));
  if (index < 0) throw new MachineError('not-found', `${describe(at)}: no such element`);
  return index === 0 ? null : identityOf(list[index - 1]);
}

/**
 * The change that undoes `change`, computed against the `root` it is about to be applied to —
 * or null when it changes nothing (unsetting a key that is not there).
 */
export function inverseOf(root: unknown, change: Change): Change | null {
  switch (change.op) {
    case 'set':
    case 'unset': {
      const previous = get(root, change.at) as Json | undefined;
      if (previous !== undefined) return { op: 'set', at: change.at, value: previous };
      if (change.op === 'unset') return null;
      // A set makes whatever objects are missing on its way; undoing it removes the first one it
      // made, not just the key at the end, or an empty object would be left behind.
      const made = change.at.findIndex(
        (_, i) => get(root, change.at.slice(0, i + 1)) === undefined,
      );
      return { op: 'unset', at: change.at.slice(0, made + 1) };
    }
    case 'insert': {
      const identity = identityOf(change.value);
      if (!identity) {
        throw new MachineError('not-found', `${describe(change.at)}: the element has no id`);
      }
      return { op: 'remove', at: [...change.at, identity] };
    }
    case 'remove': {
      const element = get(root, change.at) as Json | undefined;
      if (element === undefined) {
        throw new MachineError('not-found', `${describe(change.at)}: no such element`);
      }
      return {
        op: 'insert',
        at: change.at.slice(0, -1),
        value: element,
        after: predecessor(root, change.at),
      };
    }
    case 'reorder':
      return { op: 'reorder', at: change.at, after: predecessor(root, change.at) };
  }
}

/** `root` with every change applied, in order: what Back (with an inverse) and replay do. */
export function applyAll<T>(root: T, changes: readonly Change[]): T {
  return changes.reduce<T>((here, change) => applyChange(here, change), root);
}

/**
 * Whether two JSON values are equal, whatever order their keys were written in. Fractions are
 * fine here (a paper anchor is one); `undefined` equals only itself.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, i) => jsonEqual(item, b[i]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  );
}
