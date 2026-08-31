import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx}'],
    // The proof test launches Chromium and renders a PDF — the phase 1 gate, and the slow one.
    testTimeout: 60_000,
    passWithNoTests: false,
  },
});
