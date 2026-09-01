import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Read from the token JSON rather than importing @tp/tokens: Vite loads this config outside the
 * workspace's module resolution, so the package's source entry point is not reachable here. Still
 * one source of truth — just read as data.
 */
const defaultTokens = JSON.parse(
  readFileSync(new URL('../../packages/tokens/src/default-tokens.json', import.meta.url), 'utf8'),
) as { colour: { primary: string; background: string } };

export default defineConfig({
  plugins: [
    react(),
    /**
     * Installable, and able to open on a venue's bad wifi.
     *
     * Precaching the shell only — **not** offline submission. An offline queue belongs to the
     * mobile app, and the check-in endpoint's idempotency is what will make it cheap when it
     * arrives (START-HERE §In scope).
     *
     * `autoUpdate` with `skipWaiting` on purpose: a door screen serving a stale bundle during an
     * event is a worse failure than a reload.
     */
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Never cache the API: a cached registration count or attendee list is actively misleading.
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        name: 'Formwork',
        short_name: 'Formwork',
        description: 'Forms, registrations and check-in',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: defaultTokens.colour.background,
        theme_color: defaultTokens.colour.primary,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
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
