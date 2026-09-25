# The intent ladder — free text, read by rules

**Status:** the specification for slices S3 (T0–T4) and S6 (T5–T8), proposed 2026-09-25.
Decisions: ADR 0019 (deterministic ladder), ADR 0021 (JSON data, never YAML).

Every node in the conversation has a text entry under its cards: "Or type it — e.g. 'four buttons
in a row'". What is typed there is read by a **ladder** of deterministic methods, cheapest and
surest first. The first tier that clears its threshold wins. **Nothing below threshold is ever
applied**: the ladder's last rung is to ask.

## The contract

```ts
interface InterpretContext {
  nodeId: string;
  locale: string;                 // the author's interface language, e.g. 'sv-SE'
  graph: BuilderGraph;
  state: BuilderState;            // for T7's path prior and T5's slot vocabulary
  aliases: AliasEntry[];          // built-in + the organisation's learned aliases
}

interface Reading {
  nodeId: string;
  optionId: string | null;        // null for a quantity or a text value
  value: Json | null;             // the quantity, the list, the slot values
  confidence: number;             // integer per mille, 0–1000
  tier: 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';
  evidenceSpan: [number, number]; // UTF-16 offsets into the input that decided it
  alternatives: { nodeId: string; optionId: string | null; confidence: number }[];  // ≤ 3
}

type Interpretation =
  | { outcome: 'apply'; reading: Reading }           // ≥ threshold: becomes a patch in the log
  | { outcome: 'guess'; reading: Reading }           // T7: shown as a confirm-guess node
  | { outcome: 'ask'; options: Reading[] };          // T8: a visual menu of 3–6 siblings

function interpret(input: string, ctx: InterpretContext): Interpretation;   // pure
```

Every applied reading becomes an ordinary entry in the patch log with its `tier`, so it is undone
like any answer, and the UI shows a transparency chip under the node: *"read that as 'several
answers allowed' — change"*. Pressing **change** undoes that one entry and shows the
alternatives.

| Tier | Chip says |
| --- | --- |
| T0–T3 | "understood" |
| T4–T7 | "I think" |
| T8 | "I asked" |

## Arithmetic: integers, always

Confidence is an **integer per mille**. Every threshold below is compared as integers, and every
ratio is compared by cross-multiplication (`2·|A∩B| · 100 ≥ 62 · (|A| + |B|)`, never
`dice ≥ 0.62`). Nothing in a decision calls `Math.log`, `Math.exp` or `Math.pow`: those are not
required to be correctly rounded, and two JavaScript engines may disagree in the last bit — which
is enough to flip a threshold and break "same input, same output, on every machine"
(`CAVEATS.md` #38). Where a logarithm is genuinely needed (T2's inverse frequencies), it is
computed **once, at build time**, into the committed index (below), and the runtime only reads
integers.

## Normalisation (T1 and everything after it)

Applied to the input and to every alias, in this order, producing two forms:

1. NFKC; then `toLowerCase()` (locale-independent, so Turkish-style special cases cannot differ
   by machine; none of the twelve locales needs a locale-specific lower-case).
2. Quotes, dashes and spaces folded as in `NUMBERING-RULES.md` §4.
3. Punctuation `.,;:!?()[]{}"'` becomes a space; whitespace collapses.
4. Tokens: split on whitespace. For `zh-CN` and `ja-JP` text (any Han, Hiragana or Katakana
   character), CJK runs are split into overlapping **character bigrams** instead — there are no
   spaces to split on, and word-trigram fuzziness means nothing there.
5. **Primary form** = the tokens as above. **Folded form** = the same with combining marks removed
   after NFD (`å` → `a`, `ö` → `o`, `é` → `e`). The folded form is *secondary*: a match on it costs
   50 per mille, and it never replaces the input — the evidence span always points at what was
   typed.
6. **Digit words**: a token in the locale's number-word table (`gazetteers/numbers.json`, 0–20 and
   the tens to 100 in each of the twelve locales, e.g. `fyra` → 4, `vier` → 4, `四` → 4) gains a
   parallel digit token.

## The tiers

Thresholds are per mille. "Option" below means an option of the current node, unless T7 widens it.

**T0 — exact.** The normalised input equals an option id, or equals a built-in or learned alias of
exactly one option (primary form). Confidence 1000. Aliases are data: `aliases/<language>.json`,
one per shipped language.

**T1 — token match.** Every token of some alias of exactly one option appears among the input's
tokens (order-free, primary form), and the input has at most two other tokens that are not in the
locale's stop-word list. Confidence 900; 850 on the folded form.

**T2 — weighted keywords.** Each option has keywords (its aliases' tokens). A keyword's weight is
its inverse node-frequency, `round(1000 × ln(N / df))`, where `N` is the number of options in the
graph and `df` the number of options whose aliases contain it — computed at build time into the
index. An option's score is `1000 × Σ(weights of matched keywords) ÷ Σ(weights of all its
keywords)`, integer division. **Accept when the best score ≥ 720** and the runner-up is at least
150 below it; confidence = the score.

**T3 — fuzzy.** For each input word and each alias word: accept a match when
**trigram Dice ≥ 0.62 and Jaro-Winkler ≥ 0.80**, or when both words are at least 6 characters and
their **Levenshtein distance ≤ 2** ("buttoms" → "buttons", "flerval" → "flervalsfråga"'s stem).
Dice and Jaro-Winkler are computed as exact rationals and compared by cross-multiplication. An
option whose every alias token is matched (exactly or fuzzily) scores as in T1 minus 100 per fuzzy
word; accept at ≥ 720. Fuzzy work reads a **trigram index generated at build time** (below) and
stops after 10 ms of budget — measured in candidate comparisons (at most 20 000), not in wall
time, so the cut-off is the same on a slow machine.

**T4 — gazetteers and patterns.** Values rather than options, each a named, fixture-locked pattern
in `gazetteers/`:

| Pattern | Accepts | Example |
| --- | --- | --- |
| quantity | `^\d{1,3}$` or a number word, or either inside a short phrase ("four buttons") | `4`, `fyra`, `vier`, `四` |
| currency | a number with `kr`, `SEK`, `EUR`, `€`, `NOK`, `DKK`, `ISK`, `£`, `$` | `3 500 kr` |
| date | ISO, `d/m/yyyy`, `d.m.yyyy`, `d month yyyy` in the twelve locales | `2026-05-01`, `1. mai 2026` |
| e-mail | the WHATWG `type=email` pattern | |
| phone | `+` and 7–15 digits with spaces, dashes or brackets | `+46 70-123 45 67` |
| org.nr | Swedish `NNNNNN-NNNN` with the Luhn check | `556677-8899` |
| personnummer | `YYMMDD-NNNN` / `YYYYMMDD-NNNN` with the Luhn check, `+` for over 100 | |

Confidence 850 when the pattern matches the whole input, 750 when inside a phrase. A quantity is
only read into a `quantity` node or a T5 quantity slot.

**T5 — structured parse.** For multi-slot phrases: "three buttons, pill shape, side by side". The
input is split into clauses at `,`, `;` and the locale's conjunctions (`and`, `och`, `og`, `und`,
`et`, `y`, `ja`, `og`, `和`, `と`, `и`). Each clause is read by T0–T4 against the **slot
vocabularies** of the current group (for `choice`: quantity, answers, shape, placement). A slot is
filled only if exactly one clause resolves it at ≥ 720 and no other clause resolves it
differently — **all or nothing per slot**. Each filled slot becomes its **own** log entry, so each
can be undone alone. Clauses that resolve nothing are shown back ("I didn't understand 'fast'").

**T6 — a list from an example.** An input of two or more items separated by `,`, `;` or line
breaks, or a pasted numbered or bulleted list, becomes an option set: **the labels verbatim, the
count preserved**. A pasted list goes through the same paste → layout IR → enumerate path as a
pasted document (`NUMBERING-RULES.md`), so `1. Röd 2. Grön` and `• Red • Green` read the same way
the importer reads them.

**T7 — ranking the group.** When nothing above applies to the current node, every node in the
current group is scored: a path prior (+200 per mille for the node `next` would reach, +100 for
its siblings) plus the best T2 or T3 score of its options. **If the top is ≥ 600 and the runner-up
is ≥ 150 below it**, the top is offered as a guess in a `confirm-guess` node ("Did you mean the
shape?"); otherwise the top three are offered as cards.

**T8 — ask, then learn.** Always safe: a visual menu of 3–6 sibling options. When the person picks
one, Loppa offers **"Remember 'blabla' as a way to say this?"** — and only then writes an alias.

## Rules that hold on every rung

- **No number from vagueness.** "some", "a few", "several", `några`, `noen`, `nogle`, `einige`,
  `quelques`, `algunos`, `joitakin`, `nokkrir`, `一些`, `いくつか`, `несколько` never become a
  quantity; the quantity node is asked.
- **Negation is honoured.** A negator (`no`, `not`, `without`, `skip`, `don't`, `ingen`, `inga`,
  `inte`, `utan`, `hoppa över`, `nei`, `ikke`, `uden`, `ohne`, `kein`, `keine`, `nicht`, `sans`,
  `pas de`, `sin`, `ei`, `ilman`, `ekki`, `án`, `不`, `没有`, `无`, `なし`, `ない`, `без`, `не`,
  `нет`) before a node's keyword selects that node's declared `negative` option ("no buttons",
  "utan knappar", "skip logos"). A node with no `negative` option cannot be negated in text; the
  cards are shown.
- **Two misses in a row → shopping-list mode.** After two consecutive T8 outcomes, the next node
  is not another open question: every sibling in the group is shown as a categorised visual menu.
- **One press undoes any reading**, whatever its tier.

## Aliases: `aliases.json`

Built-in aliases ship as `packages/shared/src/interpret/aliases/<language>.json`. Learned aliases
are the organisation's (`builder_aliases`, one row each; the desktop's is its own install), and are
exported and imported as a file of exactly the same shape:

```json
{
  "aliasesVersion": 1,
  "entries": [
    { "phrase": "blabla", "nodeId": "choice.answers", "optionId": "many",
      "locale": "sv", "source": "user-confirmed", "createdAt": "2026-09-25", "count": 1, "notes": "" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `phrase` | verbatim as typed, 1–80 characters; matched after normalisation |
| `nodeId`, `optionId` | must exist in the current graph; an entry naming a node that no longer exists is kept but inert, and listed as such |
| `locale` | a primary language subtag of a shipped locale (`sv`, `en`, `zh`, …) |
| `source` | `built-in` (shipped), `user-confirmed` (the "Remember" press), `imported` (from a file) |
| `createdAt` | a date, `YYYY-MM-DD` — no time, nothing more identifying |
| `count` | how often it has matched, an integer; used only to order the admin list |
| `notes` | free text, for the person maintaining the file |

- **Provenance is a field, never a comment.** The file is JSON: no comments, keys in the order
  above, entries sorted by `locale`, `nodeId`, `optionId`, `phrase` (code-point order), two-space
  indentation — so a diff of an exported file is readable and the same aliases always produce the
  same bytes.
- **Schema-validated on load** (Zod). A malformed file never bricks the builder: on import it is
  refused with the first error shown; on the desktop, a hand-edited file that no longer parses is
  moved aside as `aliases.invalid-<date>.json`, the built-ins are used, and a notice offers
  **Reset to defaults**.
- **Consent, always.** Nothing is captured without the "Remember" press, which shows the exact
  phrase it will store. A phrase can contain a name; storing it is the person's choice, and an
  administrator can list, delete and export every learned alias.
- **Learned never overrides built-in.** An alias that already means a different option (built-in
  or learned) is refused, and the dialog says which option it already means. A learned alias never
  shadows an option id (T0).
- **Import shows a diff** — added, already present, refused and why — and adds nothing until
  confirmed (`CLAUDE.md` rule 7).

## The generated index

`pnpm interpret:index` (a script beside `builder-validate.ts`) reads the graph and the built-in
alias files and writes `packages/shared/src/interpret/index.generated.json`: per locale, the
trigram postings for T3 and the integer keyword weights for T2. It is committed, and a freshness
test regenerates it in memory and fails if the committed file differs — the same pattern as
`pnpm icons`. Learned aliases are few (at most 2 000 per organisation) and are indexed when loaded.

## Tests

- **Phrase tables** per tier and per locale, as data: `fixtures/ladder/<language>.json`, each row
  `{ "phrase", "nodeId", "expect": { "optionId" | "value", "tier" } }`. At least ten rows per tier
  per shipped language for T0–T4 in S3, and for T5–T7 in S6.
- **Must-not-resolve tables**, same files, `"expect": "ask"`: vague quantities, negations of
  nodes without a `negative` option, nonsense, and phrases that are one edit away from two
  different options.
- **Determinism**: every table row interpreted twice, and once with the entries shuffled, gives
  byte-identical output.
- **Budget**: the whole English table runs within the comparison budget with no row hitting the
  cut-off.

Changing an alias, a gazetteer or a threshold is a behaviour change: it needs a row in these tables
in the same commit (`CLAUDE.md`, "Guided Builder & Import").
