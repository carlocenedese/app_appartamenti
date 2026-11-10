import { defineConfig } from 'vitest/config';

// One run for the whole workspace: every package with its own vitest config, plus the
// tests of the repository scripts. The coverage threshold applies to the pure core only.
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 90 },
    },
  },
});
