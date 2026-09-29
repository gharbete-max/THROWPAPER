# The guess — the belief engine (S11)

"This looks like an event registration. Right?" — brief §6, ADR 0019 point 4. This document was
S11's plan and is now its record: what the engine believes, how it chooses what to ask, when it
guesses, and what "Right" adds to the form. The code is `packages/shared/src/builder/belief/` and
`packages/shared/src/interpret/exp.ts`; the screen is `apps/forms/src/screens/builder/guided/`.
Where the build changed the plan, it says what the plan was.

## Recipes

A recipe is something the engine can guess. The recipes are the 23 `FORM_TEMPLATES`, and two that
`CLAUDE.md` rule 8 keeps out of the catalogue: `consent-form` and `incident-report`
(`belief/structures.ts`). The engine may recognise those, so nobody is asked twenty questions to
discover it, but "Right" gives them **structure and a bracketed placeholder only**, the way the
proxy template does: the operative text is the organisation's to write (ADR 0012).

`belief/recipes.json` holds each recipe's prior, in millinats, and a template's name in twelve
languages — what the guess says, which must not depend on the catalogue having loaded (`CAVEATS.md`
#121); a test holds each name to the catalogue's. The questions stay in the templates (brief §6).
Every prior is 0 but one. `event-registration`, the catalogue's
general sign-up, is +700 (about twice as likely before any answer): a person signing people up to
an event says "no" to every more particular question, and nothing else would ever set it apart.

**The catalogue is not in the engine.** The screen already has it from `GET /v1/form-templates`,
as the gallery does, and hands it to the machine when "Right" is answered
(`AnswerContext.templates`); replay never needs it, since the step holds what it added. (First
built importing `FORM_TEMPLATES`, which put every template in every language — 36 KB gzipped — into
the guided builder's chunk; `CAVEATS.md` #118. The bundle budget now fails a build with the
catalogue in it.) `belief.test.ts` holds `recipes.json` to the catalogue.

## What an answer says

A guess question's options declare `score: { [recipeId]: millinats }` in the graph
(`BUILDER-GRAPH.md`, "`score`"). A score is how much more likely a person building that recipe is
to choose that option, as a log: **P(option | recipe) = e^score / Σ e^score over the node's scored
options**. A recipe an option does not name scores 0 there, so a recipe no option of a node names
is indifferent to it: every answer is as likely for it as any other.

- **Choosing an option adds `log P(option | recipe)` to each recipe's belief.** A yes/no question
  that names recipes on both sides — "yes" for the dated ones, "no" for the rest — moves the belief
  both ways; one that names only one side can move it at most by ln 2 against the rest.
- **An option with no `score` at all is neutral** ("Not sure"): it changes nothing, and it is left
  out when the engine works out what an answer would tell it.
- **The guess's three states** are a likelihood on the guessed recipe (brief §6): Right 1.0, Sort
  of 0.5, No 0.0. So "Sort of" adds `ln ½` = −693 millinats to it, and "No" removes it: it is never
  guessed again in this conversation.

This is the one change to the brief's arithmetic: it said an answer "contributes log-odds via
score weights", which read as adding the score itself. Added unnormalised, a question's answers
could not be weighed against each other, so "which question tells us most" had no answer; the
normalised form is what makes the next section possible. `flow.start`'s scores are re-set on this
scale (graph version 5): as first set, a few hundred millinats, no recipe could ever reach 800 per
mille (`CAVEATS.md` #115).

## Integers throughout

No `Math.exp` or `Math.log` in a decision (ADR 0019, `CAVEATS.md` #50):

- `expMicro(d)` is `round(10⁶ × e^(−d/1000))` for d ≥ 0 millinats, by the same 40-digit series the
  sigmoid table was made with (`interpret/exp.ts`), and 0 from d = 16 000 on. `lnMille`
  (`interpret/ln.ts`) is the logarithm.
- A belief is a list of `{ id, millinats }` in recipe order. With `m` its largest value and
  `S = Σ expMicro(m − b)`, a recipe's probability is `expMicro(m − b) × 10⁶ / S` parts per million,
  and `pMille` is that in thousandths, rounded.
- Its entropy, in millinats, is `lnMille(S, 10⁶) + Σ p·(m − b) / 10⁶`: one logarithm, however many
  recipes.
- A log-likelihood is a whole number of millinats, so over a question's answers a recipe's
  likelihoods sum to one within 0.1%.

## Which question next

A guess question's `next` is `{ best: 'guess', else }`: the machine asks the question of group
`guess` expected to tell it most, and goes to `else` — a node, or guarded branches like any `next`
— when there is nothing worth asking. What it chose is recorded in the log like any step, so replay
needs no belief.

- **Expected gain** of a question is the belief's entropy now, less the entropy expected after
  it: each scored option weighted by how likely the person is to choose it,
  `P(option) = Σ p(recipe) × P(option | recipe)`.
- **It goes to `else`** when the guess has been confirmed; when a recipe that may be guessed is at
  800 per mille or more (`guess.confirm` then asks); after **five** questions of the group; after
  **two** of them answered "Not sure" (the person may know no more; `CAVEATS.md` #116); or when no
  unasked question would gain 50 millinats.
- Ties go to the question first in the graph.
- Rule G11 counts a chain through the best questions as five at most, whatever order they come in,
  and the guess ends a chain, as a preview does: "This looks like …" is something shown.

## The guess

After every step, the machine writes the top recipe that may be guessed into `state.guess`
(`{ templateId, pMille }`) as a change in that step, so Back and replay restore it. A recipe may not
be guessed once it has had "No", or, after "Sort of", until another guess question has been
answered. `guess.confirm` asks when `guess.pMille >= 800` and nothing has been seeded; its answer
names the recipe (`{ kind: 'guess', verdict, templateId }`), so the log alone says what was
believed.

- **Right** seeds the recipe; `guess.seeded` shows the whole form as it will look, every question of
  it editable in place (pick one, then change it as on any preview); then the brand, then "Add
  another question?" — only the gaps.
- **Sort of** keeps asking (if anything is worth asking), and the recipe may come back.
- **No** keeps asking, without it — or, when another recipe is already at 800 per mille, asks
  about that one at once. A proxy form and a power of attorney answer alike but for one question,
  so "No" to the one leaves the other at 918; first built, the conversation went on to the brand
  without offering it (`CAVEATS.md` #119). A recipe once refused is never offered again.
- **"Why this guess"** lists the three answers that moved it most, in the trail's words ("Is it for
  something on a set date? Yes"): for each answer, how much more it suits the guessed recipe than
  the others on average (`log P(option | guess)` less the mean over the rest), largest first, ties
  to the later answer; only answers that favoured it are listed.

## Over a rebase

The belief is the log's, worked out from the answers in it. A conversation carried over a draft
changed outside it — the classic editor, between two answers — begins a new log, so Back can never
undo the editor (`rebase`, `BUILDER-GRAPH.md`). So `rebase` carries what the belief was told into
the new base, under `pending.toldBefore`: each answer to a scored question and each verdict, as
which node and what was said, nothing of their changes. The machine and "Why this guess" read those
first, then the log (`toldOf`). Back from the editor mid-guess, the questions go on as they would
have; after "Right", the recipe is still confirmed. (First built without it: the questions began
again; `CAVEATS.md` #120.)

## What "Right" adds

One step (`guess.confirm`'s answer), which Back undoes:

- **A template's questions**, copied whole, every language, as the gallery copies a template — but
  given new ids (fingerprints, never one the form used) and new ids inside a group too.
- **In place of the conversation's starter.** "What is this form for?" adds a question at once, so
  the form is publishable from the first answer; the recipe has its own. A starter nobody has
  changed gives way to them — unless the recipe asks the same thing (its key), when the starter
  stays and the recipe's copy is not added. A starter changed by hand always stays: its words are
  the person's. (First built keeping the starter always: nineteen templates call theirs
  `full_name`, so nearly every seeded form asked for a name twice; `CAVEATS.md` #117.)
- **Each is the conversation's** (`source: 'guided'`, its baseline recorded), so a hand edit is
  seen as one and never overwritten (reconciliation, S5).
- **A structure-only recipe** gives its bracketed placeholder as text to read, and its questions
  from the shared vocabulary (name, date, time, place) and a signature whose statement is itself a
  placeholder. No operative sentence: `seed.test.ts` checks every seeded word, in every language,
  against the catalogue's regulated-word list.
- The template's settings (its submit label, its thanks) are not copied: the conversation's own
  design questions follow.
- Without the catalogue (the API unreachable), the guess is still named and still works, but
  "Right" on a template is refused: the screen says the template could not be loaded, and nothing
  changes. "Sort of" and "No" go on as ever.

## The questions

Twenty-two yes / no / not sure questions, group `guess`, patching nothing. Each is at most nine
words in English (G10); every option can be typed in twelve languages (aliases written by
`scripts/guess-aliases.ts` from each language's ways of saying yes, no and not sure); and the
phrase tables hold five rows per language for them. (The plan had eight; eight could not tell 25
recipes apart in any number of answers — a course from a conference, a room booking from an
appointment, a lab observation from a sample.)

| Node | Asks |
| --- | --- |
| `guess.date` | Is it for something on a set date? |
| `guess.meeting` | Is it for an association's meeting? |
| `guess.reply` | Will you answer each person yourself? |
| `guess.anonymous` | May people answer without giving their name? |
| `guess.signature` | Must people sign it? |
| `guess.pay` | Do people pay to take part? |
| `guess.invite` | Did you invite each person yourself? |
| `guess.research` | Is it for recording measurements or samples? |
| `guess.samples` | Will people send you samples? |
| `guess.contact` | Is it simply a way to contact you? |
| `guess.job` | Is it about a job or a role? |
| `guess.membership` | Is it for joining or updating a membership? |
| `guess.price` | Are people asking you for a price? |
| `guess.problem` | Is it for reporting a problem? |
| `guess.booking` | Are people booking a time or a place? |
| `guess.place` | Are people booking a room or a place? |
| `guess.learn` | Will people learn something there? |
| `guess.sessions` | Does it meet more than once? |
| `guess.news` | Will you send them news later? |
| `guess.absence` | Is it to say someone will be away? |
| `guess.proposal` | Is it for putting forward a proposal? |
| `guess.behalf` | Does someone act on another person's behalf? |

Their scores in `graph/nodes.ts` are the table a person reviews: which recipes answer yes (up to
4 200 millinats), which answer no (2 800–3 500), and which are indifferent; `flow.start`'s run from
1 100 to 3 500. A recipe is named on the
"no" side of a question unless it could honestly go either way.

## Known limits

- **Two recipes answer the broadest questions alike.** `member-details` and `absence-notice` say
  the same to reply, signature, research, problem and meeting, the five the engine asks first after
  "Collecting information". They end as the two likeliest, and are guessed only when a question
  that tells them apart (membership, absence, set date) comes up within five. The other 23 are
  guessed, answered as themselves (the start by its likeliest answer), in 3.6 questions on average
after it, five at most.
- **The priors are even** but for one. Nothing here knows which forms an organisation makes most;
  a learned prior (S12's decided slots, or counts of forms made) is for later.
- **Five new templates** the brief lists (order or invoice, check-in, donation, address change, exam
  answer sheet) are content still owed: each is a template in twelve languages first, a recipe
  second.

## Tests

- `interpret/exp.test.ts`: the series against `Math.exp`, its fixed points, and its fall.
- `belief/belief.test.ts` (`CAVEATS.md` #50, #115, #116, #119, #120): the numbers frozen for one
  conversation (probabilities, entropy, the guess, the next question, a question's expected gain);
  probabilities sum to 10⁶ within rounding; every question's likelihoods sum to one; the three
  states; the stop rules; "Why"; where "No" goes; a rebase, once and twice, mid-way and after
  "Right"; every recipe answered as itself.
- `belief/seed.test.ts` (#117, #118): a template's questions added with new ids and unique keys, in
  place of the starter or beside it, never over a hand edit; publishable; Back exact; every recipe
  seeds a form the schema takes; the structure-only recipes' words; refused without the catalogue.
- `graph/validate.test.ts`: G9 for a best question of a group with none scored, G1 for an `else`
  that names nothing, G11 for a chain after the best questions.
- `apps/forms` `guess.test.tsx`: the guess named in the screen's language, "Why this guess" (the
  same after a trip to the editor), "Right" without the catalogue, No, and the seeded preview with
  its questions to pick.
- `e2e/guided-builder.spec.ts`: a proxy form guessed from its answers, "Why this guess", Right, a
  seeded question edited in place, and only the gaps after; "Right" with the catalogue unreachable;
  No, the power of attorney guessed next, and Back to the first guess.
