import { defineConfig } from '@playwright/test';

/**
 * Visual regression screenshots (#243). `npm run visual` builds the site,
 * serves the production build and compares one frame per shot in
 * tests/visual/visual.spec.ts with the references next to it;
 * `npm run visual:update` rewrites the references on purpose.
 *
 * The 3D scene is drawn by SwiftShader (software WebGL), so the same
 * Chromium build gives the same pixels on any machine: @playwright/test is
 * pinned to an exact version for that reason.
 */
const PORT = 4174;

export default defineConfig({
  testDir: 'tests/visual',
  outputDir: 'test-results/visual',
  // Software rendering of a whole lab is slow; each shot loads the page afresh.
  timeout: 360_000,
  expect: {
    // One software-rendered frame of a large blast can take over a minute.
    timeout: 180_000,
    // A changed effect moves thousands of pixels; SwiftShader noise on a different CPU moves a handful.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2, animations: 'disabled' },
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'test-results/visual-report' }]] : 'list',
  snapshotPathTemplate: '{testDir}/references/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}/BulletTime/`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/BulletTime/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
