# The intent ladder — free text, read by rules

**Status:** the specification for slices S3 (T0–T4, built — `packages/shared/src/interpret/`) and
S6 (T5–T8), proposed 2026-09-25, brought up to date with S3 on 2026-09-26 (the changes are listed
at the end). Decisions: ADR 0019 (deterministic ladder), ADR 0021 (JSON data, never YAML).

Every node in the conversation has a text entry under its cards: "Or type it — e.g. 'four buttons
in a row'". What is typed there is read by a **ladder** of deterministic methods, cheapest and
surest first. The first tier that clears its threshold wins. **Nothing below threshold is ever
applied**: the ladder's last rung is to ask.

## The contract

```ts
interface InterpretContext {
  graph: BuilderGraph;
  nodeId: string;
  locale: string;                 // the author's interface language, e.g. 'sv-SE'
  aliases?: AliasEntry[];         // the built-in aliases by default; S6 adds the organisation's
  // S6 adds `state`, for T7's path prior and T5's slot vocabulary.
}

interface Reading {
  nodeId: string;
  optionId: string | null;        // null for a quantity
  value: Json | null;             // the quantity; S6: the list, the slot values
  confidence: number;             // integer per mille, 0–1000
  tier: 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';
  evidenceSpan: [number, number]; // UTF-16 offsets into the input as typed
  alternatives: { nodeId: string; optionId: string | null; confidence: number }[];  // ≤ 3
}

type AskReason =
  | 'nothing' | 'ambiguous' | 'negated' | 'vague' | 'out-of-range'
  | 'budget' | 'too-long' | 'not-readable';

type Interpretation =
  | { outcome: 'apply'; reading: Reading }                        // ≥ threshold: a patch in the log
  | { outcome: 'ask'; reason: AskReason; options: Reading[] };    // T8: a visual menu
  // S6 adds { outcome: 'guess'; reading } — T7, shown as a confirm-guess node.

function interpret(input: string, ctx: InterpretContext): Interpretation;   // pure
function toAnswer(graph: BuilderGraph, reading: Reading): Answer;           // for machine.answer
```

`ask` says why, so the shell can say it: "I didn't understand", "Which one?", "Between 2 and
12", "How many exactly?". In S3 its `options` are the node's own options, most likely first
(tier T8); S6 widens them to the group. `not-readable` is for a node whose free text is not read:
a text entry's text *is* its answer, and previews and menus are answered by pressing.

Every applied reading becomes an ordinary entry in the patch log with its `tier` (`toAnswer`, then
`answer(…, { tier })`), so it is undone like any answer, and the UI shows a transparency chip under
the node: *"read that as 'several answers allowed' — change"*. Pressing **change** undoes that one
entry and shows the alternatives.

| Tier | Chip says (`chipOf`) |
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
(`CAVEATS.md` #38). T2's inverse frequencies do need a logarithm: `lnMille(p, q)` computes
`round(1000 × ln(p / q))` as a series in 40-digit fixed point with `BigInt` (`interpret/ln.ts`),
whose error is far below anything that could change the rounding — the same integers in every
engine, and nothing to generate at build time (see "No generated index").

## Normalisation (T1 and everything after it)

Applied to the input and to every alias (`interpret/text.ts`). The input is cut into segments — a
code point and the combining marks after it — and each segment is normalised by itself, so every
character of the result knows where it came from: **an evidence span is always a span of what was
typed**, however NFKC reshaped it (`ﬁ` → `fi`, `５` → `5`).

1. NFKC; then `toLowerCase()` (locale-independent, so Turkish-style special cases cannot differ
   by machine; none of the twelve locales needs a locale-specific lower-case).
2. Quotes, dashes and spaces folded as in `NUMBERING-RULES.md` §4.
3. **Anything that is not a letter, a digit or a combining mark separates words** (so
   `Side-by-side!` is `side by side`), and a run of digits is its own word (`4st` is `4 st`,
   `4个` is `4 个`). Clauses end at `, ; : . ! ?`, their CJK forms and line breaks.
4. Tokens: the words. For `zh-CN` and `ja-JP` text (any Han, Hiragana or Katakana character),
   CJK runs are split into overlapping **character bigrams** instead (one character alone stays
   itself) — there are no spaces to split on, and word fuzziness means nothing there.
5. **Primary form** = the tokens as above. **Folded form** = the same with combining marks removed
   after NFD (`å` → `a`, `ö` → `o`, `é` → `e`). The folded form is *secondary*: a match on it costs
   50 per mille, and it never replaces the input — the evidence span always points at what was
   typed.
6. **Number words**: the language's number words (`gazetteers/<language>.json`, 0–20 and the tens
   to 100 in each of the twelve languages, e.g. `fyra` → 4, `vier` → 4, `dix-sept` → 17 as one
   number) are read as numbers; in Chinese and Japanese the numerals 〇–九, 十 and 百 compose
   (`二十一` → 21) and the native counts are words (`よっつ` → 4).

**Stop words** (per language, in the same file) are function words and politeness — "I", "want",
"please", `jag`, `vill`, `tack` — single tokens (bigrams in Chinese and Japanese). They are never
an alias's keywords, and they do not count as "other words" (T1). A stop word that carries meaning
here is not one: Spanish `sobre` ("above") is a word, because *sobre el título* is not *junto al
título*.

## The tiers

Thresholds are per mille. "Option" below means an option of the current node, unless T7 widens it.
An alias's **words** are its tokens that are not stop words (all of them, if every one is).

**T0 — exact.** The normalised input equals an option id, or equals a built-in or learned alias of
exactly one option (primary form). Confidence 1000. Aliases are data: `aliases/<language>.json`,
one per shipped language, and every card's own label is among them.

**T1 — token match.** Every word of some alias of an option appears among the input's tokens
(order-free, primary form), and the input has at most two other tokens that are not stop words.
Confidence 900; 850 on the folded form. When more than one option matches, the one whose matched
words include **all** of every other's wins — it explains more of what was typed: `det krävs inte`
matches "krävs" (required) and "krävs inte" (not required), and is the second. Otherwise it is
ambiguous. An alias that says a negator ("no buttons", `inte obligatorisk`, `不要按钮`) matches
**only in its own order**: "buttons no" is not "no buttons".

**T2 — weighted keywords.** A keyword's weight is its inverse frequency, `lnMille(N, df)`, where
`N` is the number of options in the graph with aliases in this language and `df` the number of
those whose aliases have the keyword — computed with integers when the vocabulary is built. An
alias's score is `1000 × Σ(weights of its matched words) ÷ Σ(weights of all its words)`, integer
division, 50 less if a word matched only folded; **an option's score is its best alias's**.
**Accept when the best score ≥ 720** and the runner-up is at least 150 below it; confidence =
the score, **capped at 850** — a weighted partial read is never surer than T1's tight one. T2 is
what reads the long sentence: "I would really like the buttons to look like pills please".

**T3 — fuzzy.** For each input word and each alias word: accept a match when
**trigram Dice ≥ 0.62 and Jaro-Winkler ≥ 0.80**, or when both words are at least 6 characters and
their **Levenshtein distance ≤ 2** ("buttoms" → "buttons", "flervall" → "flerval"). Dice (on the
trigrams of `#word#`) and Jaro-Winkler are compared as exact fractions by cross-multiplication
(`interpret/fuzzy.ts`). An option whose every alias word is matched (exactly or fuzzily) scores as
in T1 minus 100 per fuzzy word; accept when **exactly one option** reaches 720. Chinese and
Japanese bigrams are never compared fuzzily. The work is capped by counting comparisons — **at most
20 000 per reading** — not by a clock, so the cut-off is the same on a slow machine; a reading
that spends the budget is asked (`budget`). One node's vocabulary is small enough that every
input word is compared with every alias word; there is no candidate index (see below).

**T4 — gazetteers and patterns.** Values rather than options, each a named, fixture-locked pattern
(`interpret/patterns.ts`, `readPattern(kind, input, language)`):

| Pattern | Accepts | Example |
| --- | --- | --- |
| quantity | `^\d{1,3}$` or a number word, alone or inside a phrase with at most three other words that are not stop words (in Chinese and Japanese, two characters count as a word) | `4`, `fyra`, `vier`, `四つ`, "four buttons in a row" |
| currency | a number grouped and separated as the language writes it, with `kr`, `SEK`, `EUR`, `€`, `NOK`, `DKK`, `ISK`, `£`, `$` or the language's own word; the amount an exact decimal string; `kr` names its currency only in Swedish, Danish, Norwegian and Icelandic | `3 500 kr` → `{ "amount": "3500", "currency": "SEK" }` |
| date | ISO; `d/m/yyyy` and `d.m.yyyy`; `yyyy/m/d` and `yyyy年m月d日`; `d month yyyy` with the language's month names (`1. mai`, `1er mai`, `1st May`, `1 de mayo de`, `1 мая`) — a real calendar date only | `2026-05-01`, `1. mai 2026` |
| e-mail | the WHATWG `type=email` pattern | |
| phone | `+` and 7–15 digits with spaces, dashes or brackets | `+46 70-123 45 67` → `+46701234567` |
| org.nr | Swedish `NNNNNN-NNNN` with the Luhn check and a third digit of at least 2 (which is what makes it not a personnummer) | `556677-8899` |
| personnummer | `YYMMDD-NNNN` / `YYYYMMDD-NNNN` with the Luhn check over the last ten digits, a real month and day (a samordningsnummer's day is 61–91), `+` for over 100 with the six-digit form only; kept as written — the century is not guessed, because that needs today's date | `811218-9876` |

Confidence 850 when the pattern is the whole input, 750 when inside a phrase. **Two different
values of one kind in one input are no value**: "3 or 4", two dates — which was meant is a
question. A quantity is only read into a `quantity` node (or, in S6, a T5 quantity slot), and a
number outside the node's range is asked (`out-of-range`), never clamped. The other patterns are
for S6's slots and S9's classifier; in S3 they are read by the phrase tables.

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
  `quelques`, `algunos`, `joitakin`, `nokkrir`, `一些`, `いくつか`, `несколько` (each language's
  `vague` list) never become a quantity; the quantity node is asked (`vague`), even with a digit
  beside them.
- **Negation is honoured.** A negator (each language's `negators` list: `no`, `not`, `without`,
  `skip`, `don't`, `nothing`, `ingen`, `inga`, `inte`, `utan`, `hoppa över`, `nei`, `ikke`,
  `uden`, `ohne`, `kein`, `keine`, `nicht`, `sans`, `pas de`, `ne`, `sin`, `ei`, `ilman`, `ekki`,
  `án`, `engir`, `不要`, `没有`, `无需`, `なし`, `ない`, `いらない`, `без`, `не`, `нет`, …) and a word
  of one of the node's options *other than* its declared `negative` one, in the same **stretch** of
  the sentence, select the `negative` option ("no buttons", "utan knappar", "skip logos"). A stretch
  is a clause, cut again at a contrast word (`but`, `men`, `aber`, `mais`, `pero`, `но`, `但是`,
  `でも`, …: "not text but buttons" does not negate "buttons"). The word comes **after** the
  negator — or before it when the negator ends the stretch, as Swedish and German say it:
  "knappar behövs inte", "Buttons brauche ich nicht". In Chinese and Japanese the negator may
  stand on either side (`不要按钮`, `ボタンなし`). The word may be misspelt (T3's rule; "no
  buttoms"). A node with no `negative` option cannot be negated in text: it is asked (`negated`),
  and so is a quantity with a negator anywhere.
- **A negator that no rule placed still blocks.** When a T1–T3 reading's words share a stretch with
  a negator that is not one of those words — "knapper er ikke nødvendigt" ("buttons are not
  needed"), where `ikke` is followed by another word and so negates neither by the rule above — the
  reading is not applied: it is asked (`negated`). A double negative ("not later") is asked the
  same way.
- **A negator is a word that negates, not a character inside one.** Chinese `不` alone is in too
  many ordinary words (`按钮不错` is "the buttons are nice"), so the Chinese list holds the words
  it makes — `不要`, `不用`, `不需要`, `不是`, `不必`, `不想` — rather than `不` itself.
- **Two misses in a row → shopping-list mode.** After two consecutive T8 outcomes, the next node
  is not another open question: every sibling in the group is shown as a categorised visual menu.
- **One press undoes any reading**, whatever its tier.
- **Input longer than 500 characters** is not a phrase: it is asked (`too-long`). A pasted list is
  S6's T6.

## Aliases: `aliases.json`

Built-in aliases ship as `packages/shared/src/interpret/aliases/<language>.json` — every card's
own label and the other ways people say it, 2 295 in all. Learned aliases are the organisation's
(`builder_aliases`, one row each; the desktop's is its own install), and are exported and imported
as a file of exactly the same shape:

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
| `notes` | free text, for the person maintaining the file; a built-in label's says so |

- **Provenance is a field, never a comment.** The file is JSON: no comments, keys in the order
  above, entries sorted by `locale`, `nodeId`, `optionId`, `phrase` (code-point order), two-space
  indentation — so a diff of an exported file is readable and the same aliases always produce the
  same bytes (`formatAliasFile`; every shipped file is exactly its own bytes, tested).
- **Schema-validated on load** (Zod). A malformed file never bricks the builder: on import it is
  refused with the first error shown; on the desktop, a hand-edited file that no longer parses is
  moved aside as `aliases.invalid-<date>.json`, the built-ins are used, and a notice offers
  **Reset to defaults**.
- **Checked against the graph** (`aliasProblems`, run by `pnpm builder:validate` and by
  `interpret/data.test.ts`): every entry names a node and an option that exist; within a node no
  two options share a way of being said and no alias is another option's id (either would make T0
  ambiguous); and **every option can be typed in every language**. `apps/forms` holds the files to
  the catalogues: each card's label, typed, reads as that card at T0, in all twelve.
- **Consent, always.** Nothing is captured without the "Remember" press, which shows the exact
  phrase it will store. A phrase can contain a name; storing it is the person's choice, and an
  administrator can list, delete and export every learned alias.
- **Learned never overrides built-in.** An alias that already means a different option (built-in
  or learned) is refused, and the dialog says which option it already means. A learned alias never
  shadows an option id (T0).
- **Import shows a diff** — added, already present, refused and why — and adds nothing until
  confirmed (`CLAUDE.md` rule 7).

## No generated index

This section once specified `pnpm interpret:index`: a committed `index.generated.json` of T3's
trigram postings and T2's keyword weights, regenerated and compared by a freshness test. S3 builds
neither, for three reasons.

- **The weights needed a build step only to keep `Math.log` out of the runtime.** An integer
  logarithm (`lnMille`) does that exactly, in every engine, with nothing to regenerate or keep
  fresh — and learned aliases (S6) change every keyword's `df`, so the weights must be computable
  at runtime anyway.
- **A trigram candidate filter would narrow T3's rule.** Two words six letters long can be two
  edits apart and share no trigram (`abcdef`, `axcdxf`): a postings list would silently drop the
  Levenshtein half of the rule unless a second index was built beside it.
- **There is nothing to speed up.** T3 compares the input with one node's vocabulary — tens of
  words — and the English table runs far inside the 20 000-comparison budget, which stays as the
  hard cap. T7 (S6) ranks a group, a few nodes; that is still hundreds of words, not thousands.

The vocabulary — each option's aliases normalised, the weights — is built once per graph and
language and cached (`interpret/vocabulary.ts`), in a fixed order: options as the graph declares
them, aliases by phrase. The same aliases in any order give the same vocabulary.

## Tests

- **Phrase tables** per language, as data: `fixtures/ladder/<language>.json`, each row
  `{ "phrase", "nodeId" | "pattern", "expect", "note"? }` where `expect` is
  `{ "optionId", "tier" }`, `{ "value", "tier": "T4" }`, `{ "ask": <reason> }`, or, for a pattern
  that must find nothing, `{ "none": true }`. At least ten rows per tier per shipped language for
  T0–T4 in S3 (T3 is not a tier Chinese and Japanese can reach), and for T5–T7 in S6
  (`interpret/ladder.test.ts` counts them).
- **Must-not-resolve rows**, same files, with the reason they ask: vague quantities, negations of
  nodes without a `negative` option, stray negators, nonsense, two numbers, a number out of range,
  and phrases one edit away from two different options ("heater", `nebereinander`, `carrees`).
- **Determinism**: every row of every table read twice, and with the alias entries shuffled and
  reversed, gives byte-identical output.
- **Budget**: no row of the English table is decided by the budget; a pathological input spends
  it, the same way every time, and asks.
- **The pieces**: normalisation's spans through NFKC (`text.test.ts`), `lnMille` against the true
  value for every `p ≥ q ≤ 400` (`ln.test.ts`), the fuzzy fractions against their floating-point
  definitions (`fuzzy.test.ts`), each pattern's edges (`patterns.test.ts`), each alias rule
  catching its mistake and each word list's shape (`data.test.ts`).

Changing an alias, a word list or a threshold is a behaviour change: it needs a row in these tables
in the same commit (`CLAUDE.md`, "Guided Builder & Import").

## What S3 changed in this document

Building the rungs as code, and writing 880 phrase-table rows against them, found seven places
where the text above, as first written, would have read confidently and wrongly, asked needlessly,
or could not be built as written. Each is fixed here and locked by rows:

1. **T2 summed an option's weights over all its aliases**, so an option with more ways of being
   said was harder to reach. Scores are per alias; an option's score is its best alias's. T2's
   confidence is capped at 850, below T1's.
2. **Negation only looked forward**, so "knappar behövs inte" read as *yes*. A negator ending its
   stretch also looks back; contrast words end a stretch.
3. **A negator the rules left alone was just another word**, so "knapper er ikke nødvendigt" read
   as *yes*. It now blocks the reading.
4. **Order-free T1 made "yes buttons no text" mean "no buttons".** Aliases with a negator match in
   their own order, and T1's tie-break compares everything that points at each option.
5. **Chinese `不` as a negator** made "the buttons are nice" mean "no buttons".
6. **Two options matching in T1 was always ambiguous**, so "det krävs inte" was asked. The option
   whose words include the other's wins.
7. **The generated index** — see "No generated index".
8. **Smaller**: punctuation is anything but a letter, digit or mark; digits split from letters;
   number words are per-language files, not one `numbers.json`; the contract gained `ask`'s reason
   and lost what only S6 needs; T4's patterns say exactly what they accept.
