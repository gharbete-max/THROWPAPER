# Design pass — 2026-10-20

A critique of the Documents screens, and the fixes that were made. Method: the `impeccable` critique
frame (hierarchy, spacing, type, motion, empty and error states, microcopy length, 360 px) and the
`ui-ux-pro-max` priorities (accessibility, touch, performance, consistency), both **advising**;
`DESIGN.md`, `docs/plan/DESIGN-LANGUAGE.md` and `docs/brand/USAGE.md` decide. The impeccable
engine ran (`context`; there is no `PRODUCT.md`, so it treated the code as the authority). What was
looked at: the built web app with Chromium at 1280 and 360 px, in English, German, Swedish and
Japanese, light and dark, with axe-core 4.10 injected from a scratch install (not a dependency).
Screens: the room (closed and opened), Scan (empty, loaded), Send (the three ways), the summary
centre and model list, Signing, Forms and the template gallery, To send.

## Standing constraints

Gold is a fill, never text; bronze reads on paper. The room stays dark grey and photograph-free.
One filled button per screen. No new colours: gold and its greys. Tokens, not literals; words in all
twelve catalogues; offline, nothing from another origin.

## Findings

Priority: P1 changes what a person does or reads wrongly; P2 is craft a person feels; P3 is polish.
**Fixed** means in this pass.

| # | Pri | Screen | Finding | Status |
| - | --- | ------ | ------- | ------ |
| 1 | P1 | Scan | The action row had two filled buttons side by side (Add, Take photos), then five wrapping rows of outlined ones, so no action led. | **Fixed.** Add is the one filled button until there is a document (then Make PDF is); Take photos is quiet. |
| 2 | P1 | Send | The three ways (one, a list, a campaign) were drawn as filled and outlined buttons, so the chosen way read as the primary action and competed with "Review before sending". | **Fixed.** A segmented choice (`.pick`): the chosen way is weight and a raised fill, not gold. Roles unchanged (`radio`). |
| 3 | P1 | Summary | The model list was a long paragraph per model; tier, memory and state were uppercase words in a row with no edge; three filled buttons in two cards; at 360 px the card ran off the side. | **Fixed.** One card per model; tier and memory are chips, the recommended and state chips are quiet; only Get is filled; the fieldset no longer overflows. |
| 4 | P1 | Reading a page | A page takes 45 to 100 s and showed only the word "Reading…" beside the page. | **Fixed.** A skeleton of the text to come and one sentence on how long (`read.slow`); the pulse stops under reduced motion. |
| 5 | P2 | Scan, Signing, Forms, To send | Empty states were an icon and a line: correct, but four different first impressions and no sense of what the tool is for. | **Fixed.** `EmptyState` takes a `media` photograph (grey, 14:5, from `public/media`, `docs/brand/MEDIA.md`); Scan also gets a hint line. Not added to Events, Invoices, Responses (quiet lists, not a task's first screen). |
| 6 | P2 | Forms gallery | 24 template cards were text only: a wall of identical boxes. | **Fixed.** Each card has a small drawing from the tokens (four have their own: registration, RSVP, enquiry, feedback; the rest the plain page). |
| 7 | P2 | Shell, 360 px | The bottom bar's labels were cut on the left, not the right ("eranstaltunge"): the ellipsis never applied because the text sat in a flex column. | **Fixed.** The label is a span with the ellipsis. |
| 8 | P2 | Shell | The logo link's accessible name ("Back to the room") did not contain its visible text (the organisation's name). axe: `label-content-name-mismatch`, 1 node on every screen. | **Fixed.** The name is "Demo AB — Back to the room". |
| 9 | P2 | Summary | "The model" and "AI models on this computer" repeat each other: two cards, two sets of buttons, two descriptions of the same model. | Not fixed: needs a product decision on whether the single-model card still earns its place now that there is a catalogue. |
| 10 | P2 | Forms (empty) | Two primary buttons say "New form" (the header and the empty state). | Not fixed: the empty state's is the better one; the header's should go quiet while there are no forms. A one-line change, left because it touches the Forms header tests. |
| 11 | P2 | Signing | The list has no paging; with a few hundred requests the page is 10,000 px tall (seen with the e2e data). The empty actions `<th>` is also still there. | Not fixed. Needs paging in the API; the `<th>` needs one word in twelve catalogues. |
| 12 | P3 | Send, Scan | Long German and Finnish labels wrap to two lines in buttons ("Datei oder KI-Paket (PACK.json) von der Festplatte öffnen" is four lines at 360 px). | Not fixed: the button stays whole rather than being cut; a shorter word per language is a translator's call. |
| 13 | P3 | Room | The room is right (dark grey, three floating catchers, the pool of colour beneath each). "Open a file…" in the organisation's own blue is the one stray hue, and it is the brand kit, not the room. | Left: by design (the kit decides). |
| 14 | P3 | Summary | A disabled radio and a greyed "Download" are both correct but look like faults on first sight; the note beneath explains it. | Left. |
| 15 | P3 | Everywhere | `Intl`/ICU: nothing sorts here; money and dates unchanged. | None. |

## What was seen (after)

- Scan, Signing, Forms, To send, empty: a grey banner photograph, the mark in its disc, the sentence at full contrast, the action. In dark mode the photograph is dimmed; it never goes warm.
- Send at 1280 and 360 px (German, Swedish): the segmented choice wraps to two rows on the phone and each option grows to fill its row; the filled button below is the only gold.
- Summary at 360 px German: the model card fits the screen; chips wrap; the "Voll" chip is the only filled one.
- Template gallery: the form's shape is readable before its name.
- Japanese: no clipping in the chips or the empty states.

## Media

Four CC0 photographs, 140,732 bytes in all, none in the room, none in the JavaScript: `docs/brand/MEDIA.md`
(source, author, licence, date, size, SHA-256, alt key) and `scripts/media.test.ts` (holds the file to
the record and to the budget). Unsplash was the first choice and could not be used: its site answers a
script with a bot check, which is not bypassed.

## Tests

`e2e/design-pass.spec.ts` (photograph with alt, size attributes, lazy and async; one filled button on
Scan; no request to another origin on Scan, Send, Signing and Forms; reduced motion removes the
fade; the Send choice; the model chips; a drawing on every template card; 360 px German with no
sideways scroll and the bottom bar cut on the right). `scripts/media.test.ts`.
