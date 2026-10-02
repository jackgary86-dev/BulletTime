/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so production builds use that base.
// Override with VITE_BASE (for example VITE_BASE=/ for a custom domain).
// `vite preview` serves the production build, so it needs the same base.
// The desktop app (`--mode desktop`, #38) loads the build from its own app:// origin, with relative URLs.
export default defineConfig(({ command, isPreview, mode }) => ({
  base: mode === 'desktop' ? './' : command === 'build' || isPreview ? (globalThis.process?.env.VITE_BASE ?? '/BulletTime/') : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
