# START HERE — Loppa handover

**Read this before anything else. It says which files are live and which are
dead.** There are several rounds of design work in this bundle and most of it is
superseded. Following the wrong document will produce the wrong palette, the
wrong product name, and a lot of rework.

---

## 1. Live files — the only ones to follow

| File | What it is |
| --- | --- |
| `loppa/tokens-loppa.css` | **the palette.** Import first. |
| `loppa/css/loppa-motion.css` | motion utilities. Import after tokens. |
| `loppa/css/loppa-spinner.svg` | the loader. 1.5 KB vector. |
| `loppa/ASSET-REPLACEMENT-PROMPT.md` | the migration: rename + asset swap |
| `loppa/USAGE.md` | what to do with the assets, and what still must be generated |
| `loppa/motion/MOTION.md` | the eleven motion states and where each belongs |
| `loppa/title/TYPOGRAPHY.md` | wordmark, lockups, and the typeface decision |
| `BUILD-BRIEF.md` | **structure only** — theming layers, client mode, contrast guard |
| `glass.css` | glass surface system |
| `loppa/source/` | regenerate any asset at any size |

## 2. Dead — delete these, do not read them

| Path | Why |
| --- | --- |
| `PALOPPA-ASSETS.md` | seafoam/coral palette, wrong product name |
| `tokens.css` | seafoam/coral tokens |
| `animation/`, `web-icons/`, `logo-mark*.svg/png`, `logo-usage-sheet.png`, `icon-preview.png`, `cootie-catcher-fold.gif` | seafoam/coral assets |
| `pastel/` | four-pastel round, superseded |
| `metal/` | gold-and-silver round, superseded |
| `taste/` | concept sketches only, never production |
| `source/` (root) | generators for the dead palettes |

**Delete them before Claude Code reads the repo.** A prompt that contradicts
another prompt is worse than a missing prompt.

## 3. Two exceptions in the live list

`BUILD-BRIEF.md` and `glass.css` are live for **structure only**. Their colour
references are dead. Before use:

- rename every `--paloppa-*` token to `--loppa-*`
- ignore every colour name in them (seafoam, coral, salmon, canvas)
- keep everything else: the three-layer theming contract, client mode, the
  LOCKED list, the contrast guard, the glass rules

## 4. Reading order

1. This file
2. `BUILD-BRIEF.md` — architecture (structure only)
3. `loppa/ASSET-REPLACEMENT-PROMPT.md` — rename and swap
4. `loppa/USAGE.md` — integration and what to generate
5. `loppa/motion/MOTION.md` and `loppa/title/TYPOGRAPHY.md` — as needed

---

## 5. Decide these before Claude Code starts

Implementation will stall or guess on each of these. None of them is a coding
decision.

| Decision | Why it blocks |
| --- | --- |
| **Materials rotating during the chomp** — keep as "turning foil", or go single-metal | Affects every animation in the bundle. If you change it, they all re-render. |
| **Default theme, light or dark** | Gold is 2.14:1 on white. The identity is materially stronger on near-black. This changes hero design, icon set and social cards. |
| **Typeface licence** | The shipped lockups are a comp in DejaVu ExtraLight. They must not go live as final artwork. |
| **"Powered by Loppa"** on white-labelled sites | Commercial call; the slot must exist either way. |
| **Repo rename** `throwpaper` → `loppa` | Breaks every existing clone, CI reference and webhook. Do it deliberately or not at all. |

## 6. Repo hygiene — say this to Claude Code explicitly

**Do not commit the animations to git without Git LFS.** The Loppa bundle is
~32 MB and GIF/WebP binaries do not diff — every re-export adds the full file to
history forever. Either put `*.gif`, `*.webp`, `*.png` behind Git LFS, or host
them on a CDN and commit only the vectors and CSS. Decide before the first
commit; retrofitting means rewriting history.

**Strip the C2PA metadata from every SVG on ingest.** The delivered `.svg` files
carry an embedded `<metadata><c2pa:manifest>` block of roughly 7.8 KB. The
spinner is 1.5 KB of markup inside a 9 KB file. Run them through SVGO once.

**Split the work across PRs.** In order:

1. tokens + glass + motion CSS (no visual change yet)
2. naming: `throwpaper`/`Paloppa` → `Loppa` in user-facing strings only
3. asset swap
4. motion states
5. theming architecture + client mode

One PR containing all five is unreviewable, and the theming work is the part
that most needs review.

**Take a baseline first.** Lighthouse and per-route page weight *before* any
change, so the "report the delta" checks in the other prompts have something to
compare against.

## 7. Tests worth writing

Ask for these explicitly — they will not appear otherwise:

- **Hostile theme test.** Client mode with a near-white accent, a near-black
  accent, a non-square logo, a missing logo, a 2 MB PNG, and an SVG containing a
  `<script>` tag. Assert the LOCKED list survives all six.
- **Contrast test, per theme**, asserting against the measured table in
  `tokens-loppa.css` — so a future palette change fails CI rather than shipping.
- **Visual regression** on the header lockup and the form surface, both themes.
- **A public form rendered logged out**, to prove it doesn't depend on app chrome.

## 8. What is still missing from the bundle

Listed in `loppa/USAGE.md` §3, repeated here because it is the most likely thing
to be forgotten:

- favicon and PWA icon set (generate from `vector/loppa-mark-flat.svg` — never
  downscale the gradient mark)
- social cards, 1200×630 and 1200×1200
- email assets: PNG only, absolute URLs, text fallback
- a client-mode placeholder mark for orgs with no logo uploaded

## 9. Tell Claude Code to report, not just finish

Require a written summary covering: the repo recon, what it changed from any
skill's advice and why, what failed contrast and how it was fixed, what
`ponytail` wanted to delete that was kept and why, the page-weight delta per
route, and every open decision from §5 restated rather than quietly resolved.
