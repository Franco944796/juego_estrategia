import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: Number.MAX_SAFE_INTEGER },
  worker: { format: 'iife' },
  // `pnpm dev` talks to a local `pnpm serve` for the online world.
  server: {
    proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
