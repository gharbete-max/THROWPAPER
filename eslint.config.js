import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // Build output, like `dist` — it is generated code and lints as if it were ours.
      '**/dist-server/**',
      // The OCR runtime, copied out of node_modules by scripts/ocr-assets.ts. Not ours either.
      'apps/forms/public/ocr/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/drizzle/**',
      // The desktop edition's staging folder and installers (ADR 0016): bundles, not source.
      'apps/desktop/.stage/**',
      'apps/desktop/release/**',
      // Agent git worktrees, each a full copy of the source. `apps/forms/public/ocr/**` above is
      // anchored at the repo root and so misses the copy inside a worktree, which then lints as
      // ours — a vendored wasm file is thousands of errors. Do not remove; it is not redundant.
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // CLAUDE.md rule 5: money, quantities and measurements are decimal or bigint, never floats.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use packages/calc decimal helpers.' },
      ],
    },
  },
  {
    // CommonJS on purpose: electron-builder `require`s its hooks (apps/desktop/scripts/after-pack.cjs).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/forms/**/*.tsx', 'apps/mailer/**/*.tsx', 'apps/sign/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // CLAUDE.md rule 1, as a rule rather than a convention: the three products never import each
  // other. They talk through docs/CONTRACT.md. Only `scripts/contract-check.ts` reads all three
  // registries, and it lives outside `apps/`.
  ...productBoundaries(),
  desktopHost(),
  guidedCorePurity(),
);

/**
 * The guided builder's core is pure and headless (`CLAUDE.md`, "Guided Builder & Import"; ADR
 * 0017). Written as rules so it is enforced rather than remembered: no React, no DOM, no Node, no
 * clock, no randomness, and none of the floating-point functions whose last bit differs between
 * engines — which would make "same bytes in, same JSON out, on every machine" false (ADR 0019).
 * Tests are exempt: they may read a fixture from disk.
 */
function guidedCorePurity() {
  const math = ['exp', 'log', 'log2', 'log10', 'log1p', 'expm1', 'pow', 'random'].map(
    (property) => ({
      object: 'Math',
      property,
      message: 'Decisions are integers and committed tables (ADR 0019); Math.random is never used.',
    }),
  );
  return {
    files: ['packages/shared/src/{builder,interpret,import}/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'node:*'],
              message: 'The guided core is pure and headless: no React, no Node (CLAUDE.md).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use packages/calc decimal helpers.' },
        ...['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'performance'].map(
          (name) => ({ name, message: 'The guided core has no DOM and no I/O (CLAUDE.md).' }),
        ),
      ],
      'no-restricted-properties': [
        'error',
        ...math,
        { object: 'Date', property: 'now', message: 'The guided core has no clock (CLAUDE.md).' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'The guided core has no clock.' },
      ],
    },
  };
}

/**
 * `apps/desktop` is not a product: it is the shell that **hosts** products on one computer (ADR
 * 0016 — Forms, and since P1c Sign, each on its own loopback port). It may start each one through
 * its one public entry point, and reach into none of them: the products still talk only over
 * docs/CONTRACT.md, and the shell hands Forms the address and token of its Sign, nothing more.
 */
function desktopHost() {
  return {
    files: ['apps/desktop/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // A regex, not a gitignore-style group: a group cannot re-include a subpath of a
              // package it has excluded, so `!@tp/api-forms/desktop` never took effect.
              regex:
                '^@tp/(?:api-forms(?!/desktop$)|api-sign(?!/local$)|forms|sign|mailer|api-mailer)(?:/.*)?$',
              message:
                'The desktop shell starts products through their entry points only (@tp/api-forms/desktop, @tp/api-sign/local). ADR 0016.',
            },
            {
              group: [
                '**/apps/*/src/**',
                ...['forms', 'api-forms', 'sign', 'api-sign', 'mailer', 'api-mailer'].flatMap(
                  (app) => [`../../${app}/**`, `../../../${app}/**`],
                ),
              ],
              message: 'The desktop shell does not reach into another app by path. ADR 0016.',
            },
          ],
        },
      ],
    },
  };
}

/**
 * One block per product: its frontend and backend may import each other's *packages* (`@tp/*` in
 * `packages/`), never another product's app — by package name or by relative path.
 */
function productBoundaries() {
  const products = {
    // `desktop` hosts products rather than being one; its own rule is `desktopHost` above.
    forms: ['forms', 'api-forms'],
    mailer: ['mailer', 'api-mailer'],
    sign: ['sign', 'api-sign'],
  };
  return Object.entries(products).map(([name, apps]) => {
    const others = Object.entries(products)
      .filter(([other]) => other !== name)
      .flatMap(([, otherApps]) => otherApps);
    return {
      files: apps.map((app) => `apps/${app}/**/*.{ts,tsx}`),
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: others.flatMap((app) => [
                  `@tp/${app}`,
                  `@tp/${app}/*`,
                  `**/apps/${app}/**`,
                  `../../${app}/**`,
                ]),
                message: `The ${name} product may not import another product (CLAUDE.md rule 1). Use docs/CONTRACT.md.`,
              },
            ],
          },
        ],
      },
    };
  });
}
