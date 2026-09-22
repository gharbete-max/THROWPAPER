# ADR 0005 — Dependency majors, decided against for now

**Status:** accepted 2026-09-22; extended 2026-09-22 (second batch)
**Date:** 2026-09-22

Dependabot proposed five updates in September 2026, and five more the same week. The routine
groups (#83 — patches, plus `react-router` 8.4 and `prettier` 3.9; #98 — an `@aws-sdk/client-sesv2`
patch) were merged after a local `pnpm verify` and `pnpm test:e2e` on top of `main`. The majors
were each read for what they change and what their CI run actually did, and each was closed.
`.github/dependabot.yml` ignores their major lines so the queue does not refill every Monday with a
decision already made; this file is the durable "no", and the condition beside each is what
reopens it.

## Re-review: **2026-12-22**, and what forces it sooner

The per-major conditions below are good and stay as they are — each says what reopens its own
decision. What was missing is a **date**, because a dependabot ignore has no expiry and a "no for
now" with only a condition attached is a "no forever" that nobody ever notices becoming permanent.

**On 2026-12-22, re-read every section of this file** and either restate the no with a fresh
reason or take the bump. Three months is chosen to be shorter than the interval over which an
unmaintained major becomes a security problem, and longer than the noise it would otherwise create.

Sooner, unconditionally, if any of these happen first:

- **A security advisory** against any ignored line. An advisory ends the decision immediately; it
  is not weighed against the reasons below.
- **The blocking task lands.** Several conditions below wait on something specific — the Vite
  major, the tsconfig migration, S3. When that thing is done, its dependant is due, not eligible.
- **A sixth major arrives.** Five was a batch; a growing pile means the policy, not the packages,
  needs the look.

Recording the outcome of a re-review in this file is the point of it — a re-review that leaves no
trace did not happen.

## #62 — `@vitejs/plugin-react` 4 → 6

Its build fails on `ERR_PACKAGE_PATH_NOT_EXPORTED './internal'` from `vite/package.json`: plugin-react
6 imports an internal Vite 7 entry point, and the workspace is on Vite 6.4. The SSR marketing site,
`vite-plugin-pwa`, the dev proxy and the e2e `vite preview` were all built and proven on Vite 6, so
the real change here is a Vite major, not a plugin bump. **Revisit when Vite 7 is taken on purpose;
take plugin-react 6 in the same change.**

## #84 — `typescript` 5.9 → 6

TypeScript 6 changes the default `types` and module-resolution behaviour; `packages/tokens/src/fonts.ts`
immediately loses `node:fs`, `node:module` and `import.meta.url`, and the same class of error waits in
every package that reaches Node from a file typechecked under a browser-shaped config. That is a
tsconfig migration across five packages and two apps, with the root `scripts/` typechecked too.
**Revisit as its own task: one branch that migrates every tsconfig, with `pnpm verify` green across
the workspace before the version moves.**

## #85 — `fastify-type-provider-zod` 4 → 7

Version 7 requires Zod 4 (`zod/v4/core` exports it does not find in Zod 3); the whole workspace —
above all `packages/shared`, where every wire schema and the Forms ⇄ Mailer contract live — is Zod
3. A Zod major touches `packages/` and, by extension, `docs/CONTRACT.md`'s schemas, which is a joint
decision under `CLAUDE.md` rule 1. **Revisit when a Zod 4 migration of `packages/shared` has been
planned and approved; take the type provider in that change.**

## #86 — `eslint-plugin-react-hooks` 5 → 7

Version 7 turns on the React Compiler rule set, which reports ten `setState` calls made synchronously
inside effects across the screens as errors. Each of those is a small refactor of real behaviour —
the kind that needs its own discriminating test — and ten of them are a task, not a side effect of
a lint bump. **Revisit after a session that refactors the ten sites with a test each; until then the
plugin stays on 5, where the existing `exhaustive-deps` warnings remain the only findings.**

## #99 — `zod` 3.25 → 4.6

The first thing Zod 4 breaks is the contract: `packages/shared/src/contract/common.ts(13,28)` and
`contract/contacts.ts(16,19)` fail with `TS2554: Expected 2-3 arguments, but got 1` — the Forms ⇄
Mailer schemas are the earliest Zod 3 idiom in the workspace, and every wire schema after them is
written the same way. A Zod major is therefore a migration of `packages/shared` and, through it,
of `docs/CONTRACT.md`'s schemas: a joint decision under `CLAUDE.md` rule 1, planned as its own
task with the contract check green before and after. #85 (`fastify-type-provider-zod` 7) is the
same decision and rides along. **Revisit when a Zod 4 migration of `packages/shared` has been
planned and approved; take the type provider in that change.**

## #100 — `@tanstack/react-table` 8.21 → 9.2

Version 9 renames the row-model API (`getCoreRowModel` → `createCoreRowModel`, `useReactTable` →
`ReactTable`), drops `VisibilityState`, and makes `ColumnDef` take two or three type arguments;
`apps/forms/src/screens/Submissions.tsx` — the response grid — fails typecheck on all of it plus
five implicit `any`s. That is a rewrite of the one screen that shows a customer their responses,
and the screen has no browser spec yet; the simulated-user loop (S3) is what gives it one.
**Revisit after S3, as its own task, with the Submissions spec green before and after.**

## #101 — `vite` 6.4 → 8.3

CI was green on this one — `pnpm verify` 132 files / 1756 tests and 11 e2e on the base it was
opened against — which is exactly why it is written down rather than merged on green: the build
logs three deprecations that are the shape of the real change (`optimizeDeps.rollupOptions` →
`rolldownOptions`; the `esbuild` option → `oxc`; "switch to `@vitejs/plugin-react-oxc`"), and it
runs on `@vitejs/plugin-react` 4, the very pairing #62 above says to take together. The SSR
marketing site, `vite-plugin-pwa`, the dev proxy and the e2e `vite preview` were proven on Vite 6.
The owner's decision (2026-09-22): a Vite major is a deliberate task, not a Monday bump.
**Revisit as that task — Vite 8 with plugin-react 6 or `plugin-react-oxc`, the three deprecations
resolved, SSR / PWA / preview re-proven — and close #62's condition in the same change.**

## #102 — `dotenv` 16.6 → 18.0

Nothing this product needs changed between 16 and 18, and one thing did that it does not want:
from 17 on, `config()` prints `◇ injected env (n) from .env` to stdout at every boot unless
`quiet: true` is passed (probed with 18.0.0 in a scratch directory). Both `env.ts` call
`config({ path: [...] })`, and the API's stdout is pino's JSON stream — a line of prose in it is
a log shipper's problem. Two lines would take the bump on purpose; a bump that ships a side effect
by default is closed by default. **Revisit if 16.x gets an advisory, or when the bump is taken
deliberately with `quiet: true` in both `env.ts`.**

