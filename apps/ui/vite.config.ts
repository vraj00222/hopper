import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { UI_PORT } from '../../contracts/src/api.js';

/**
 * `@hopper/contracts` ships TypeScript source, not a build. Aliasing it to the
 * source entry keeps Vite from trying to pre-bundle a .ts file out of
 * node_modules, and means the UI compiles against the same frozen types the
 * rest of the repo does.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hopper/contracts': fileURLToPath(new URL('../../contracts/src/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: { exclude: ['@hopper/contracts'] },
  server: { port: UI_PORT, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
