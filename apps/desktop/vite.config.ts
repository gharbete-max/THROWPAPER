import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The shell's own small window — first run and settings — loaded from disk with `loadFile`, so
 * every URL in it is relative (`base: './'`). Its output goes straight into the staging folder
 * `scripts/build.ts` packages.
 */
export default defineConfig({
  root: 'src/panel',
  base: './',
  plugins: [react()],
  build: { outDir: '../../.stage/panel', emptyOutDir: true, target: 'chrome130' },
});
