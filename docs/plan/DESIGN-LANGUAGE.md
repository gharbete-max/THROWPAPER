# Design language — the guided builder

**Status:** proposed with the plan set, 2026-09-25. This is the builder's interaction and voice
guide. It sits **under** `DESIGN.md` at the repository root, which is the design system: every
colour, size, radius and duration here is one of its tokens (`var(--tp-*)`), and where the two
disagree, `DESIGN.md` wins until the owner changes it.

## One decision per screen

A node screen has, top to bottom, and nothing else:

1. **The trail** — a single line of breadcrumbs, small, muted, each one a link back.
2. **The question** — huge, one sentence, at most nine words.
3. **The answers** — two to four large cards (or a stepper, a chooser, a text box), each labelled
   by its consequence.
4. **"Or type it"** — one quiet text entry with an example.
5. **Back** and the **way out** ("Show all options"), always in the same two places.

**The primary answers never need a scrollbar.** Every node renders its answers in full at
360 × 640 CSS pixels (a small phone) — the test for `CAVEATS.md` #37. If a node cannot, it is two
nodes.

The preview moment is the one screen with more: the real control, the sentence under it, and "What
Loppa assumed". Still one decision — "is this right?".

## Type

From the existing ramp (`DESIGN.md`, "Typography": base 16, ratio 1.25) — no new sizes:

| Role | Phone | Wider than 720 px |
| --- | --- | --- |
| The question | `2xl` (31.25) | `3xl` (39.06) |
| Answer card label | `lg` (20) | `xl` (25) |
| Answer card detail, help | `ui` (14.31) | `base` (16) |
| Trail, chips, badges | `sm` (12.8) | `ui` (14.31) |
| The quantity's number | `3xl` (39.06) | `3xl` (39.06) |

Headings drop to 1.15 line height with −0.015em tracking, as everywhere. Questions wrap; they are
never truncated, in any language (`CAVEATS.md` #36).

## Motion

Motion explains where something went; it never decorates.

| What | Duration | Curve |
| --- | --- | --- |
| Moving to the next node (the old slides out, the new slides in, 24 px) | `--tp-motion-preview` (220 ms, new) | `--tp-ease-unfurl` |
| A preview changing because an answer changed | `--tp-motion-preview` (220 ms) | `--tp-ease-unfurl` |
| Colour, opacity, a chip appearing | `--tp-motion-fast` (110 ms) | `--tp-ease` |
| Going back | the forward motion reversed | the same |

- **The brief asks for 220 ms on `cubic-bezier(0.22, 1, 0.36, 1)`.** The brand handoff makes
  `unfurl` and `chomp` the only movement curves the interface may use (`packages/tokens`,
  `compile-web.ts`), and `unfurl` (`0.22, 0.75, 0.05, 1`) is the nearest. So: a new duration token,
  the brand's curve, as revision 3 of the brief settles (`BRIEF.md` §4.5). Changing the curve
  would be a change to the brand handoff, not to this guide.
- **`prefers-reduced-motion`**: nothing moves. Nodes and previews swap in place. This goes through
  the existing `useReducedMotion()` (`apps/forms/src/lib/motion.ts`), which also assumes *reduced*
  when it cannot ask.
- **No spinner under 150 ms.** Anything faster simply appears; anything slower shows a skeleton of
  the thing that is coming, never a spinner alone.

## Colour and contrast

- The builder's own chrome uses Loppa's tokens. **The preview uses the organisation's brand kit**
  (its compiled tokens, the same ones the public form gets), never Loppa's — including when there
  is no brand kit (`CAVEATS.md` #32: a preset other than `default`, or the 60-second flow).
- Choices are marked with brand **roles** (primary, secondary, accent) through `ChoiceStyle.accent`,
  never with a free colour: the role's derived edge is held to 3:1 by `locked.test.ts`.
- `prefers-contrast: more` switches the builder chrome to its high-contrast token set; a brand that
  fails the contrast guard is **reported** in the preview ("This colour is hard to read on white"),
  never silently adjusted (#35).

## Voice

Every string in the graph obeys these, and `graph.test.ts` (G10) enforces the checkable ones:

1. **Present tense, second person.** "Do you want buttons?", not "Buttons will be added".
2. **At most nine words** in a question (`en-GB`; at most twelve words in the other space-separated
   languages; at most 24 characters in `zh-CN` and `ja-JP`).
3. **One idea.** No "and" joining two questions.
4. **No jargon.** Never "input type", never "field group". Say "How should people answer this?"
5. **Answers are labelled by consequence**, not by technical name: "One answer only" / "Several
   answers allowed", not "Single select" / "Multi select".
6. **Every node has one line of help** for its "?" — what happens, not how it works.
7. **Never operative wording.** No consent, declaration, terms, safety or clinical sentence is ever
   a string in the graph or an example chip (ADR 0012, G13).

**Banned words** (whole words, case-insensitive; the list is data, `builder/graph/voice.json`, one
array per language, and a word added there is enforced everywhere at once by rule G10):

| Language | Banned in graph strings |
| --- | --- |
| en | input, input type, field, field group, form element, widget, component, control, boolean, string, integer, parameter, schema, validation, dropdown, radio, select, toggle, configure, enable, disable, invalid |
| sv | fält, fälttyp, fältgrupp, inmatning, komponent, kontroll, boolesk, parameter, schema, validering, rullgardinsmeny, alternativknapp, konfigurera, aktivera, inaktivera, ogiltig |
| the other ten | the same concepts, in `voice.json` since S1 added the graph's strings in all twelve languages. Words that mean *form* are deliberately absent: Norwegian *skjema* and Danish *skema* are the everyday word for the thing being built, not jargon |

| Instead of | Write |
| --- | --- |
| Select the input type | How should people answer this? |
| Configure validation | What counts as a good answer? |
| Single select / Multi select | One answer only / Several answers allowed |
| Set field as required | Must everyone answer this? |
| Add a field group | Ask a few things together? |
| Toggle | Yes or no |

## Fixed sentences

The brief's own sentences, used exactly, in every language's catalogue (these are exempt from the
nine-word rule, which is for questions):

| Where | English |
| --- | --- |
| Under every preview | Not completely happy with the preview? Click it to edit. (touch: "Tap it to edit.") |
| The badge | changed by hand |
| The badge's action | Revert to guided |
| Reconciliation | You changed this by hand. Keep your version, or use the guided one? — Keep mine / Use guided / Show both |
| A guessed kind | I guessed the answer type — tap to change |
| The review screen | I read {count} questions. {flagged} need your eye. |
| The "why" affordance | What Loppa assumed |
| The text entry | Or type it — e.g. "four buttons in a row" |
| Transparency chip | read that as "{option}" — change |
| The guess | This looks like {template}. Right? — Right / Sort of / No |

## Components

New, in `apps/forms/src/screens/builder/guided/` unless noted, each with no decision logic of its
own (the machine decides; these render):

| Component | Is |
| --- | --- |
| `Shell` | the full-screen conversation: trail, node, text entry, Back, way out; keyboard |
| `QuestionNode`, `Cards` | a question and its 2–4 answer cards |
| `Quantity` | the stepper, the number at `3xl` |
| `Chooser` | pick-one tiles (shapes, slots, layouts) with icons from `Icon.tsx` |
| `MultiCards` | pick-many cards and "Done" |
| `TextEntry` | one box and its example chips |
| `GuessCard` | "This looks like …" with Right / Sort of / No and "Why this guess" |
| `PreviewMoment` | `FieldInput` on the brand kit, the fixed sentence, "What Loppa assumed" |
| `InlineEdit/` | the shape handle, the size handle, the swatch row, inline text, drag grips — each snapping to schema values |
| `ChangedByHand`, `ReconcileDialog` | the badge, and the three-way question |
| `Trail`, `WhyChip`, `ReadingChip` | breadcrumbs; the "why"; the transparency chip |
| `SiblingMenu`, `ShoppingList` | the way-out grid; the categorised menu after two misses |
| `review/ReviewScreen` (+ `SourcePane`, `DraftPane`, `Chips`) | the import review (`IMPORT-PIPELINE.md` §8) |

Reused as they are: `FieldInput`, `FormPreview`, `Icon`, `Confirm`, `toast`, `ColourChoice`,
`ThemePicker`, `ImagePicker`, `CameraScan`, `PhoneScan`, `LoadFailed`, `Loading`.

## Placement slots

Logo, heading and footer go into **named slots**, never coordinates (#33). A slot is a name the
public renderer, the PDF and the email each lay out their own way:

| Slot | Is |
| --- | --- |
| `header-left` | the logo at the start of a header bar, the title beside it |
| `masthead-centred` | the logo centred above the title |
| `corner-watermark` | the logo small in the top corner, faint |
| `footer-strip` | a strip at the foot: logo, organisation name |
| `sidebar-rail` | a narrow rail beside the form on wide screens; the header on phones |
| `card-top` | the logo at the top of the card the form sits in |

A new, optional, presentation-only `FormSettings.layout: { shelf, logoSlot, footer }` holds the
choice (a `packages/shared` change, S5). A form without it renders exactly as today.

## The layout shelf

Seven whole-form layouts, chosen from a shelf of real previews:

| Layout | For | Slots it offers | On a phone |
| --- | --- | --- | --- |
| **Classic Document** | long forms read top to bottom | header-left, masthead-centred, footer-strip | a single column |
| **Card Centered** | short forms, sign-ups | card-top, masthead-centred | the card fills the width |
| **Split Panel** | a description beside the questions | sidebar-rail, header-left | the panel above |
| **Wizard Steps** | one page per section, progress shown | header-left, masthead-centred | one section per screen |
| **Print Faithful** | forms that came from paper | corner-watermark, footer-strip | the paper's order, reflowed; the paper itself in the PDF (#34) |
| **Check-in Kiosk** | a tablet at a door | masthead-centred | large targets, one question per screen |
| **Event Ticket** | admission-style confirmations | card-top, footer-strip | ticket-shaped card |

Brand-kit rules that beat the shelf (until owner question 6 says otherwise): the logo's aspect
ratio, the contrast floor and the 44 px tap target. A layout never scales a logo out of
proportion, never places text on a colour that fails contrast, and never shrinks a choice.

## Keyboard and assistive technology

| Key | Does |
| --- | --- |
| 1–9 | pick an answer (when the text entry is not focused) |
| Alt+1–9 | pick an answer, anywhere (browser) |
| ⌘/Ctrl+1–9 | pick an answer (desktop app only; browsers keep these for tabs) |
| Enter | accept the focused answer, or continue |
| Escape, ⌘/Ctrl+Z | back one step (⌘Z inside the text entry undoes typing first) |
| Backspace | back one step, only when the text entry is empty |
| ↑ ↓ ← → | move between answers, tiles, review items |
| E | edit the preview (on a preview moment) |
| ? | the help line |

- Each new node is announced through a polite live region: the question, then how many answers.
- Focus moves to the first answer on every node, and back to the answer that was chosen on Back.
- Every target is at least 44 × 44 px. No step requires a pointer, a drag or a hover: every drag
  has a keyboard twin (move up / move down) (#44).
