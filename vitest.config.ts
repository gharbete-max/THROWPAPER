import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx}'],
    // api-forms reads .env at import time; tests inject their own config.
    env: { NODE_ENV: 'test' },
    // The proof test launches Chromium and renders a PDF — the phase 1 gate, and the slow one.
    testTimeout: 60_000,
    // e2e/ runs under Playwright, not vitest. `.claude/` holds agent git worktrees, each a full
    // copy of the source: `include` above is anchored at `{apps,packages}/*` and `scripts/` and
    // already misses them, but only by accident of the glob — say it, so a worktree's tests can
    // never silently double the count.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '.claude/**'],
    passWithNoTests: false,
  },
});
