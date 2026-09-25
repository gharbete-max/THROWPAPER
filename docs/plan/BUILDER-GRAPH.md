# The builder graph — the conversation as data

**Status:** the specification for slice S1 (`ROADMAP.md`), proposed 2026-09-25. Decisions: ADR
0020 (graph as data) and ADR 0021 (JSON or typed TS, never YAML).

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
  nodes: Node[];
}

interface NodeBase {
  id: string;                 // dotted, group first: 'choice.buttons'
  group: string;              // the feature this node belongs to: 'brand', 'choice', 'text', …
  kind: NodeKind;
  ask: MessageKey;            // the question, ≤ 9 words (DESIGN-LANGUAGE.md)
  help: MessageKey;           // one line, for the "?" affordance
  when?: Guard;               // absent = always asked
  skip?: MessageKey;          // required with `when`: why it was skipped, in plain words
  next: Next;                 // where to go after an answer
  escape: string;             // a `menu` node id, or 'menu.siblings(<group>)'
  preview?: string;           // a preview spec id: what to render after this node
  negative?: string;          // the option a negated phrase selects ("no buttons") — INTENT-LADDER.md
}

export type Next = string | { when: Guard; to: string }[];   // list: first true guard wins; the
                                                             // last entry must be { when: 'true' }

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
  | (NodeBase & { kind: 'end' });
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
  belief: Record<TemplateId, Millinats>;
  cursor: string;                    // the current node id
}
```

A **path** addresses state without array indices, so a path written today still means the same
field after the person reorders their questions:

```
path      = root ( '.' key | '[' selector ']' )*
root      = 'draft' | 'sidecar' | 'pending' | 'focus'
key       = [a-zA-Z][a-zA-Z0-9]*
selector  = 'focus'                       -- the field whose id is state.focus
          | 'id=' fieldId                 -- a field by id
          | 'value=' optionValue          -- an option by value
```

Examples: `draft.definition.fields[focus].appearance`,
`draft.definition.fields[focus].style.shape`, `draft.definition.settings.submitLabel`,
`pending.buttons`. **The set of valid paths is a schema** (`graph/schema.ts`), generated from the
Zod `FormDefinition` plus the sidecar and `pending` keys the graph declares; a patch naming any
other path fails `builder:validate`.

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
the log: `{ $answer: true }` (the quantity or text just given), `{ $newField: '<type>' }` (a new
field with a fingerprint id — `PREDICTIVE-BUILDER.md`, "Stable ids"), `{ $options: n }` (`n`
placeholder options with ids, labelled "Option 1…n" from the catalogue). Nothing else: no
computation, no string building.

**The log stores the resolved patch and its inverse**, not just the node and option that caused
it. That is what makes replay independent of the graph: a session recorded against graph version 3
replays identically after version 4 has changed what that option does.

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

- **Totality:** a path that does not resolve is `null`. `null` compared with anything by `<`,
  `<=`, `>`, `>=` is `false`; `==` and `!=` compare by value. `.length` of a non-array is `0`.
  Integers only; there is no arithmetic, so there is no overflow and no division.
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

`scripts/builder-validate.ts` runs these over the graph, and `graph.test.ts` runs the same
function so `pnpm verify` fails too. Each rule has a broken-graph test in S1.

| Rule | Fails when |
| --- | --- |
| G1 | a `next`, `escape`, `menu.entries` or option `next` names a node that does not exist |
| G2 | a node is unreachable from `start` (following `next`, option `next`, menus and escapes) |
| G3 | a node other than `end` has no `escape`, or its escape does not resolve to a `menu` |
| G4 | a message key (`ask`, `help`, `skip`, option `label`/`detail`, `examples`) is missing, or empty, in any of the twelve locales |
| G5 | a patch names a path not in the path schema, or an op/value shape the schema does not allow |
| G6 | a cycle in the `next` graph is made only of unconditional edges (a node-level `next` string, taken whatever the answer), or has no edge that leaves it. An edge is conditional when only one option takes it or a `when` selects it: a loop the person steers is fine, a loop that turns by itself is not |
| G7 | a `question` has fewer than 2 or more than 4 options; `pick-one`/`pick-many` fewer than 2 or more than 8 |
| G8 | a `when` does not parse, exceeds its bounds, or has no `skip` key |
| G9 | a `score` names a template id not in `FORM_TEMPLATES` or `belief/recipes.json`, or is not an integer |
| G10 | the English value of an `ask` exceeds 9 words, or any value contains a banned word (`DESIGN-LANGUAGE.md`) |
| G11 | from any node that starts a group, the longest unguarded chain to a `preview-moment` or `end` exceeds **6** nodes — ADR 0006's four-press promise, restated for chains |
| G12 | the graph is not JSON-serialisable (see "Format") |
| G13 | a `text-entry` example's English value matches the operative-wording forbidden list |

G4 reads the catalogue in `apps/forms`, which `packages/shared` must not import; that is why the
validator is a script at the root and a test in `apps/forms`, and the graph itself only holds keys.

## Three worked examples

### 1. The buttons chain (scenario S2)

```ts
{
  id: 'choice.buttons', group: 'choice', kind: 'question',
  ask: 'guided.choice.buttons.ask',               // "Do you want buttons?"
  help: 'guided.choice.buttons.help',             // "Buttons let people pick instead of type."
  when: 'has(focus) && !decided(kind)',
  skip: 'guided.choice.buttons.skip',             // "Already read from your document"
  next: 'choice.answers',
  escape: 'menu.siblings(choice)',
  options: [
    { id: 'yes', label: 'guided.common.yes', icon: 'choice-buttons',
      patch: [{ op: 'set', path: 'pending.buttons', value: true }],
      score: { 'event-registration': 120, 'customer-feedback': 80 } },
    { id: 'no', label: 'guided.choice.buttons.no',          // "No, people type an answer"
      patch: [{ op: 'set', path: 'pending.buttons', value: false },
              { op: 'set', path: 'draft.definition.fields[focus].type', value: 'short_text' }],
      next: 'text.required' },
  ],
},
{
  id: 'choice.answers', group: 'choice', kind: 'question',
  ask: 'guided.choice.answers.ask',               // "One answer or several?"
  help: 'guided.choice.answers.help',
  when: 'pending.buttons == true', skip: 'guided.choice.answers.skip',
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
  help: 'guided.choice.shape.help',
  when: '!decided(shape)', skip: 'guided.choice.shape.skip',
  next: 'choice.placement', escape: 'menu.siblings(choice)',
  preview: 'choice.control',                      // S2: a live preview after the shape answer
  options: ['pill', 'rounded', 'square', 'tab', 'segmented', 'tile'].map((shape) => ({
    id: shape, label: `guided.choice.shape.${shape}`, icon: `shape-${shape}`,
    patch: [{ op: 'set', path: 'draft.definition.fields[focus].style.shape', value: shape }],
  })),                                            // (written out literally in nodes.ts — data, not code)
},
{
  id: 'choice.placement', group: 'choice', kind: 'pick-one',
  ask: 'guided.choice.placement.ask',             // "Where should they sit?"
  help: 'guided.choice.placement.help',
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
  ask: 'guided.preview.ask', help: 'guided.preview.help',   // "Here's how it looks."
  next: 'flow.more', escape: 'menu.siblings(choice)' },
```

The chain is five decisions long plus a preview (G11's bound is six). `tab`, `segmented` and
`tile` are the new presentation values `PREDICTIVE-BUILDER.md` lists; `tile` writes
`appearance: 'cards'` rather than a shape.

### 2. A quantity

```ts
{
  id: 'choice.count', group: 'choice', kind: 'quantity',
  ask: 'guided.choice.count.ask',                 // "How many options?"
  help: 'guided.choice.count.help',               // "You can add or remove options later."
  when: 'pending.buttons == true && !decided(options)',
  skip: 'guided.choice.count.skip',
  min: 2, max: 12, default: 3,
  patch: [{ op: 'set', path: 'draft.definition.fields[focus].options', value: { $options: { $answer: true } } }],
  next: 'choice.optionLabels', escape: 'menu.siblings(choice)',
}
```

Typing "4", "four", "fyra" or "vier" in the text entry reaches the same answer through the ladder's
T4 (`INTENT-LADDER.md`). "Some" does not: quantities are never inferred from vagueness. The next
node, `choice.optionLabels`, is a `text-entry` per option whose value lands verbatim in that
option's label; a pasted list ("Red, Green, Blue") fills them all at once (T6) and sets the count
to the list's length, preserved.

### 3. The brand kit

```ts
{
  id: 'brand.start', group: 'brand', kind: 'question',
  ask: 'guided.brand.start.ask',                  // "Should this look like your organisation?"
  help: 'guided.brand.start.help',
  when: '!has(sidecar.brandDecided)', skip: 'guided.brand.start.skip',
  next: [{ when: 'pending.brandKitExists == true', to: 'brand.logoSlot' },
         { when: 'true', to: 'brand.quick' }],
  escape: 'menu.siblings(brand)',
  options: [
    { id: 'yes', label: 'guided.brand.start.yes',             // "Yes, use our colours and logo"
      patch: [{ op: 'set', path: 'sidecar.brandDecided', value: 'organisation' }] },
    { id: 'later', label: 'guided.brand.start.later',         // "Decide later"
      patch: [{ op: 'set', path: 'sidecar.brandDecided', value: 'default' }],
      next: 'text.label' },
  ],
},
{
  id: 'brand.logoSlot', group: 'brand', kind: 'pick-one',
  ask: 'guided.brand.logoSlot.ask',               // "Where should your logo go?"
  help: 'guided.brand.logoSlot.help',
  next: 'brand.preview', escape: 'menu.siblings(brand)', preview: 'brand.masthead',
  options: [/* header-left, masthead-centred, corner-watermark, footer-strip, sidebar-rail,
              card-top — DESIGN-LANGUAGE.md "Placement slots"; each sets
              draft.definition.settings.layout.logoSlot */],
},
```

`pending.brandKitExists` is set by the shell before the conversation starts, from `GET
/v1/brand-kit` — the only fact the graph receives from outside, and it arrives as data in state,
not as a call from inside a guard. `brand.quick` is the 60-second "your colours and logo" flow
(three nodes: logo upload, colours from the logo via the existing `dominant-colour.ts`, a preset
fallback). No node here ever renders in Loppa's own colours (`CAVEATS.md` #32).

## The nodes of slice S1

Fifteen asking nodes — the brand kit, the buttons chain, a text question, a quantity and a
confirm-guess, as the brief lists, plus the one loop every form needs — and the two structural
ones every graph has:

| Id | Kind | Asks (English) |
| --- | --- | --- |
| `flow.start` | question | What is this form for? (ADR 0006's sector question, now scoring templates) |
| `guess.confirm` | confirm-guess | This looks like an event registration. Right? |
| `brand.start` | question | Should this look like your organisation? |
| `brand.quick` | pick-one | Pick colours, or add your logo |
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
then `$options` gives "Option 1…n" from the catalogue.
