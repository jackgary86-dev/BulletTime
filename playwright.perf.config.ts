import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** The frame-time budget (#244): same server and software WebGL as the visual tests, its own test folder. */
export default defineConfig({
  ...base,
  testDir: 'tests/perf',
  outputDir: 'test-results/perf-runs',
  reporter: 'list',
});
