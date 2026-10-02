/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so production builds use that base.
// Override with VITE_BASE (for example VITE_BASE=/ for a custom domain).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (globalThis.process?.env.VITE_BASE ?? '/BulletTime/') : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
