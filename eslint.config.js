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
      '**/coverage/**',
      '**/node_modules/**',
      '**/drizzle/**',
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
    files: ['apps/forms/**/*.tsx', 'apps/mailer/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
