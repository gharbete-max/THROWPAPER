import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx}'],
    // api-forms reads .env at import time; tests inject their own config.
    env: { NODE_ENV: 'test' },
    // The proof test launches Chromium and renders a PDF — the phase 1 gate, and the slow one.
    testTimeout: 60_000,
    // e2e/ runs under Playwright, not vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    passWithNoTests: false,
  },
});
