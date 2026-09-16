# Loppa — motion system

Eleven variants, 160px, all from the same mark, materials and easing.
Each ships as `.webp` (alpha — works on any surface), `-on-white.gif` and
`-on-black.gif`.

**Loops** carry `loop=0` and close exactly: seam measured against the typical
frame-to-frame step, ratio ≤ 1.5 on every one. **One-shots** carry `loop=1` and
end at rest on the resting pose, so they hand off to `still/loppa-*.png`
without a jump.

## Utility — the states a product actually needs

| Variant | Use | Frames |
| --- | --- | --- |
| `spin` | **the loading spinner.** Continuous rotation, gentle chomp underneath. Fills the gap flagged in the asset prompt. | 56, loop |
| `breathe` | idle header mark. 2% scale, 3° sway — present without competing for attention. | 60, loop |
| `grow` | entrance: modal open, page load, card mount. Scales from nothing with a slight overshoot. | 40, once |
| `flip` | theme toggle, state change, "switched". 180° about the vertical. | 44, once |
| `success` | form submitted. Closed mark blooms open and settles. **This is the one to use when a Loppa form is completed** — it's the object doing the thing it exists to do. | 46, once |
| `shake` | rejection, invalid input. Damped 15° wobble. Pair with an error message; never use motion alone to signal failure. | 34, once |

## Eccentric — personality, marketing, easter eggs

| Variant | Use | Frames |
| --- | --- | --- |
| `chatter` | fast, talkative — three chomps per cycle. Good for a live/active indicator or a playful 404. | 40, loop |
| `tumble` | wild multi-axis spin. Launch pages, hover on a footer mark, Konami-style easter egg. | 60, loop |
| `scatter` | the panels fly apart and reassemble. The showiest of the set. Hero moments and celebration only — it destroys the mark mid-cycle, so never where the logo must stay legible. | 56, loop |

## Niche — rare, and miserable to improvise under pressure

| Variant | Use | Frames |
| --- | --- | --- |
| `collapse` | empty state, 404, "nothing here yet". The mark folds flat and lies down. Ends at rest, so it doubles as an illustration. | 44, once |
| `drift` | offline, disabled, ambient background. Barely moving — signals "not dead, not active". | 64, loop |

## Rules

- **`prefers-reduced-motion`**: replace any of these with `still/loppa-*.png`.
  The one-shots already end on that pose, so the swap is invisible.
- **Never use `shake` or `success` as the only signal.** Motion is reinforcement;
  the text carries the meaning.
- **`scatter` is not a logo.** Don't use it where the mark must remain readable.
- At 160px these run 200–530 KB. For a 44px spinner that is still too heavy —
  `spin` is a design reference; a production spinner should be a vector loader
  built from `vector/loppa-mark-flat.svg`. **Raised, not solved.**
- All eleven regenerate from `source/render-motion.py` at any size.
