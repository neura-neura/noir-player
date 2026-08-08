import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@noir-player/plugin-api': path.resolve(rootDir, 'packages/plugin-api/src/index.ts'),
      '@noir-player/plugin-test-utils': path.resolve(rootDir, 'packages/plugin-test-utils/src/index.ts'),
      '@noir-player/plugin-playback-stats': path.resolve(rootDir, 'packages/plugin-playback-stats/src/index.tsx'),
      '@noir-player/plugin-mpv-lab': path.resolve(rootDir, 'packages/plugin-mpv-lab/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        lines: 55,
        functions: 50,
        branches: 45,
        statements: 55,
      },
      exclude: ['packages/plugin-test-utils/**', 'tests/**', 'src/main.tsx'],
    },
  },
});
