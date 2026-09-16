<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/title/vector/loppa-lockup-h-dark.svg">
    <img src="docs/brand/title/vector/loppa-lockup-h-light.svg" width="420" height="139" alt="Loppa">
  </picture>
</p>

<p align="center">
  Forms, registrations and email — for organisations that have to get it right.
</p>

---

Loppa is two products that integrate, built in one monorepo. Either one can be sold, deployed
and demoed without the other; they talk only through a versioned HTTP contract, never a shared
database.

|                  | **Forms**                                                           | **Mailer**                                      |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| What             | Form builder, inspections, measurements, registrations, PDF reports | Customised and recurring email campaigns        |
| For              | Anyone who collects structured data and needs a report out          | Anyone with a list and something to say monthly |
| Needs the other? | No. Sends through Mailer if present, falls back to plain SMTP       | No. Accepts audiences from a CSV or from Forms  |
| Lives in         | `apps/forms` + `apps/api-forms`                                     | `apps/mailer` + `apps/api-mailer`               |

Forms of every kind, deliberately unregulated — not accounting, not clinical, not legal. Heavy
visual customisation by the form author, white-label client mode per organisation, and a
theming contract with a locked accessibility floor that no customer theme can lower.

## Run it

Requires Node ≥ 20 and pnpm 9 (`corepack enable`).

```bash
pnpm install
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm demo
```

`pnpm demo` starts Forms with seeded data: a brand kit, ~200 contacts across three audiences, one
event with registrations, an inspection template with completed inspections, a measurement
dataset, and three email templates. `pnpm dev:forms` / `pnpm dev:mailer` run each product on its
own.

```bash
pnpm verify          # format + typecheck + lint + test + build — the definition of done
pnpm contract:check  # both apps against docs/CONTRACT.md
pnpm test:e2e        # Playwright, against pnpm demo
```

## Layout

```
apps/forms        Forms — React, SSR, Vite
apps/api-forms    Forms backend
apps/mailer       Mailer
apps/api-mailer   Mailer backend
packages/tokens   Design tokens → CSS vars, inline email styles, print CSS. Contrast guard lives here
packages/i18n     Translation catalogues and ICU collation
packages/ui       Headless + styled primitives, including the data grid
packages/calc     Formula AST, statistics, chart definitions
packages/shared   Types and Zod schemas, including the contract schemas
docs/brand        The Loppa brand bundle: tokens, motion CSS, marks, lockups, animations (rasters in Git LFS)
```

## Read in this order

0. `CLAUDE.md` — the short, always-loaded rules.
1. `docs/START-HERE.md` — the plan. The specs are a destination; this is what gets built.
2. `docs/HANDOVER.md` — current state and where to pick up.
3. `LAUNCH-CHECKLIST.md` — everything still temporary, unconfigured or waiting on a decision.
4. `docs/CONTRACT.md` — the API between the two products. Frozen before either side writes code.
5. `docs/adr/` — the decisions with long-term consequences, one file each.
6. `docs/SPEC-shared.md`, `docs/SPEC-forms.md`, `docs/SPEC-mailer.md`, `docs/ROADMAP.md` —
   reference, consulted when a choice is hard to reverse.

## Rules that apply to every change

- The two products never import each other. If you want to, the contract is missing something.
- API-first, bearer + refresh token auth. Every screen calls a documented endpoint.
- No hard-coded colours, fonts, spacing or user-facing strings — tokens and i18n only.
- Exact arithmetic: decimal or bigint for money, quantities and measurements. Never floats.
- Locale-aware sorting (Swedish å ä ö after z; Danish/Norwegian æ ø å). Numeric columns sort
  on the number, never the formatted string.
- Nothing sends or deletes without a confirmation step; every outbound action has a test mode.
- No generated legal, clinical, tax or safety-critical wording. Templates come from a human.

Internal identifiers, package names, database tables and API routes keep the `throwpaper` /
`@tp/*` names on purpose. Only user-facing strings say Loppa.

## Brand

The mark is a folded paper fortune-teller in gold and platinum. Gold measures 2.14:1 on white,
so the identity is at its strongest on near-black; on light surfaces text takes the bronze tier
(`#8F6B3A`, 4.64:1), never the face gold. The bundle — tokens, usage rules, marks, motion — is in `docs/brand`; the application tokens
in `packages/tokens` and `DESIGN.md` still carry the previous palette and move over in a
separate PR series. See `SECURITY.md` for reporting.
