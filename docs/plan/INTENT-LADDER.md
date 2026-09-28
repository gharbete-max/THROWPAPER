# The intent ladder — free text, read by rules

**Status:** the specification for slices S3 (T0–T4) and S6 (T5–T8), both built —
`packages/shared/src/interpret/`. Proposed 2026-09-25; brought up to date with S3 on 2026-09-26
and with S6 on 2026-09-28 (the changes are listed at the end). Decisions: ADR 0019 (deterministic
ladder), ADR 0021 (JSON data, never YAML).

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
  aliases?: AliasEntry[];         // the built-in aliases by default; the shell adds the organisation's
  state?: GuardState;             // the conversation as guards read it: T6 and T7 offer only
                                  // questions the conversation could ask now
}

interface Reading {
  nodeId: string;                 // the node asked — or, for T5, T6 and T7, another of its group
  optionId: string | null;        // null for a quantity or a list
  value: Json | null;             // the quantity, or the list's labels (T6)
  confidence: number;             // integer per mille, 0–1000
  tier: 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';
  evidenceSpan: [number, number]; // UTF-16 offsets into the input as typed
  alternatives: { nodeId: string; optionId: string | null; confidence: number }[];  // ≤ 3
}

type AskReason =
  | 'nothing' | 'ambiguous' | 'negated' | 'vague' | 'out-of-range'
  | 'budget' | 'too-long' | 'not-readable';

type Interpretation =
  | { outcome: 'apply'; reading: Reading }                        // T0–T4, T6: a step
  | { outcome: 'fill'; readings: Reading[];                      // T5: a step per answer, in the
      unused: { span: [number, number]; why: 'nothing' | 'conflict' }[] }   // graph's order
  | { outcome: 'guess'; reading: Reading }                        // T7: confirmed before anything
  | { outcome: 'ask'; reason: AskReason; options: Reading[];      // T8: a visual menu, and
      elsewhere: Alternative[] };                                 // T7's other questions beside it

function interpret(input: string, ctx: InterpretContext): Interpretation;   // pure
function toAnswer(graph: BuilderGraph, reading: Reading): Answer;           // for the machine
```

`ask` says why, so the shell can say it: "I didn't understand", "Which one?", "Between 2 and
12", "How many exactly?". Its `options` are the node's own options, most likely first (tier T8);
`elsewhere` names up to three other questions of the group the words may have been about (T7).
`not-readable` is for a node whose free text is not read: a text entry's text *is* its answer, and
previews and menus are answered by pressing.

Every applied reading becomes an ordinary entry in the patch log with its `tier` (`toAnswer`, then
the machine's `fill`, which answers the node it names — in its turn, or ahead of it), so it is
undone like any answer, and the UI shows a transparency chip under the node: *"read that as
'several answers allowed' — change"*. Pressing **change** undoes what the words did — every step
of a T5 sentence — and puts them back in the box.

**The order** (`ladder.ts`): T0 on the node asked; then T5; then T6; then T1–T4 on the node asked;
then T7; then T8. A sentence that says two things is read as two before T2 can read it as one, and
a list before T4 counts the numbers in it.

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

**T5 — several answers in one sentence** (`ladder.ts`, `clauses.ts`). "three buttons, pill
shape, side by side". The input is cut into clauses at `, ; : . ! ?`, their CJK forms, line breaks
and the language's conjunctions (`conjunctions` in each word list: `and`, `och`, `og`, `und`, `et`,
`y`/`e`, `ja`, `和`, `と`, `и`); a conjunction written without spaces cuts only where it cannot be
part of a word — Japanese `と` after hiragana is inside one (`ひとつ`). Each clause is read by
T0–T4 against every question of **the group from here on** (`aheadOf`: the node asked and every
node of its group the conversation can go on to from it — never one behind it, which answering
again would change unseen). A question is answered only when every clause that answers it at ≥ 720
says the same — **all or nothing per question** — and T5 applies when **two or more** are; one
answer for another question is T7's. A clause may answer several ("three buttons": how many, and
buttons at all). Two rules keep T5 from reading more than was said: **a misspelling is read only
for the question asked** (another is answered by T0–T2 or T4, never T3), and **one word backs one
answer** (readings whose evidence overlaps keep the surest; the graph's order between equals).
Clauses that answer nothing are shown back, with why: read as nothing, or contradicted ("pill,
square" names two shapes).

Each answer is **its own step**, in the graph's order (the machine's `fill`): one for the node the
conversation is at is answered in its turn, and moves it on; the rest are answered **ahead of their
turn** (`answerAt`) and **mark their slot decided** for the question in focus, so the conversation
passes them by when it gets there (rule G14, `BUILDER-GRAPH.md`). The conversation stays at the
first question the sentence did not answer. Back undoes one answer at a time, last first; the
chip's **change** undoes the sentence. An answer the machine refuses — a question it cannot ask
now, like a shape for buttons nobody wants — is left out and shown back as unused.

**T6 — a list is the options** (`list.ts`). Two or more items become the options of the question
that takes them (`takesList`: a quantity whose patch makes options, "How many options?") — the
node asked, or the one ahead of it in the group when the conversation could ask it now. **The
labels verbatim, the count preserved**; a count the question does not allow is asked, never cut.
Several lines — typed, or pasted into the box, which keeps them — are read the way the importer
reads a paste: through the paste layout (`@tp/shared/import`'s `pasteDocument`) and the list-number
detector, so `1. Röd` and `• Red` lose their markers exactly as in a pasted document, and a line
without one is an item as it stands; a nested list is not a set of options. One line is cut at
`;` when it has one — so "3,50 kr; 4,50 kr" keeps its commas — and otherwise at `,`, `，` and `、`.
Whitespace inside an item is layout: runs of it are one space. **A list with an item that answers a
question of the group is not a list of options** ("pill, square"): the ladder does not choose
between the two readings — though a number inside an item ("Group 2", `星期二`) is part of its
words. A list may be 2 000 characters (`MAX_LIST`); anything else longer than 500 is asked.

**T7 — another question of the group** (`ladder.ts`). When nothing fits the question asked (its
reading asks `nothing`), every question of the group from here on that the conversation could ask
now, and could answer ahead of its turn (it settles a slot), is scored: the best T1, T2 or T3 score
of its options — T4's for a number (850 whole, 750 in a phrase) — plus a path prior (**+200** for
the node `next` leads to, **+100** for the others). **If the top is ≥ 600 and the runner-up ≥ 150
below it**, and no two of its options tie, it is a **guess** — "Did you mean “What shape?” —
Pill?" — and nothing happens until it is answered: **Yes** answers that question ahead of its turn,
**No** shows this question's own options. Otherwise up to three are offered beside the menu, as
questions to go to. A sentence with a negator in it is not guessed about at all: what it negates
is the question asked.

**T8 — ask, then learn.** Always safe: the node's own options as a menu (3–6), with T7's questions
beside it. When the person picks one, Loppa offers **"Remember “blabla” as a way to say “Pill”?"**
— only when storing it could work (1–80 characters, an option, not already meaning anything:
`aliasRefusal`) — and only the press stores it, exactly as shown. **Two misses in a row** — two
asks without an answer between — and the conversation opens the group's full list instead of a
third open question.

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
- **Two misses in a row → shopping-list mode.** After two consecutive T8 outcomes, the screen stops
  asking an open question: every question of the group is listed to pick from (the node's way out,
  opened).
- **One press undoes any reading**, whatever its tier.
- **Input longer than 500 characters** is not a phrase: it is asked (`too-long`) — unless it is a
  list (T6), up to 2 000.
- **A numeral inside a word that counts nothing is not a number.** `四角` is "square", `十分`
  "very", `星期二` "Tuesday": each language's `notNumbers` list names such words (Chinese and
  Japanese; elsewhere a number word is a word of its own), and the quantity reader skips them.

## Aliases: `aliases.json`

Built-in aliases ship as `packages/shared/src/interpret/aliases/<language>.json` — every card's
own label and the other ways people say it, 2 400 in all. Learned aliases are the organisation's
(`builder_aliases`, migration 0020, one row each; the desktop's is its own install, in its embedded
database), read by the ladder with the built-in ones, and exported and imported as a file of
exactly the same shape (`/v1/builder/aliases`, `…/export`, `…/import`):

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
| `count` | how many times it was remembered — 1, and one more each time "Remember" is pressed on it again; used only to order the admin list |
| `notes` | free text, for the person maintaining the file; a built-in label's says so |

- **Provenance is a field, never a comment.** The file is JSON: no comments, keys in the order
  above, entries sorted by `locale`, `nodeId`, `optionId`, `phrase` (code-point order), two-space
  indentation — so a diff of an exported file is readable and the same aliases always produce the
  same bytes (`formatAliasFile`; every shipped file is exactly its own bytes, tested).
- **Schema-validated on load** (Zod). A malformed file never bricks the builder: on import it is
  refused with its first problem shown, and nothing is stored. Learned aliases live in the
  database, on the desktop too — there is no hand-edited file to go bad — and **Remove all** (an
  administrator's, after a confirmation) is the way back to the built-in ones.
- **Checked against the graph** (`aliasProblems`, run by `pnpm builder:validate` and by
  `interpret/data.test.ts`): every entry names a node and an option that exist; within a node no
  two options share a way of being said and no alias is another option's id (either would make T0
  ambiguous); and **every option can be typed in every language**. `apps/forms` holds the files to
  the catalogues: each card's label, typed, reads as that card at T0, in all twelve.
- **Consent, always.** Nothing is captured without the "Remember" press, which shows the exact
  phrase it will store. A phrase can contain a name; storing it is the person's choice, the row
  records no person and no time — a date only — and an administrator can list, delete and export
  every learned alias ("Learned phrases", from the forms list).
- **Learned never overrides built-in.** An alias that already means a different option (built-in
  or learned) is refused, and the screen says which option it already means (`aliasRefusal`). A
  learned alias never shadows an option id (T0). One row per way of saying something, per language
  and question, is the database's unique index, so two people remembering one phrase at once store
  it once.
- **Import shows a diff** — added, already present, refused and why (`aliasImportDiff`) — and adds
  nothing until confirmed (`CLAUDE.md` rule 7). A file that says one phrase two ways adds the first
  and refuses the second.

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
  `{ "optionId", "tier" }`, `{ "value", "tier": "T4" }`, `{ "fill": [answers…], "unused"?,
  "tier": "T5" }`, `{ "list": [labels…], "at"?, "tier": "T6" }`, `{ "guess": answer, "tier": "T7" }`,
  `{ "ask": <reason>, "elsewhere"?: [questions…] }`, or, for a pattern that must find nothing,
  `{ "none": true }`. At least ten rows per tier per shipped language for T0–T7 (T3 is not a tier
  Chinese and Japanese can reach; `interpret/ladder.test.ts` counts them) — 1 332 rows in all
  since S6.
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
  catching its mistake and each word list's shape (`data.test.ts`); where a sentence is cut, how a
  list is read, what the conversation's state hides, and what may be learned (`group.test.ts`); the
  paste layout against the IR validator (`import/paste.test.ts`).

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

## What S6 changed in this document

Building T5–T8, and writing 427 phrase-table rows against them, found where the text above, as
first written, would have read more than was said — or could not be built as written:

1. **T5 read the whole group**, so "buttons" typed at "What shape?" would have answered "Do you want
   buttons?" again — and reset "several answers" to one. It reads the group **from here on**.
2. **One word answered two questions**: "keine Knöpfe" was no buttons and, read as "eine", one
   answer. One word backs one answer (`CAVEATS.md` #79).
3. **A misspelling was read for every question**: "tumma tausta" chose a logo place. Only the
   question asked is read fuzzily (#80).
4. **T5 on one answer** would have answered another question ahead of its turn without asking.
   T5 needs two; one is T7's guess.
5. **Answering ahead needed somewhere to be remembered**, or the conversation would ask again: the
   slot is marked decided, the node's own guard passes it by, and graph version 3 gives every node
   that can be answered ahead a `slot` its guard reads (G14, #83). A jump to it still asks it (#84),
   and Back returns to where the conversation was (#85).
6. **T6 blocked on T5's clauses**, which cut "3,50 kr" at its comma: it checks its own items, and
   an item blocks only when it *is* an answer, not when a number is inside it (#82).
7. **Numerals inside words were numbers** — 四角 made four options — an S3 defect the new rows
   found: `notNumbers` (#81).
8. **T7 guessed questions the conversation could not ask**, or answer: its candidates are live and
   settle a slot, a number is one (T4), a negator stops it, and a guess is confirmed before anything
   happens.
9. **Learned aliases**: `count` is how often a phrase was remembered, not matched — counting
   matches would write on every typed answer for a number that only orders a list; the desktop
   keeps them in its database, so "a hand-edited file" and its recovery became **Remove all**.
10. **The paste layout** is built in the core, not in `apps/forms/src/screens/builder/paper/`: a
    string is not a file's bytes, and T6 must read a pasted list the way the importer does
    (`IMPORT-PIPELINE.md`, stage 1).
