import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entry points, because the deployed image is one artefact that can boot either way.
  entry: ['src/main.ts', 'src/demo/main.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  /**
   * The workspace packages publish TypeScript source (`main: ./src/index.ts`), so leaving them
   * external produces a `dist` that only runs under tsx — which is to say a `pnpm start` that has
   * never worked. Bundling them is what makes `node dist/main.js` a real entry point, and that is
   * what the container runs: no pnpm, no corepack and no TypeScript loader at runtime.
   */
  noExternal: [/^@tp\//],
});
