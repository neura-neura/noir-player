import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const host = process.env.TAURI_DEV_HOST || '127.0.0.1';
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  clearScreen: false,
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
  server: {
    host,
    port: 1420,
    strictPort: true,
  },
  preview: {
    host,
    port: 1420,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    target: ['es2022', 'chrome105', 'safari13'],
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'subtitle-sanitizer',
              test: /node_modules[\\/]dompurify/,
              priority: 20,
            },
            {
              name: 'subtitle-archive',
              test: /node_modules[\\/]jszip/,
              priority: 20,
            },
            {
              name: 'subtitle-encoding',
              test: /node_modules[\\/]jschardet/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
