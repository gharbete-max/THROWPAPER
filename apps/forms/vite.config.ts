import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4001', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  // The e2e suite drives a built app rather than the dev server, so preview needs the same proxy.
  preview: {
    port: 4173,
    proxy: { '/api': { target: 'http://localhost:4001', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});
