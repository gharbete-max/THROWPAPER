# Shared packages

Owned jointly. A change here affects both tracks — announce it, and keep the API stable.

## `packages/tokens` — design tokens

Tokens are **plain JSON, never CSS**: colours (primary, secondary, accent, background, surface,
text, muted, border, success, warning, danger), typography (heading font, body font, base size,
scale ratio, line height, weights), spacing unit, radius, border width, shadow level, button
style, logo light/dark, favicon, document header and footer.

Four compilers from one source:
- **Web** → CSS custom properties. Components consume variables only; no hex codes in components.
- **Email** → inline styles and table layout (React Email or MJML). Email clients support neither
  CSS variables nor modern layout — never reuse web CSS.
- **PDF** → print stylesheet with page size, margins, running header/footer, page numbers, and
  embedded fonts that render Nordic characters correctly.
- **Native** → a StyleSheet object, for the mobile apps later.

A **Brand Kit editor** exposes tokens through colour pickers with contrast warnings, font pickers
with a live specimen, sliders for spacing and radius, and a logo uploader, with instant preview.
Ship 6–8 form themes, 6–8 email themes and 3–4 document themes as presets. Brand Kit changes
cascade to anything not overriding a token.

### Brand direction

The house palette. These are token values, not CSS — everything downstream (web variables, inline
email styles, print stylesheet, native StyleSheet) compiles from them.

| Colour | Hex | Role |
|---|---|---|
| Deep Midnight | `#1B263B` | Base / primary. Ultra-dark navy; grounded and tailored. |
| Saddle Brown | `#8B5A2B` | Accent / focus. Warm leather, heritage texture. |
| Cognac | `#C68B59` | Secondary accent. Softer amber leather that lifts the palette. |
| Parchment | `#F4F1EA` | Light neutral. Unbleached cream, clean contrast against the navy. |
| Brushed Gold | `#D4AF37` | Highlight. Metallic detail — hardware and trim only. |

**Ratios.** 60% Deep Midnight for structure and backdrops · 30% Saddle Brown and Cognac split
across accents · 10% Parchment for readable contrast and Brushed Gold for precise detail.

**Treatment: flat and plain.** No gradients. No decorative corner treatment. Colour and spacing do
the work, not ornament. The editing interface in particular is judged on how quickly somebody can
change a form, not on how it looks doing it.

**Measured contrast, recorded so it is not discovered in an audit.** WCAG AA needs 4.5:1 for body
text and 3:1 for large text.

| Foreground | on Deep Midnight | on Parchment |
|---|---|---|
| Parchment / Deep Midnight | **13.42** ✅ | **13.42** ✅ |
| Saddle Brown | 2.59 ❌ | **5.18** ✅ |
| Cognac | **5.22** ✅ | 2.57 ❌ |
| Brushed Gold | **7.20** ✅ | 1.86 ❌ |

**Each accent works on exactly one ground, and they split cleanly.** Saddle Brown is the accent for
light surfaces; Cognac and Brushed Gold are accents for dark ones. Used the other way round they
fail AA outright — Brushed Gold on Parchment is 1.86:1, which is decorative-only and unreadable as
text.

That is not a flaw in the palette, it is its shape: it wants a dark ground with warm accents, or a
Parchment ground with Saddle Brown. Mixing the two halves is what produces the unreadable
combinations, and the Brand Kit's contrast warnings (§Brand Kit editor) should say so at the moment
somebody picks one.

**Escape hatch:** a sandboxed Custom CSS panel for public forms only, scoped to the form root,
with a reset button. Never for email or PDF.

## `packages/i18n` — localisation

- Per-organisation locale config with a default and an ordered fallback chain.
- Public pages show a **language dropdown**, defaulting to browser language then org default,
  persisting through multi-page flows **without losing entered data**, and recording the chosen
  locale on the record.
- Contacts carry a preferred locale; email sends in it and links to a web version in others.
- PDFs generate in the recipient's locale, optionally bilingual.
- Per-locale completeness indicators on every form and template; publishing with missing required
  translations is blocked unless explicitly overridden.
- Locale-aware dates, numbers, currency, address layout and **collation**.

## `packages/ui` — the data grid

One grid, reused everywhere. Build it properly once.

- **Sorting:** click to sort, shift-click for multi-column with visible priority. ICU collation
  for text, true numeric sort for numbers, configurable null placement.
- **Columns:** drag to reorder, resize, hide/show, pin left, column chooser.
- **Filtering:** per-column filters typed to the column (text contains/equals/starts, numeric
  range, date range, set membership), plus global search.
- **Grouping:** collapsible groups, per-group subtotals and a totals row with sum, count, average
  and percent-of-total.
- **Saved views:** named column/sort/filter/group combinations, shareable, one default per screen.
- **Interaction:** keyboard navigation, range selection, copy as TSV so it pastes into Excel, row
  detail drawer.
- **Scale:** virtualised rendering with server-side sort, filter and pagination. Must stay
  responsive at 100,000 rows. Never sort or filter a full dataset in the browser.
- **Export parity:** exports reproduce exactly what is on screen — CSV (UTF-8 with BOM,
  configurable separator), XLSX (frozen header, correct column types, Excel-native number and
  date formats) and PDF.

Use an established headless table library plus a virtualiser. Do not hand-roll it.

## `packages/calc` — formulas, statistics, charts

**Formulas.** Expressions reference **named fields**, never cell coordinates. Parse to an AST and
evaluate that — no `eval`, no arbitrary code, no network access from a formula. Whitelisted
functions: arithmetic; `IF`/`AND`/`OR`/`NOT`/`SWITCH`; `SUM`, `COUNT`, `COUNTIF`, `AVG`, `MIN`,
`MAX`, `MEDIAN`, `STDEV`, `VAR`, `PERCENTILE`; `ROUND`/`ROUNDUP`/`ROUNDDOWN`, `ABS`, `POWER`,
`SQRT`, `LOG`, `EXP`; date arithmetic; `LOOKUP` against a reference table; string helpers.

Units and precision are declared per field; combining incompatible units is a **design-time
error**, not a wrong number at runtime. Arithmetic is decimal. Two modes: **stored** (computed at
submission and frozen, for anything that must be reproducible) and **derived** (computed at report
time). The mode is per formula and visible in the UI. Errors are typed values (`#DIV0`, `#UNIT`,
`#MISSING`) that propagate visibly — never a silent zero.

Editor: autocomplete on field names, inline docs, live preview against a sample row, and a
dependency view that flags circular references.

**Statistics.** Descriptive (n, mean, median, mode, SD, variance, range, quartiles, IQR,
coefficient of variation, standard error, confidence interval); distribution (histogram with
automatic or manual binning, cumulative); relationship (linear regression with slope, intercept,
R², residuals; correlation); comparison (t-test, one-way ANOVA, chi-square); quality control
(running mean and SD, ±k·SD limits, trend and shift detection, IQR and Grubbs outlier tests).

Every statistic reports its **n** and names its method. No p-value without n and the test name.

**Charts.** Line, multi-line, area, bar, grouped, stacked, horizontal, scatter with optional fit
line, bubble, histogram, box plot, control chart, waterfall, gauge, pie and donut (discouraged in
the picker above five categories), and bar-plus-line combination.

Builder: dataset → chart type → map fields to axes, series, grouping → aggregation → axis config
(title, scale, log, min/max, tick format), legend, data labels, reference lines and bands → live
preview. All through controls.

Colours come from tokens, defaulting to a colour-blind-safe categorical palette. One definition,
three renderers: interactive SVG on web, vector in PDF, static image with alt text in email.
Every chart has a data-table toggle and generated alt text.

## Auth

Magic link plus optional SSO. Bearer tokens with refresh, not cookie-only. Rate-limited public
endpoints, honeypot plus optional CAPTCHA on public forms. Full audit log: who changed what, when.
