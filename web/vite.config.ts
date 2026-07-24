import { fileURLToPath } from 'url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** @poc/core is pure TS source — alias it so Vite compiles it with the app. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@poc/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      /** API + data slices served by @poc/server (default 8788). */
      '/api': 'http://127.0.0.1:8788',
    },
  },
});
