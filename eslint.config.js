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
);

/**
 * One block per product: its frontend and backend may import each other's *packages* (`@tp/*` in
 * `packages/`), never another product's app — by package name or by relative path.
 */
function productBoundaries() {
  const products = {
    // `desktop` is Forms in a window (ADR 0016): it may run api-forms, never Mailer or Sign.
    forms: ['forms', 'api-forms', 'desktop'],
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
