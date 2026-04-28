import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const host = process.env.TAURI_DEV_HOST || '127.0.0.1';

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
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
  },
});
