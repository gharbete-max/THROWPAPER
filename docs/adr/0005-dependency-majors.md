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

## #85 — `fastify-type-provider-zod` 4 → 7 (done 2026-10-26, with #99)

Version 7 requires Zod 4 (`zod/v4/core` exports it does not find in Zod 3); the whole workspace —
above all `packages/shared`, where every wire schema and the Forms ⇄ Mailer contract live — is Zod
3. A Zod major touches `packages/` and, by extension, `docs/CONTRACT.md`'s schemas, which is a joint
decision under `CLAUDE.md` rule 1. **Done in the Zod 4 change (see #99): the type provider moved to 7 with it.**

## #86 — `eslint-plugin-react-hooks` 5 → 7

Version 7 turns on the React Compiler rule set, which reports ten `setState` calls made synchronously
inside effects across the screens as errors. Each of those is a small refactor of real behaviour —
the kind that needs its own discriminating test — and ten of them are a task, not a side effect of
a lint bump. **Revisit after a session that refactors the ten sites with a test each; until then the
plugin stays on 5, where the existing `exhaustive-deps` warnings remain the only findings.**

## #99 — `zod` 3.25 → 4.6 (done 2026-10-26)

The first thing Zod 4 breaks is the contract: `packages/shared/src/contract/common.ts(13,28)` and
`contract/contacts.ts(16,19)` fail with `TS2554: Expected 2-3 arguments, but got 1` — the Forms ⇄
Mailer schemas are the earliest Zod 3 idiom in the workspace, and every wire schema after them is
written the same way. A Zod major is therefore a migration of `packages/shared` and, through it,
of `docs/CONTRACT.md`'s schemas: a joint decision under `CLAUDE.md` rule 1, planned as its own
task with the contract check green before and after. #85 (`fastify-type-provider-zod` 7) is the
same decision and rides along. **Done 2026-10-26: Zod 4.6.7 and the type provider 7.0.0, behaviour-preserving.** Before touching code,
every exported schema in `packages/shared` and `packages/signing` (231 of them) was run on Zod 3 over
13 800 generated inputs (valid ones built from each schema, invalid ones by dropping keys, wrong types, extra keys)
and again on Zod 4; `/openapi.json` and `contract:check` were captured the same way. What the comparison found,
and what was done:

- **Fixed to keep the old behaviour.** `z.record(valueSchema)` is gone (key schema added: 25 sites). A record
  keyed by an enum is exhaustive in Zod 4, so the four that Zod 3 let be partial are `z.partialRecord`
  (classify weights, the quoted lexicon, the shared answers file). `z.string().uuid()` became `z.guid()`:
  Zod 3 took any 8-4-4-4-12 hex string, Zod 4's `uuid` also demands version and variant bits, which seeds and
  fixtures do not have. A `.default({})` on an object with defaults inside is `.prefault({})` (Zod 4's default
  skips parsing; three sites). A `z.unknown()` key is no longer optional (`ImportAliases.file`), so it says
  `.optional()`. The response serializer is parse-then-stringify in each API (`zod-serializer.ts`), because the
  provider's own one encodes, and refuses a schema holding a `.transform()`.
- **Differences left, on purpose.** Error wording (`Required` is `Invalid input: expected string, received
  undefined`, and so on) and issue codes (`invalid_enum_value` is `invalid_value`); a rejected value can carry one
  more issue than before (`too_small` beside `invalid_type`, for an array given to a string with a minimum
  length). Every rejection is still a rejection, at the same paths. `z.number()` refuses `Infinity` (JSON cannot
  carry it), `datetime()` refuses `HH:MMZ` and `+0200` offsets without a colon that Zod 3 let through, and
  `/openapi.json` is generated by `z.toJSONSchema`: the same routes and shapes, with `pattern`s added and
  `additionalProperties` no longer repeated on request bodies.
- **Size.** Zod 4's classic schemas are bigger than Zod 3's and sit in the page and again in the import worker.
  Forms' build stubs Zod's JSON Schema generator out of both bundles and minifies with terser; the 1 250 KB total
  is unchanged.
- The audit waiver for GHSA-mrhx-c7xc-m3w5 (below) is gone: 4.6.7 is past the patched 4.6.6.

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

### Audit waiver, 2026-10-26 (GHSA-mrhx-c7xc-m3w5)

`pnpm audit --prod --audit-level high` began failing on `main` when GHSA-mrhx-c7xc-m3w5 (Zod: memory
exhaustion validating a large array, `$ZodArray` / `handleArrayResult`, versions below 4.6.6) was
published. The workspace is on Zod 3.25.76. Checked: `handleArrayResult` exists only in
`zod/v4/core/schemas.js`; the Zod 3 `ZodArray` that `import { z } from 'zod'` runs does not contain it, and
nothing in the repository imports `zod/v4`. The route body limits (1 to 16 MB) bound the input anyway. So
the advisory is ignored in `package.json` (`pnpm.auditConfig.ignoreGhsas`) and the real fix is the Zod 4
migration above (#99). Remove the ignore when that lands, or when an advisory names the Zod 3 line.
**Removed 2026-10-26 with the Zod 4 migration (#99): `pnpm.auditConfig` is gone from `package.json`.**
The same run found moderate `nodemailer` (address parsing) and `fast-uri` advisories: fixed by overrides
to `nodemailer ^10.1.4`, `fast-uri ^3.1.9` and `^4.2.3`.
