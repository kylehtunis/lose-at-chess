import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// In development the Worker runs separately under wrangler; the API and
// WebSocket routes are proxied to it so the client can use relative URLs.
const WORKER_ORIGIN = 'http://localhost:8787';

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': WORKER_ORIGIN,
      '/ws': { target: WORKER_ORIGIN, ws: true },
    },
  },
});
