# ADR 0005 — Four dependency majors, decided against for now

**Status:** accepted 2026-09-22
**Date:** 2026-09-22

Dependabot proposed five updates in September 2026. The routine group (#83 — patches, plus
`react-router` 8.4 and `prettier` 3.9) was merged after a local `pnpm verify` and `pnpm test:e2e`
on top of `main`. The four majors were each read for what they change and what their CI run
actually failed on, and each was closed. `.github/dependabot.yml` ignores their major lines so the
queue does not refill every Monday with a decision already made; this file is the durable "no",
and the condition beside each is what reopens it.

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
