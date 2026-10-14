# Improving what is already in Documents — the plan

**Status:** accepted 2026-10-14. Written from the owner's request: scanning works well with the QR
code, the cropping and the send to the PC; it now needs **filters** (black and white and others)
and a **smart identify** step that turns the photograph into a simple digital version made of
**lines and text only, almost ASCII in its simplicity**. And: think of ways to improve every
function in Documents (Forms, Scan, Sign, Send and the centre), then do them.

Every choice below was made by the plainest reading of `docs/VISION.md`: lightweight, local-first,
the basics rather than Acrobat. Where there were several ways, the one that is deterministic,
offline and smallest was taken.

## The one decision that shapes "smart identify"

The summary model (Qwen3-4B-Instruct) **reads text, it cannot see a photograph**. So "read the
photograph and render a digital version with lines and text" is done in two deterministic steps the
repository already half has, and the model is not in the path:

1. **Read**: on-device OCR (Tesseract, as the import uses) gives words with their boxes; a line
   finder over the cleaned image finds the ruled lines, boxes and table borders.
2. **Render**: a clean page that holds only those lines and that text, in one plain font, on
   white: a *digital copy*. It keeps as a PDF (or SVG), as the page of a form (the paper twin and
   the import already take the same reading), or as plain text. The person sees the photograph and
   the copy side by side and chooses which to keep. Nothing is guessed silently: low-confidence
   words are marked, and the original stays.

The model stays in the centre (ADR 0023). A *summary* of the scanned text is one click away from
the result, because that part is text.

## Tracks (one agent and one PR each; Scan.tsx and the catalogues are shared, so each track keeps
its UI in new files and a small hunk in the shared ones)

| # | Track | What |
| --- | --- | --- |
| A | **Scan filters** | Per page: *Original*, *Enhanced colour*, *Grey*, *Black and white* (adaptive threshold, so a shadow does not turn the page black), *Clean document* (white background, sharp text); live preview; strength slider; applied once, before the page is embedded; automatic *deskew* and a suggested *page turn* from OCR orientation. All pure canvas code, offline. |
| B | **Digital copy** (smart identify) | The step described above: OCR + line finder → lines-and-text page; side-by-side review; keep as PDF/SVG/text or as a form page. Also *Searchable PDF*: the photo with an invisible text layer from the same OCR, so the scan can be searched and selected. |
| C | **Flow** | Drop a file anywhere in the room and it goes to the right part (PDF to arrange, Word to PDF, photo to Scan, an invoice-looking image to invoice scan); *Recent documents* (local, names only); a scan result offers *Summarise*, *Sign*, *Send*, *Fill* as one-click hand-offs; a suggested file name from the page's own heading and date (rule-based); size choice *Small / Medium / Original* when keeping a PDF, with the size shown before. |
| D | **Send and email** | Address book from recent recipients (local), typo help on addresses (`gmial.com`), duplicates and bad rows flagged in a pasted or CSV list before preview, attachment-size warning with *make smaller* (re-compress images, drop unused objects), and a plain-text view of every campaign beside the preview. |
| E | **Sign** | A saved signature kept on this computer only; initials; date stamp; placing it on a chosen page and spot with keyboard nudging; a visible *what you are about to sign* page strip. |
| F | **Housekeeping** | The bundle budget moves to 1 250 KB (below); the German small-phone guided-builder test that flakes under load is made robust; the leftover docs say what is true. |

## Bundle

The total in `scripts/bundle-budget.ts` is a doubling-detector over every lazy chunk, 1 117 KB
today of 1 150. Six tracks with words in twelve catalogues each will not fit, so it moves to
**1 250 KB** with this plan; the entry (12 KB) and stylesheet (20 KB) caps, which are what a visitor
actually pays, do not move.

## Rules that stay

Nothing sends or deletes without a confirmation (rule 7); no hard-coded strings, colours or fonts
(rule 4); exact arithmetic (rule 5); the model never runs in `packages/shared/src/{builder,interpret,import}`
and never decides anything in a scan; no legal, clinical, tax or safety wording is generated (rule 8).
