# The builder graph — the conversation as data

**Status:** the specification for slices S1 and S2 (`ROADMAP.md`), proposed 2026-09-25; the graph
**built in S1** (`packages/shared/src/builder/graph/`), the machine that walks it **in S2**
(`packages/shared/src/builder/`, "The machine" below). Where this document and the code disagree, the code is
checked by tests and this document is the bug — fix it in the same change. Decisions: ADR 0020
(graph as data) and ADR 0021 (JSON or typed TS, never YAML).

The guided conversation is a directed graph of **nodes** declared in one data file. Components
render nodes; they never decide which node comes next, and nothing about the conversation's shape
lives in an `if` inside a component. That is what lets a validator prove the conversation has no
dead ends, lets a test walk every path, and lets a log of answers be replayed into the identical
draft.

## Format: typed TypeScript data

`packages/shared/src/builder/graph/nodes.ts` exports one constant, declared
`satisfies BuilderGraph`. It is **data written in TypeScript**, not code:

- The type checker catches a misspelt node kind, a patch op with a missing field, or a score for a
  template that does not exist, at the moment it is typed — before any validator runs.
- Comments are allowed, and this repository explains its decisions in comments. JSON cannot.
- `graph.test.ts` proves it is data: `JSON.parse(JSON.stringify(BUILDER_GRAPH))` deep-equals
  `BUILDER_GRAPH` (no functions, no `undefined`, no class instances, no `Date`). If the graph ever
  has to be delivered by a server or edited by a user, it can be emitted as JSON unchanged.
- **Never YAML.** No YAML parser is a dependency and none will be (ADR 0021).

## Node schema

```ts
/** An i18n key in apps/forms/src/lib/messages — never a literal string. */
export type MessageKey = `guided.${string}`;
/** A `when` expression (§"The when language"). */
export type Guard = string;
/** A template id from forms/templates.ts FORM_TEMPLATES. */
export type TemplateId = string;
/** Log-odds contribution in millinats (1/1000 of a natural-log unit). Integer. */
export type Millinats = number;

export interface BuilderGraph {
  graphVersion: number;
  start: string;
  inputs: Path[];             // facts the shell provides before the conversation (see "State and paths")
  nodes: Node[];
}

interface NodeBase {
  id: string;                 // dotted, group first: 'choice.buttons'
  group: string;              // the feature this node belongs to: 'brand', 'choice', 'text', …
  kind: NodeKind;
  ask: MessageKey;            // the question, ≤ 9 words (DESIGN-LANGUAGE.md)
  help: MessageKey;           // one line, for the "?" affordance
  when?: Guard;               // absent = always asked
  skip?: Skip;                // required with `when`: why it was skipped, in plain words
  next: Next;                 // where to go after an answer
  escape: string;             // a `menu` node id, or 'menu.siblings(<group>)'
  preview?: string;           // a preview spec id: what to render after this node
  negative?: string;          // the option a negated phrase selects ("no buttons") — INTENT-LADDER.md
}

export type Next = string | { when: Guard; to: string }[];   // list: first true guard wins; the
                                                             // last entry must be { when: 'true' }
export type Skip = MessageKey | { when: Guard; skip: MessageKey }[];   // one reason, or one per
                                                             // reason, read the same way as Next

export interface Option {
  id: string;
  label: MessageKey;          // labelled by consequence: "One answer only"
  detail?: MessageKey;        // a sentence of consequence under it
  icon?: string;              // an Icon.tsx name
  patch: Op[];
  score?: Record<TemplateId, Millinats>;
  next?: Next;                // overrides the node's `next` for this answer
}

export type Node =
  | (NodeBase & { kind: 'question'; options: Option[] })                 // 2–4 options
  | (NodeBase & { kind: 'pick-one'; options: Option[] })                 // a visual chooser, 2–8
  | (NodeBase & { kind: 'pick-many'; options: Option[] })                // multi-select cards, 2–8
  | (NodeBase & { kind: 'quantity'; min: number; max: number; default: number; patch: Op[] })
  | (NodeBase & { kind: 'text-entry'; target: Path; examples: MessageKey[]; required: boolean;
                  patch: Op[] })
  | (NodeBase & { kind: 'confirm-guess' })                               // Right / Sort of / No
  | (NodeBase & { kind: 'preview-moment'; preview: string })
  | (NodeBase & { kind: 'review-queue' })                                // IMPORT-PIPELINE.md §8
  | (NodeBase & { kind: 'menu'; entries: string[] })                     // node ids, a sibling grid
  | (Omit<NodeBase, 'next' | 'escape'> & { kind: 'end' });   // nowhere to go, nothing to escape to
```

## Node kinds

| Kind | Renders | Keyboard | Its answer |
| --- | --- | --- | --- |
| `question` | 2–4 large cards | 1–4 / Alt+1–4, Enter | the option's `patch` |
| `quantity` | a stepper with the number huge; "type a number" | 1–9 set it, ↑/↓ step, Enter | `patch` with `$answer` = the integer |
| `pick-one` | a visual chooser (shapes, slots, layouts), 2–8 tiles | arrows move, Enter picks | the option's `patch` |
| `pick-many` | multi-select cards, "Done" | Space toggles, Enter is Done | every picked option's `patch`, in declared order |
| `text-entry` | one text box, example chips under it | Enter accepts, Tab to chips | `patch` with `$answer` = the text, trimmed, verbatim otherwise |
| `confirm-guess` | "This looks like an event registration. Right?" | 1 Right, 2 Sort of, 3 No | a belief update; "Right" seeds (`PREDICTIVE-BUILDER.md`) |
| `preview-moment` | the real control on the brand kit + "Not completely happy…" | Enter continues, E edits | none; inline edits are `source: 'manual'` patches |
| `review-queue` | the import review screen | as the review screen | its own chips' patches |
| `menu` | the sibling grid — every node in a group as a card | arrows, Enter | jump to that node |
| `end` | "Your form is ready" + Publish + Keep going | Enter publishes (with confirmation) | none |

**Examples on a `text-entry` are labels, never operative wording.** A chip may say "Your name";
it may never say "I consent to the processing of my personal data". `graph.test.ts` checks every
example key's English value against the same forbidden list `templates.test.ts` uses (ADR 0012).

## State and paths

The reducer's state:

```ts
interface BuilderState {
  draft: { definition: FormDefinition; title: LocalisedText };
  sidecar: BuilderSidecar;           // PREDICTIVE-BUILDER.md, "The draft"
  pending: Record<string, Json>;     // the conversation's working memory
  focus: string | null;              // the field id being built, or null
  guess: { templateId: string; pMille: number } | null;   // the belief engine's top guess (S11)
  cursor: string;                    // the current node id
}
```

(`packages/shared/src/builder/state.ts`. The belief itself, `Record<TemplateId, Millinats>`,
joins the state with the engine that updates it, S11.)

Guards read `draft`, `sidecar`, `pending`, `focus` and `guess`, and `answered()` reads the log. A
guard that reads `pending.x` or `guess.x` must name something a patch writes or the graph lists in
`inputs` — the facts the shell provides before the conversation starts (`pending.brandKitExists`
from `GET /v1/brand-kit`; `guess.pMille` from the belief engine). A typo'd key fails G8 instead of
silently reading `null` for ever.

A **path** addresses state without array indices, so a path written today still means the same
field after the person reorders their questions:

```
path      = root ( '.' key | '[' selector ']' )*
root      = 'draft' | 'sidecar' | 'pending' | 'focus' | 'guess'
key       = [a-zA-Z][a-zA-Z0-9]*
selector  = 'focus'                       -- the field whose id is state.focus
          | 'id=' fieldId                 -- a field by id
          | 'value=' optionValue          -- an option by value
```

Examples: `draft.definition.fields[focus].appearance`,
`draft.definition.fields[focus].style.shape`, `draft.definition.settings.submitLabel`,
`pending.buttons`. **The paths a patch may write are one table** (`WRITABLE` in `graph/paths.ts`):
each pattern, the operations allowed on it, and a Zod schema for its values, taken from the form
schema itself (`CHOICE_SHAPES`, `FieldWidth`, `SelectOption`, …). A patch on any other path, or
with a value the schema refuses, fails G5 — which is why S1 cannot offer the `tab` and `segmented`
shapes before S5 adds them to `ChoiceStyle`, and why a patch may set a question's `type` only to
one the machine can build from a label alone (`QUESTION_TYPES`, "The machine" below). A text path
(`label`, `helpText`, `title`) is marked `localised`: `{ $answer: true }` there is the answer in the
author's language. `pending.*` takes any JSON: it is working memory and
is never published. Reading is total (`resolvePath`): a path that does not resolve is `undefined`,
own properties only.

## Patches

A patch is a list of operations applied in order. It is **the only way** the conversation — or an
inline edit — changes state.

| Op | Shape | Does | Inverse recorded in the log |
| --- | --- | --- | --- |
| `set` | `{ op: 'set', path, value }` | sets a value; `value: { $unset: true }` removes the key | `set` to the previous value, or `$unset` if there was none |
| `add` | `{ op: 'add', path, value }` | appends to an array (a field to `fields`, an option to `options`) | `remove` of what was added |
| `remove` | `{ op: 'remove', path }` | removes the addressed array element | `insert` of the element at its old position |
| `insert` | `{ op: 'insert', path, value, after: id \| null }` | inserts after an element (`null` = first) | `remove` |
| `reorder` | `{ op: 'reorder', path, id, after: id \| null }` | moves one element | `reorder` back to where it was |

A `value` may contain **references**, resolved when the patch is applied and stored resolved in
the log: `{ $answer: true }` (the quantity or text just given); `{ $newField: { type, word?, key?,
required? } }` (a new field with a fingerprint id — `PREDICTIVE-BUILDER.md`, "Stable ids" — whose
label, when `word` is given, is that word from `forms/vocabulary.ts`, which already carries it in
all twelve languages); `{ $lastAddedId: true }` (the id the previous `add` created, for `focus`);
`{ $options: n | { $answer: true } }` (`n` placeholder options); and `{ $unset: true }` with `set`
(remove the key). Nothing else: no computation, no string building.

**The log stores the resolved patch and its inverse**, not just the node and option that caused
it. That is what makes replay independent of the graph: a session recorded against graph version 3
replays identically after version 4 has changed what that option does.

## The machine

Slice S2, `packages/shared/src/builder/`: the pure reducer that walks the graph. A conversation is
where it started (`base`) and every step since (`log`); its state is always exactly
`replay(base, log)`, which the tests hold it to.

- **Resolving a patch** (`patches.ts`). Each operation is resolved against the state the ones
  before it produced, into changes (`changes.ts`) that mean one thing in any state: `[focus]`
  becomes `[id=<the question>]`, references become values, `add` becomes an `insert` after the
  last element. Each change has an exact inverse, computed against the state it applies to; a
  step's inverse undoes its changes last first.
- **A question is always one the schema accepts.** A write to part of a question is stored as that
  whole property rebuilt by the schema (`style.shape = 'pill'` on a question with no style stores
  the style a save and a load give back), and a property the question's type has no place for is
  refused. A new `type` rebuilds the whole question (`fields.ts`, `retype`): what fits is kept,
  what the new type needs is filled (two placeholder options for a choice), and what it cannot hold
  is set aside in the sidecar and comes back when a later type can hold it. `$options` resizes,
  keeping the options there are. A step that would leave the draft anything the schema would refuse
  or change is refused whole, and the conversation is as it was.
- **New questions** get a fingerprint id (`ids.ts`: FNV-1a 64 of `seed | ordinal | section`,
  base 32, `q-`), never one in `retiredIds` or the form (a collision takes `-2`, `-3`, …), a key
  unique the classic editor's way, and a sidecar record of where they came from. Undoing the step
  that made one frees its id; deleting one never does.
- **Where next.** After a step, the option's `next` or the node's; then past every node whose
  `when` is false, recording each with its reason (`skip`: one sentence, or the first of a list
  whose guard holds). Bounded by the size of the graph. A jump — the escape to a menu or a sibling,
  a menu's entry, the end's way back to the menus — is a step with no changes.
- **Back** applies the last inverse; **a breadcrumb** (`rewind`) replays the log up to it; the two
  agree. **A hand edit** (`edit`, inline editing, S5) is a step with `source: 'manual'` on paths
  `WRITABLE` allows, in the same log, as undoable as an answer; the trail does not show it.
- **Saved** as `BuilderSession` (`session.ts`): the base and the log, nothing derived, at most
  2 000 steps; `GET/PUT /v1/forms/:id/builder-session`, one per form and person, with a version
  lock (409 on a save over a version the saver did not read). A stored session that does not
  replay is `bad-session`, and the builder offers to start again rather than guess.
- **Proved over the whole graph** (`machine.test.ts`): every answer the graph offers, from every
  state reachable in seven steps — escapes included — is accepted; a publishable draft stays
  publishable; each step replays and undoes exactly. `fixtures/sessions/buttons-chain.json` is a
  recorded conversation that must keep replaying into the draft recorded with it.

## The `when` language

A guard decides whether a node is asked. It is a tiny, **total** expression language — every
expression evaluates to a boolean for every state, and nothing can loop, allocate without bound,
or reach outside the state it is given. There is no `eval` and no `Function`: guards are parsed
once by a hand-written recursive-descent parser in `guards.ts` into an AST and interpreted.

```
expr     = or
or       = and ( '||' and )*
and      = not ( '&&' not )*
not      = '!' not | cmp
cmp      = sum ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) sum )?
sum      = atom
atom     = literal | path ( '.length' )? | call | '(' expr ')'
literal  = integer | string ('single-quoted') | 'true' | 'false' | 'null'
call     = 'answered(' nodeId ')'     -- the node has an answer in the log
         | 'decided(' slot ')'        -- the import or an earlier answer decided this slot
         | 'count(' path ')'          -- array length, 0 when not an array
         | 'has(' path ')'            -- the path resolves to a value that is not null
```

- **Totality:** a path that does not resolve is `null`. A bare path in a boolean position is true
  only when its value is exactly `true`. `<`, `<=`, `>`, `>=` are `false` unless both sides are
  numbers; `==` and `!=` compare scalars by value, and a list or an object is never equal to
  anything. `.length` of anything but a list is `0`. Integers only; there is no arithmetic, so
  there is no overflow and no division.
- **Bounds:** an expression is at most 200 characters and nests at most 8 deep; the parser
  rejects anything longer, at validate time, not at run time.
- **Explain:** every node with a `when` has a `skip` message key. When a node is skipped, the trail
  shows it greyed with that sentence ("Skipped — you said you don't want buttons"), and
  `explain(guard, state)` returns which sub-expression was false, for the debug panel.
- **Slots** for `decided()` are the things S6 must not re-ask: `kind`, `required`, `options`,
  `shape`, `placement`, `validation`, each per field (`decided(kind)` reads
  `sidecar.fields[focus].decided.kind`).

## `score`

An option may declare `score: { 'event-registration': 200, 'rsvp': 120 }` — integer millinats
added to the belief when that option is chosen. The belief engine (S11) reads nothing else from
the graph. Scores are integers so the update is exact; probabilities are computed only for display
and for the p ≥ 0.80 test, via the committed table in ADR 0019.

## `next`, `escape`, `preview`

- `next` is a node id, or a list of `{ when, to }` read top to bottom, ending with
  `{ when: 'true', to }`. An option's own `next` overrides the node's.
- `escape` names the way out of this node without answering it: a `menu` node, or
  `'menu.siblings(<group>)'`, which renders every node of that group as a card. **Every node has
  one** (validator rule G3); `end` escapes to the top-level menu.
- `preview` names a preview spec in `graph/previews.ts`: which control to render (the focused
  field) and which parts are directly editable (shape, size, accent, labels, order). A node with
  `preview` is followed by a preview moment.

## Validation — `pnpm builder:validate`

`graph/validate.ts` implements these. `scripts/builder-validate.ts` (`pnpm builder:validate`) runs
all of them and lists every problem at once; `pnpm verify` runs them through
`packages/shared/src/builder/graph/validate.test.ts` (one broken graph per rule) and
`apps/forms/src/lib/guided-graph.test.ts` (the real graph against the real catalogues).

| Rule | Fails when |
| --- | --- |
| G0 | the graph does not have the schema's shape (`BuilderGraphSchema`): an unknown kind, a literal string where a message key belongs, a missing field. When G0 fails nothing else is checked, because every other rule assumes the shape |
| G1 | a `next`, `escape`, `menu.entries` or option `next` names a node that does not exist; two nodes share an id; two options of one node share an id; `negative` names no option |
| G2 | a node is unreachable from `start` (following `next`, option `next`, menu entries and escapes; `menu.siblings(g)` reaches every node of group `g`) |
| G3 | a node other than `end` has an escape that is not a `menu` node or `menu.siblings(<an existing group>)` |
| G4 | a message key (`ask`, `help`, `skip`, option `label`/`detail`, `examples`, and the keys the node's kind renders itself — `confirm-guess`'s Right / Sort of / No) is missing, or empty, in any of the twelve locales |
| G5 | a patch names a path not in `WRITABLE`, uses an operation that path does not allow, or writes a value the path's schema refuses |
| G6 | a cycle in the `next` graph (menus and escapes are not `next` edges) is made only of unconditional edges — a node-level `next` string, or a `{ when: 'true' }` branch — or has no edge that leaves it. An edge is conditional when only one option takes it or a `when` selects it: a loop the person steers is fine, a loop that turns by itself is not |
| G7 | a `question` has fewer than 2 or more than 4 options; `pick-one`/`pick-many` fewer than 2 or more than 8; a `quantity` whose `min ≤ default ≤ max` does not hold |
| G8 | a `when` (on a node, a `next` branch or a `skip` reason) does not parse, exceeds its bounds, reads a `pending.*` or `guess.*` key that no patch writes and `inputs` does not list; a node with `when` has no `skip`; or a `next` or `skip` list does not end with `when: 'true'` (none might hold, and the conversation would have nowhere to go or nothing to say) |
| G9 | a `score` names a template id not in `FORM_TEMPLATES`, or is not an integer |
| G10 | in any locale, a question is over its limit (9 words in English, 12 in the other space-separated languages, 24 characters in `zh-CN` and `ja-JP`; `{placeholders}` and punctuation-only tokens do not count), or anything the node says — question, help, options, skip reason — contains a banned word from `graph/voice.json` (whole words; substrings for `zh` and `ja`) |
| G11 | from any node, the longest simple path through nodes of its own group before a `preview-moment` or `end` exceeds **6** nodes — ADR 0006's four-press promise, restated for chains |
| G12 | the graph does not survive a JSON round trip exactly (a function, a class, a key holding `undefined`) |
| G13 | a `text-entry` example, in any locale, contains a regulated word (`forms/wording.ts`, the same list `templates.test.ts` holds the templates to) |

G4, G10 and G13 read the catalogues in `apps/forms`, which `packages/shared` must not import; that
is why they take the catalogues as an argument, run in the app's test and the root script, and why
the graph itself only holds keys.

## Three worked examples

Excerpts of `packages/shared/src/builder/graph/nodes.ts`, exactly as shipped (`…` marks an
elided option); S2 changed the buttons chain where the walk over the whole graph found it could
stop (`CAVEATS.md` #62, #65). English values from `apps/forms/src/lib/messages/en-GB.ts` are in the comments.

### 1. The buttons chain (scenario S2)

```ts
{
  id: 'choice.buttons', group: 'choice', kind: 'question',
  ask: 'guided.choice.buttons.ask',               // "Do you want buttons?"
  help: 'guided.choice.buttons.help',             // "Buttons let people pick instead of typing."
  when: 'has(focus) && !decided(kind)',
  skip: [{ when: '!has(focus)', skip: 'guided.skip.noQuestion' },   // "No question to change yet"
         { when: 'true', skip: 'guided.skip.decided' }],           // "Already read from your document"
  next: 'choice.answers', escape: 'menu.siblings(choice)', negative: 'no',
  options: [
    { id: 'yes', label: 'guided.common.yes', icon: 'check',
      // Buttons from this answer on, one answer by default; the next node refines it. So every
      // node after this one finds a choice to shape, however it is reached.
      patch: [{ op: 'set', path: 'pending.buttons', value: true },
              { op: 'set', path: 'draft.definition.fields[focus].type', value: 'single_select' },
              { op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'buttons' }],
      score: { 'event-registration': 120, 'customer-feedback': 80 } },
    { id: 'no', label: 'guided.choice.buttons.no',          // "No, people type an answer"
      patch: [{ op: 'set', path: 'pending.buttons', value: false },
              { op: 'set', path: 'draft.definition.fields[focus].type', value: 'short_text' }],
      next: 'flow.more' },
  ],
},
{
  id: 'choice.answers', group: 'choice', kind: 'question',
  ask: 'guided.choice.answers.ask',               // "One answer or several?"
  help: 'guided.choice.answers.help',             // "Can people pick more than one?"
  when: 'pending.buttons == true', skip: 'guided.skip.noButtons',
  next: 'choice.count', escape: 'menu.siblings(choice)',
  options: [
    { id: 'one', label: 'guided.choice.answers.one',        // "One answer only"
      patch: [{ op: 'set', path: 'draft.definition.fields[focus].type', value: 'single_select' },
              { op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'buttons' }] },
    { id: 'many', label: 'guided.choice.answers.many',      // "Several answers allowed"
      patch: [{ op: 'set', path: 'draft.definition.fields[focus].type', value: 'multi_select' },
              { op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'buttons' }] },
  ],
},
// choice.count — example 2 below
{
  id: 'choice.shape', group: 'choice', kind: 'pick-one',
  ask: 'guided.choice.shape.ask',                 // "What shape?"
  help: 'guided.choice.shape.help',               // "The shape of each button."
  when: 'pending.buttons == true && !decided(shape)',
  skip: [{ when: 'pending.buttons != true', skip: 'guided.skip.noButtons' },   // "You chose no buttons"
         { when: 'true', skip: 'guided.skip.decided' }],
  next: 'choice.placement', escape: 'menu.siblings(choice)',
  preview: 'choice.control',                      // S2: a live preview after the shape answer
  options: [
    { id: 'pill', label: 'guided.choice.shape.pill',
      patch: [{ op: 'set', path: 'draft.definition.fields[focus].style.shape', value: 'pill' }] },
    // … 'rounded' and 'square' the same way
    { id: 'tile', label: 'guided.choice.shape.tile',        // "Cards, with room for a picture"
      patch: [{ op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'cards' }] },
  ],
},
{
  id: 'choice.placement', group: 'choice', kind: 'pick-one',
  ask: 'guided.choice.placement.ask',             // "Where should they sit?"
  help: 'guided.choice.placement.help',
  when: 'pending.buttons == true', skip: 'guided.skip.noButtons',
  next: 'choice.preview', escape: 'menu.siblings(choice)',
  options: [
    { id: 'under-full', label: 'guided.choice.placement.underFull',   // "Under the question, full width"
      patch: [{ op: 'set', path: 'draft.definition.fields[focus].width', value: 'full' },
              { op: 'set', path: 'draft.definition.fields[focus].style.columns', value: '1' }] },
    { id: 'row', label: 'guided.choice.placement.row',                // "Side by side"
      patch: [{ op: 'set', path: 'draft.definition.fields[focus].style.columns', value: 'auto' }] },
  ],
},
{ id: 'choice.preview', group: 'choice', kind: 'preview-moment', preview: 'choice.control',
  ask: 'guided.preview.ask',                      // "Here's how it looks."
  help: 'guided.choice.preview.help',             // "Click it to change anything by hand."
  next: 'flow.more', escape: 'menu.siblings(choice)' },
```

The chain is five decisions long plus a preview — exactly G11's bound of six. A tile is the
existing `cards` appearance, not a new shape. **`tab` and `segmented` are not offered in S1**:
`ChoiceStyle` has no such shapes yet, so a patch writing them fails G5 (`validate.test.ts` holds a
case that proves it). They join in S5, with the schema change that makes them values.

### 2. A quantity

```ts
{
  id: 'choice.count', group: 'choice', kind: 'quantity',
  ask: 'guided.choice.count.ask',                 // "How many options?"
  help: 'guided.choice.count.help',               // "You can add or remove options later."
  when: 'pending.buttons == true && !decided(options)',
  skip: [{ when: 'pending.buttons != true', skip: 'guided.skip.noButtons' },
         { when: 'true', skip: 'guided.skip.decided' }],
  min: 2, max: 12, default: 3,
  patch: [{ op: 'set', path: 'draft.definition.fields[focus].options',
            value: { $options: { $answer: true } } }],
  next: 'choice.shape', escape: 'menu.siblings(choice)',
}
```

Typing "4", "four", "fyra" or "vier" in the text entry reaches the same answer through the ladder's
T4 (`INTENT-LADDER.md`). "Some" does not: quantities are never inferred from vagueness. S4 adds
`choice.optionLabels` after it — a `text-entry` per option whose value lands verbatim in that
option's label; a pasted list ("Red, Green, Blue") fills them all at once (T6) and sets the count
to the list's length, preserved. Until then `$options` gives placeholder options.

### 3. The brand kit

```ts
{
  id: 'brand.start', group: 'brand', kind: 'question',
  ask: 'guided.brand.start.ask',                  // "Should this look like your organisation?"
  help: 'guided.brand.start.help',                // "Uses the logo and colours from your brand kit."
  when: '!has(sidecar.brandDecided)', skip: 'guided.skip.brandDecided',
  next: [{ when: 'pending.brandKitExists == true', to: 'brand.logoSlot' },
         { when: 'true', to: 'brand.quick' }],
  escape: 'menu.siblings(brand)', negative: 'later',
  options: [
    { id: 'yes', label: 'guided.brand.start.yes',             // "Yes, use our colours and logo"
      patch: [{ op: 'set', path: 'sidecar.brandDecided', value: 'organisation' }] },
    { id: 'later', label: 'guided.brand.start.later',         // "Decide later"
      patch: [{ op: 'set', path: 'sidecar.brandDecided', value: 'default' }],
      next: 'text.label' },
  ],
},
{
  id: 'brand.quick', group: 'brand', kind: 'pick-one',
  ask: 'guided.brand.quick.ask',                  // "Which colours should your form use?"
  help: 'guided.brand.quick.help',
  next: 'brand.logoSlot', escape: 'menu.siblings(brand)',
  options: [
    { id: 'minimal', label: 'guided.brand.quick.minimal',
      patch: [{ op: 'set', path: 'pending.themePreset', value: 'minimal' }] },
    // … 'garden', 'bold', 'midnight' — never `default`, which is Loppa's own look (CAVEATS #32)
  ],
},
{
  id: 'brand.logoSlot', group: 'brand', kind: 'pick-one',
  ask: 'guided.brand.logoSlot.ask',               // "Where should your logo go?"
  help: 'guided.brand.logoSlot.help',
  next: 'brand.preview', escape: 'menu.siblings(brand)', preview: 'brand.masthead',
  options: [
    { id: 'header-left', label: 'guided.brand.logoSlot.headerLeft',   // "Top left, beside the title"
      patch: [{ op: 'set', path: 'pending.logoSlot', value: 'header-left' }] },
    // … masthead-centred, corner-watermark, footer-strip, sidebar-rail, card-top
  ],
},
```

`pending.brandKitExists` is set by the shell before the conversation starts, from `GET
/v1/brand-kit` — one of the graph's two `inputs`, and it arrives as data in state, not as a call
from inside a guard. The preset and the logo slot are kept in `pending` until the draft has a
place for them: S5 adds `FormSettings.layout` and moves the slot there; S4 applies the preset
through the existing brand-kit endpoint, and adds the logo upload with colours from the logo
(`dominant-colour.ts`). No node here ever renders in Loppa's own colours (`CAVEATS.md` #32).

## The nodes of slice S1

Fifteen asking nodes — the brand kit, the buttons chain, a text question, a quantity and a
confirm-guess, as the brief lists, plus the one loop every form needs — and the two structural
ones every graph has:

| Id | Kind | Asks (English) |
| --- | --- | --- |
| `flow.start` | question | What is this form for? (ADR 0006's sector question, now scoring templates) |
| `guess.confirm` | confirm-guess | This looks like an event registration. Right? |
| `brand.start` | question | Should this look like your organisation? |
| `brand.quick` | pick-one | Which colours should your form use? |
| `brand.logoSlot` | pick-one | Where should your logo go? |
| `brand.preview` | preview-moment | Here's how it looks. |
| `text.label` | text-entry | What do you want to ask? |
| `text.required` | question | Must everyone answer this? |
| `choice.buttons` | question | Do you want buttons? |
| `choice.answers` | question | One answer or several? |
| `choice.count` | quantity | How many options? |
| `choice.shape` | pick-one | What shape? |
| `choice.placement` | pick-one | Where should they sit? |
| `choice.preview` | preview-moment | Here's how it looks. |
| `flow.more` | question | Add another question? (the loop: Yes → `text.label`, No → `end`) |
| `menu.top` | menu | the escape of last resort: every group as a card |
| `end` | end | Your form is ready. |

`choice.optionLabels` joins them in S4, when there is a screen to type option labels into; until
then `$options` gives "Option 1…n" (`V.option` in `forms/vocabulary.ts`, the same words as the
classic editor's `field.defaultOption`, in all twelve languages).

S2 changed three things the walk over the whole graph found (`CAVEATS.md` #62, #65):
`text.required` asks only when there is a question (`when: 'has(focus)'`, skip reason
`guided.skip.noQuestion`); `text.label` clears `pending.buttons`, so the last question's answer
about buttons does not leak into the next (it had been cleared only on `flow.more`'s "yes", which
a menu jump goes round); and `choice.buttons`' "yes" makes the question a choice at once.
