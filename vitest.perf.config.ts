import { defineConfig } from 'vitest/config';

/** The performance budgets (#244), kept out of `npm test` because the sweep takes about a minute. */
export default defineConfig({
  test: {
    include: ['src/**/*.perf.ts'],
  },
});
