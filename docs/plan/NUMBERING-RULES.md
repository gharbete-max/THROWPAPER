# Numbering rules — the decision procedure for list markers

**Status:** the specification for slice S1b (`ROADMAP.md`), proposed 2026-09-25. **This is not
prose about numbering; it is the algorithm.** Two engineers implementing from this document alone
must produce detectors that give byte-identical output on every fixture in `fixtures/numbering/`.
If a sentence here can be read two ways, that is a bug in this document — fix the sentence and add
the fixture that would have caught it.

**Input:** a `LayoutDocument` (`LAYOUT-IR.md`). **Output:** an `EnumerateResult` (below). No other
input exists: no locale setting, no options, no clock, no randomness.

**Checked against its fixtures before it was merged.** When this document was written, it was also
implemented once, literally and from this text alone, as a throwaway script outside the repository;
that implementation reproduced every expected output in `fixtures/numbering/` for the enumerate
stage (20 fixtures). The one disagreement it found — a fixture expecting `2026.` to be vetoed,
when the grammar never matches a four-digit number at all — was a mistake in the fixture, and was
fixed there. S1b's implementation must pass the same fixtures; that is the test of this document.

## 1. What it produces

```ts
export type Family = 'arabic' | 'roman-lower' | 'roman-upper' | 'alpha-lower' | 'alpha-upper' | 'bullet';
export type Style = 'dot' | 'paren' | 'colon' | 'enclosed' | 'spaced-dot' | 'spaced-dash' | 'glyph';
export type Verdict = 'accept' | 'accept-flagged' | 'candidate' | 'inline-text';
export type Flag =
  | 'orphan-subnumber'
  | 'restart-without-boundary'
  | 'scheme-inconsistent'
  | 'sequence-jump'
  | 'single-item'
  | 'starts-mid-sequence'
  | 'style-inconsistent';

export interface Marker {
  /** Verbatim: the first word's text, or the first two words joined by one space (spaced styles). */
  raw: string;
  family: Family;
  style: Style;
  /** "12.1" → [12, 1]; "iv." → [4]; "c)" → [3]; a bullet → []. */
  path: number[];
  /** How many words at the start of the line the marker occupies: 2 for spaced styles, else 1. */
  wordCount: 1 | 2;
}

export interface Item {
  /** "i-" + the id of the item's first line. */
  id: string;
  /** "r-" + the id of the first line of the run's first item. */
  runId: string;
  /** The marker line, then every line of the label (P3 continuations, or the P4 label line). */
  lineIds: string[];
  /** Hard-broken lines under the item at its text indent (J1). Not part of the label. */
  detailLineIds: string[];
  marker: Marker;
  /** 1 = outermost. */
  level: number;
  parentId: string | null;
  /** Verbatim text after the marker; continuation lines appended with one space each. */
  label: string;
  verdict: Exclude<Verdict, 'inline-text'>;
  /** Sorted ascending (code-point order), no duplicates. */
  flags: Flag[];
  decidedBy: 'D1' | 'D2' | 'D3';
}

/** A line that looked like it started with a marker and was ruled out, and the rule that did it. */
export interface Rejected {
  lineId: string;
  raw: string;
  rule: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'P4' | 'D4';
}

export interface EnumerateResult {
  /** In reading order of their first line. */
  items: Item[];
  /** In reading order. */
  rejected: Rejected[];
  /** Every read line that is in no item's lineIds or detailLineIds, in reading order. */
  proseLineIds: string[];
  /** Lines in blocks the detector does not read (P2), in reading order. */
  skippedLineIds: string[];
}
```

`inline-text` is the verdict for everything in `rejected` and for every line in `proseLineIds`; it
never appears on an `Item`.

## 2. Constants

Every tolerance is an integer comparison. `w` is the width of the column region of the line being
decided (`column.x1 − column.x0`); `relX(L) = L.box.x0 − column.x0` for the line's own column.

| Name | Rule | Meaning |
| --- | --- | --- |
| `SAME_BAND(a, b)` | `\|a − b\| × 50 ≤ w` | two relX values are the same indent: within 2% of the column width |
| `WRAPPED(P)` | `(P.box.x1 − column.x0) × 10 ≥ w × 9` | line P reaches 90% of the column width: it was wrapped by the layout |
| `HANGING_GAP(L)` | `words[k].box.x0 − words[k−1].box.x1 ≥ L.fontSize`, k = marker word count | at least one em between the marker and its text: a tab, not a space |
| `MAX_ARABIC` | 199 | a first component above this is not a list number |
| `MAX_SUB` | 99 | a later component of a dotted path has at most two digits |
| `MAX_DEPTH` | 4 | a dotted path has at most four components |
| `ROMAN_MAX` | 39 | roman numerals i–xxxix only (so the only single-letter romans are i, v, x) |
| `CONT_MAX` | 60 | a continuation notice is at most 60 code points long (probe) |

## 3. The pass

The detector makes **one pass** over the document's lines in reading order (`LAYOUT-IR.md`,
"Reading order"), then **one post-pass** over the runs it built. Each line is handled by the first
of these steps that claims it.

```
for each page, each block, each line L:
  if block.role ∈ {page-furniture, footnote, table}:   → P2: skipped
  if L was consumed as a P4 label line:                 → already placed; continue
  if P3 claims L:                                       → continuation; continue
  m = GRAMMAR(L)                                        (§4)
  if m and a veto (§5) fires:                           → rejected; handle L as a non-marker line (§7)
  else if m and P4 fails:                               → rejected; handle L as a non-marker line (§7)
  else if m:                                            → PLACE(L, m) (§6); openItem = that item
  else:                                                 → handle L as a non-marker line (§7)
post-pass: VERDICTS (§8)
```

State carried through the pass: `S`, the stack of open runs (outermost first); `openItem`, the
last item placed or null; every item placed so far, in order.

### P1 — markers are only ever at the start of a line

`GRAMMAR` looks at the line's **first word** (first two for spaced styles) and nothing else. A
token that would match the grammar anywhere else in the line is never tested, never rejected, and
stays in the label verbatim. **Fixture:** `dotted-subnumber-mid-sentence` — `1. A thing 12.1
mentions blabla` is one item whose label is `A thing 12.1 mentions blabla`.

### P2 — furniture, footnotes and tables are not read

Lines in blocks whose role is `page-furniture`, `footnote` or `table` go to `skippedLineIds` and
have no effect on any run. **Fixture:** `page-break-continuation`.

### P3 — a soft-wrapped line is never a marker line

Applies only when `L.source` is `text-layer` or `ocr` (docx and paste have no soft wraps —
`LAYOUT-IR.md`), when `L` has a predecessor `P` in the **same block**, and when `WRAPPED(P)`.

- **P3a — hanging text.** If `P` belongs to an item's label (its marker line or a continuation)
  and `SAME_BAND(relX(L), textX(item))`, `L` continues that label. `GRAMMAR` is not run on `L`.
  `textX(item)` is the relX of the first label word on the marker line (for a P4 item, of the
  label line). **Fixture:** `dotted-subnumber-mid-sentence--wrapped`.
- **P3b — wrapped back to the start.** Else, if `relX(L) × 50 ≤ relX(P) × 50 + w` (L starts at or
  left of `P`'s start, within tolerance), `L` continues whatever `P` belongs to (the item's label,
  an item's detail line, or prose) — **unless** `GRAMMAR(L)` matches, no veto fires, and one of its
  readings would be placed by R1 (it continues an open run at its band with an expected value), in
  which case P3 does not claim `L`. **Fixture:** `dotted-subnumber-mid-sentence--flush`.
- Otherwise P3 does not claim `L`.

A line claimed by P3 joins exactly what `P` belongs to: appended to `item.lineIds` and to the
label (one space, then `L.text`) if `P` is part of a label; appended to `detailLineIds` if `P` is a
detail line; prose if `P` is prose.

### P4 — a marker needs a label

If the marker occupies every word of the line (`words.length == wordCount`), the label is the
**next line in the same block**, provided that line exists and `GRAMMAR` does not match it; it is
consumed (added to `lineIds`; the label is its whole `text`). Otherwise the line goes to `rejected`
with rule `P4`. Checked after the vetoes. **Fixture:** `marker-on-own-line`.

## 4. The grammar

`probe(s)` is used for matching and is never stored or output:

1. NFKC normalisation (full-width digits and punctuation become ASCII: `３）` → `3)`).
2. U+2018 U+2019 U+201A U+201B U+2032 → `'`; U+201C U+201D U+201E U+2033 → `"`.
3. U+2010–U+2015 and U+2212 → `-`.
4. U+00A0 U+2007 U+202F → U+0020.

Let `W1 = probe(words[0].text)` and `W2 = probe(words[1].text)` (when there is a second word). The
productions are tried **in this order**; the first match wins:

| Id | Production | Family | Style | Path | Words |
| --- | --- | --- | --- | --- | --- |
| M9 | `W1` is one of `•` `◦` `▪` `‣` `∙` `·` `*` `-` | bullet | glyph | `[]` | 1 |
| M8 | `W1` matches `^\d{1,3}$` and `W2` is `.` or `-` | arabic | spaced-dot / spaced-dash | `[n]` | 2 |
| M4 | `W1` matches `^\d{1,3}(\.\d{1,2}){1,3}\.?$` | arabic | dot | `[n, m, …]` | 1 |
| M1 | `W1` matches `^\d{1,3}\.$` | arabic | dot | `[n]` | 1 |
| M2 | `W1` matches `^\d{1,3}\)$` | arabic | paren | `[n]` | 1 |
| M3 | `W1` matches `^\d{1,3}:$` | arabic | colon | `[n]` | 1 |
| M5 | `W1` matches `^\((\d{1,3}\|[a-z]\|[A-Z]\|[ivx]{2,6}\|[IVX]{2,6})\)$` | by content | enclosed | by content | 1 |
| M7 | `W1` matches `^([ivx]{2,6}\|[IVX]{2,6})[.)]$` and is a canonical roman numeral 1–39 | roman-lower / roman-upper | dot / paren | `[value]` | 1 |
| M6 | `W1` matches `^[a-zA-Z][.)]$` | alpha (and roman, see R10) | dot / paren | `[letter index]` | 1 |

- A match additionally requires that nothing in `W1` is left over: the whole first word is the
  marker. `1.Namn` is one word and matches nothing (`CAVEATS.md`, known unknowns: `glued-marker`).
- "By content" for M5: digits → arabic `[n]`; one letter → as M6 (with R10's two readings for i, v,
  x); two or more roman letters → as M7, and no match if not canonical or above 39.
- A canonical roman numeral is one produced by the standard subtractive form (`iv`, not `iiii`).
- The letter index is a=1 … z=26, case-insensitive; the family's case is the letter's case.
- **Single letters i, v, x (and I, V, X) have two readings**: roman [1], [5], [10] and alpha [9],
  [22], [24]. Every other single letter has only its alpha reading. R10 chooses.
- Why `§ 4.2`, `no. 12.1`, `version 2.0`, `1st`, `3:e`, `(the form)` and `(3 500 kr)` never match:
  their first word is `§`, `no.`, `version`, `1st`, `3:e`, `(the` and `(3` respectively, and none
  of those is a production. That is the whole mechanism; there is no special case for them.
  **Fixtures:** `decimal-not-marker`, `ordinal-not-marker`, `parenthesised-number`.
- Quotes and full-width forms are folded by `probe`, so `“1.”` is `"1."` — a first word that is
  not a production — and `3）` is `3)`, which is M2. **Fixture:**
  `ligature-and-quote-repair--marker`.

The marker's `raw` is the first word's `text` verbatim (spaced styles: the first two words' texts
joined by one space). The label starts at `words[wordCount].start` and runs to the end of the line.

## 5. Vetoes

A matched marker is rejected (verdict `inline-text`, recorded in `rejected`) by the **first** of
these that fires. `F` is the first label word (`words[wordCount]`), `f` is `probe(F.text)` lower-cased
with trailing `. , ; : ! ? )` removed. Vetoes that name `F` do not fire when there is no `F`.

| Id | Fires when | Why | Fixture |
| --- | --- | --- | --- |
| V1 | production M4 and `F.text` starts with a lower-case letter (`\p{Ll}`) | a decimal opening a sentence: "3.5 miljoner kronor …", "12.1 i avtalet …" | `decimal-not-marker` |
| V2 | family arabic and `f` is in `UNIT_WORDS` (§9) | a quantity with its unit: "3.5 Millionen Euro" | `decimal-not-marker` |
| V3 | family arabic, style `dot` or `spaced-dot`, and `f` is in `MONTHS` (§9) | a Nordic or German ordinal date: "1. mai", "1. Mai" | `ordinal-not-marker` |
| V4 | family arabic and `path[0] > 199` | a number that ended a sentence on the line before: "250. Anmäl dig i tid." (A four-digit year such as "2026." never gets this far: the productions allow three digits.) | `decimal-not-marker` |
| V5 | style `spaced-dash` and `F.text` starts with a digit | a range: "1 - 3 dagar" | `nordic-numbering` |

**Resolved conflict, `CAVEATS.md` #2 against #3.** A dotted number at the start of a line is a
sub-item (#2) or a decimal in prose (#3). V1 and V2 decide it: a lower-case word or a unit after
it means prose; anything else goes to the run logic, where R9 applies #2.

## 6. Placing a marker: runs

A **run** is one list at one indent. Fields: `id`; `family`; `style` (of its first item);
`relX` (of its first item's line); `level`; `parent` (an item or null); `firstPath`; `lastPath`;
`items`; `flags`.

`expectedNext(r)`, with `p = r.lastPath`:

- `bullet`: `{[]}` (any bullet continues a bullet run).
- `roman-*`, `alpha-*`: `{[p[0] + 1]}`.
- `arabic`: for each depth `d` from 1 to `len(p)`, `p[0..d−1]` with its last component plus one
  (a sibling at that depth); plus `p ++ [1]` (a first child) when `len(p) < 4`. For `[1, 2]` that
  is `{[2], [1, 3], [1, 2, 1]}`.

`isFirst(reading, parent)` is true when: bullet; or roman/alpha and `path = [1]`; or arabic and
`path = [1]`; or arabic and `parent` is an arabic item and `path = parent.path ++ [1]`.

**R10 — which reading of i, v, x.** Wherever a step below says "a reading", it tries the readings
in the order roman, then alpha, and the first that satisfies that step wins. Where a step says
"the preferred reading", it is roman for `i` / `I` and alpha for `v`, `x`, `V`, `X`; an
unambiguous marker has only one reading. **Fixtures:** `sequence-continuity` (`c)` after `b)`),
`scheme-change-same-indent` (`i.` after `3.`).

`PLACE(L, m)`, with `x = relX(L)`:

1. **R1 — continue a run.** For each run `r` in `S` from innermost to outermost with
   `SAME_BAND(r.relX, x)`: if a reading has `r`'s family and its path is in `expectedNext(r)`,
   close (pop) every run deeper than `r`, APPEND to `r`, done. **Fixtures:** every accepted list.
2. Otherwise, if some run in `S` has `SAME_BAND(r.relX, x)`, let `r` be the innermost such run,
   close every run deeper than it, and take the preferred reading:
   - **R5a — a different scheme that restarts nests.** Family differs from `r.family` and
     `isFirst(reading, r's last item)`: push a new run at `r.level + 1` whose parent is `r`'s last
     item, APPEND. **Fixture:** `scheme-change-same-indent` (1, 2, 3, then i, ii).
   - **R5b — a different scheme that does not restart joins, flagged.** Family differs and not
     first: APPEND to `r` and add `scheme-inconsistent` to `r.flags`. **Fixture:**
     `scheme-change-same-indent` (1, 2, iii, 4).
   - **R7 — the same scheme restarting without a boundary.** Same family and `isFirst`: close
     `r`, push a new run at `r.level` with `r`'s parent and the flag `restart-without-boundary`,
     APPEND. **Fixture:** `counter-reset-on-heading` (part three).
   - **R4 — a jump.** Same family, not first, not expected: APPEND to `r` and add
     `sequence-jump` to `r.flags`. The whole run is demoted (D2). **Fixture:**
     `sequence-continuity` (1, 2, 12.1, 3).
3. Otherwise (no run at this band):
   - **R3 — an indent to the left closes what is to its right.** Close every run with
     `(r.relX − x) × 50 > w`.
   - **R2 — an indent to the right nests.** If `S` is still non-empty, push a new run at
     `innermost.level + 1` whose parent is the innermost run's last item; else push a new run at
     level 1 with no parent. **Fixtures:** `nested-by-indent` (R2), `counter-reset-on-heading`
     part four (R3).
   - If the preferred reading is not `isFirst` for that parent:
     - **R9 — a dotted sub-number finds its parent.** Arabic with `len(path) ≥ 2`: search every
       item placed so far, latest first, for an arabic item whose path equals `path` without its
       last component. If found and the new run has no parent, that item becomes the run's parent
       and the run's level is its level + 1. If none is found, the item gets the flag
       `orphan-subnumber`. **Fixtures:** `dotted-subnumber-line-start` (found, in the same run —
       via R1), `dotted-subnumber-line-start--orphan` (not found).
     - Otherwise the run gets the flag `starts-mid-sequence`.
   - APPEND.

`APPEND(r, L, reading)` creates the item: `runId = r.id` (a new run's id comes from this item);
`marker` from the reading; if the reading's style differs from `r.style` and its family is the
same, add `style-inconsistent` to `r.flags`; set `r.lastPath = reading.path`.

- **Level.** Arabic: `r.level + max(0, len(path) − len(r.firstPath))`. Every other family:
  `r.level`.
- **Parent.** Arabic with `len(path) ≥ 2`: the latest item in `r` whose path equals `path` without
  its last component, if there is one; otherwise `r.parent`. Every other case: `r.parent`.
- **Label.** `L.text` from the first label word to the end (P4: the label line's whole text).

**R8 — pages and columns do not end a list.** Nothing in this section looks at `pageNo` or
`columnIndex`; `relX` is measured from each line's own column. A list that runs from the foot of
page 1 (or of the left column) to the head of page 2 (or of the right column) continues through
R1. **Fixtures:** `page-break-continuation`, `two-column-order`.

## 7. Lines that are not markers

In this order:

1. **R6a — a heading resets every list.** The line is in a block whose role is `heading`: close
   every run in `S`; the line is prose; `openItem = null`. (A heading line whose first word *is*
   a marker never gets here — it was placed in §6 like any other; numbered section headings are
   list items.) **Fixture:** `counter-reset-on-heading`.
2. **V7 — continuation notices change nothing.** `probe(L.text)` is at most 60 code points and
   contains a phrase from `CONTINUATION` (§9): the line is prose, `openItem = null`, and no run is
   closed. **Fixture:** `page-break-continuation`.
3. **J1 — detail lines.** `openItem` exists, `L` is in the same block as `openItem`'s last line,
   and `SAME_BAND(relX(L), textX(openItem))`: `L` goes to `openItem.detailLineIds`. **Fixture:**
   `dotted-subnumber-line-start` (the date format under item 7).
4. **R6b — anything else is prose, and an outdent closes lists.** The line is prose; close every
   run with `(r.relX − relX(L)) × 50 > w`; `openItem = null`. **Fixture:**
   `counter-reset-on-heading` (part two).

## 8. Verdicts (the post-pass)

For each run, in the order runs were created:

1. **D4 — a lone letter with nothing to fill in is a word.** The run's family is alpha, it has
   exactly one item, and that item has no field evidence: the item is removed, its marker line
   goes to `rejected` with rule `D4`, and all its lines become prose. Any run whose parent was
   that item takes the removed item's parent, and its level and its items' levels drop by one.
   **Fixture:** `letter-vs-word` (`A. Andersson har skrivit under.`).
2. **D1 / D2 — a list of two or more.** Every item: flags = the item's own flags ∪ the run's flags.
   No flags → `accept`, `D1`. Any flag → `accept-flagged`, `D2`. **Fixtures:** D1 everywhere;
   D2 `sequence-continuity`, `scheme-change-same-indent`, `counter-reset-on-heading`.
3. **D3 — a list of one.** Exactly one item:
   - its path extends its parent's path (`dotted-subnumber-line-start`), or it has the flag
     `orphan-subnumber`: as D1/D2 (a sub-item of a real item is not a lone list; an orphan is
     accepted and flagged, `CAVEATS.md` #2);
   - otherwise, band evidence **and** field evidence → `accept` if it has no flags, else
     `accept-flagged`; `decidedBy` D3;
   - otherwise → `candidate` with the flag `single-item`; `decidedBy` D3.
   **Fixtures:** `single-item-list` (all three cases), `letter-vs-word` (`A. Namn: ________`).

**Band evidence:** `HANGING_GAP(L)` on the marker line, or `L.indentBand ≥ 1`.
**Field evidence:** on the marker line or any of its label or detail lines, `hints.blankRun`, or
`hints.checkboxes > 0`, or `hints.ruleBelow`.

Output: items sorted by the reading-order position of their first line; `flags` sorted and
de-duplicated; ids as in §1. Nothing else is sorted: every other list is already in reading order.

## 9. Gazetteers

Matched against `f` (lower-cased probe, trailing `. , ; : ! ? )` removed) as whole words.

**`UNIT_WORDS`** — magnitudes, currencies, percent and SI units. Deliberately **no time words**
(år, dagar, days, weeks): "4. Dagar du deltar" is a real label.

```
million millions millioner miljon miljoner milj mn mnkr mdkr miljard miljarder mrd billion
billions thousand thousands tusen tuhat miljoona miljoonaa milljón milljónir millón millones
millionen milliarden mio mrd. миллион миллиона миллионов тысяч тыс 万 亿
kr kronor krona kroner krónur öre øre sek nok dkk isk eur euro euros € $ usd gbp £ chf rub ₽
cny ¥ 元 jpy 円
% procent prosent prosentti prósent prozent percent pour por 百分之
km m cm mm kg g l dl cl ml
```

**`MONTHS`** — month names of the languages that write an ordinal date as `1.` (sv, da, nb, fi,
is, de), full and common abbreviations. **English, French and Spanish are left out on purpose:**
none of them writes "1. May", and English "May" opens real questions ("1. May we contact you?").

```
januari februari mars april maj juni juli augusti september oktober november december
januar februar marts august desember dezember jänner märz mai
tammikuuta helmikuuta maaliskuuta huhtikuuta toukokuuta kesäkuuta heinäkuuta elokuuta
syyskuuta lokakuuta marraskuuta joulukuuta tammikuu helmikuu maaliskuu huhtikuu toukokuu
kesäkuu heinäkuu elokuu syyskuu lokakuu marraskuu joulukuu
janúar febrúar apríl maí júní júlí ágúst október nóvember
jan feb mar apr jun jul aug sep sept okt nov dec des dez
```

**`CONTINUATION`** — phrases, matched as whole words on the lower-cased probe (CJK: as substrings):

```
en  continued on page · continued on next page · continued overleaf · continued · please turn over · turn over · p.t.o · pto
sv  fortsätter på nästa sida · fortsättning på nästa sida · forts. på nästa sida · fortsättning · forts. · vänd blad · vänd
da  fortsættes på næste side · fortsættes · vend
nb  fortsetter på neste side · fortsettelse · forts. · snu arket
fi  jatkuu seuraavalla sivulla · jatkuu · käännä
is  framhald á næstu síðu · framhald
de  fortsetzung auf der nächsten seite · fortsetzung · bitte wenden · b.w.
fr  suite page suivante · suite au verso · suite · tournez svp · voir au verso
es  continúa en la página siguiente · continúa · sigue · ver al dorso
zh  续下页 · 接下页 · 见背面
ja  次ページへ続く · 次頁に続く · 裏面へ続く · 続く
ru  продолжение на следующей странице · продолжение следует · см. на обороте
```

Adding a word to any list is a behaviour change: it needs a fixture in the same commit
(`CLAUDE.md`, "Guided Builder & Import").

## 10. The rule table

Every rule, its predicate, its verdict and the fixture that locks it. A rule with no fixture is an
opinion and fails `scripts/caveat-fixtures.test.ts`.

| Rule | Predicate (concrete) | Verdict | Fixture |
| --- | --- | --- | --- |
| P1 | only `words[0]` (and `words[1]` for M8) are tested | mid-line tokens stay in the label | `dotted-subnumber-mid-sentence` |
| P2 | block role ∈ {page-furniture, footnote, table} | skipped | `page-break-continuation` |
| P3a | text-layer/ocr, same block, `WRAPPED(P)`, `SAME_BAND(relX(L), textX)` | label continuation | `dotted-subnumber-mid-sentence--wrapped` |
| P3b | text-layer/ocr, same block, `WRAPPED(P)`, `relX(L) ≤ relX(P)` + 2%, not an R1 continuation | continuation | `dotted-subnumber-mid-sentence--flush` |
| P4 | marker is the whole line and the next line in the block is not a marker | label from next line; else rejected P4 | `marker-on-own-line` |
| M1–M9 | §4 productions, in order | a marker | M1 `scenario-s4`; M2, M3, M8 `nordic-numbering`; M4 `dotted-subnumber-line-start`; M5 `parenthesised-number`; M6 `letter-vs-word`; M7 `sequence-continuity`; M9 `bullet-list` |
| A1 | probe folds quotes, dashes, spaces, full width | matching only; output verbatim | `ligature-and-quote-repair--marker` |
| V1 | M4 and next word starts `\p{Ll}` | inline-text | `decimal-not-marker` |
| V2 | arabic and next word ∈ `UNIT_WORDS` | inline-text | `decimal-not-marker` |
| V3 | arabic, dot/spaced-dot, next word ∈ `MONTHS` | inline-text | `ordinal-not-marker` |
| V4 | arabic and `path[0] > 199` | inline-text | `decimal-not-marker` |
| V5 | spaced-dash and next word starts with a digit | inline-text | `nordic-numbering` |
| V7 | ≤ 60 code points and contains a `CONTINUATION` phrase | prose, closes nothing | `page-break-continuation` |
| R1 | same band (×50 ≤ w), same family, path ∈ `expectedNext` | appended | every accepted list |
| R2 | no run at the band, a run open to the left | nested, level + 1 | `nested-by-indent` |
| R3 | no run at the band; close runs with `(r.relX − x) × 50 > w` | closed | `counter-reset-on-heading` |
| R4 | same band, same family, not expected, not first | appended; run flagged `sequence-jump` | `sequence-continuity` |
| R5a | same band, other family, first value | nested run, level + 1 | `scheme-change-same-indent` |
| R5b | same band, other family, not first | appended; run flagged `scheme-inconsistent` | `scheme-change-same-indent` |
| R6a | line in a `heading` block, no marker | all runs closed | `counter-reset-on-heading` |
| R6b | prose line; close runs with `(r.relX − relX(L)) × 50 > w` | closed | `counter-reset-on-heading` |
| R7 | same band, same family, first value, not expected | new run flagged `restart-without-boundary` | `counter-reset-on-heading` |
| R8 | no rule reads pageNo or columnIndex | lists continue across pages and columns | `page-break-continuation`, `two-column-order` |
| R9 | dotted, not first: parent = latest item with the prefix path | nested; else flagged `orphan-subnumber` | `dotted-subnumber-line-start`, `dotted-subnumber-line-start--orphan` |
| R10 | i/v/x: readings roman then alpha; preferred roman for i only | the reading that continues | `sequence-continuity`, `scheme-change-same-indent` |
| J1 | non-marker, same block as `openItem`, `SAME_BAND(relX(L), textX)` | detail line | `dotted-subnumber-line-start` |
| D1 | run of ≥ 2, no flags | accept | every accepted list |
| D2 | run of ≥ 2 (or sub-item/orphan), any flag | accept-flagged | `sequence-continuity` |
| D3 | run of 1: band evidence and field evidence | accept; else candidate + `single-item` | `single-item-list` |
| D4 | alpha run of 1 with no field evidence | rejected, prose | `letter-vs-word` |

## 11. What this does not decide

- Whether an accepted item is a **question**, an **option** of the question above it, or an
  instruction. That is stage 4 (`IMPORT-PIPELINE.md` §4), which reads the items, their levels and
  their detail lines.
- What **kind** of answer an item wants (stage 5).
- How confident the draft is overall (stage 7). The verdicts here feed it: `accept` contributes
  full marker evidence, `accept-flagged` half, `candidate` none.
- **DOCX numbering.** When a line carries `hints.docxNumbering`, Word has already said what the
  marker is: stage 3 uses `docxNumbering.rendered` as the marker, `ilvl + 1` as the level, and the
  `numId` as the run, and none of the rules above apply to that line. The rules exist for text
  that has lost its structure, and a DOCX paragraph with numbering has not.
