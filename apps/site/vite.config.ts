import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PALETTE } from '../../contracts/src/demo';

const contractsEntry = fileURLToPath(
  new URL('../../contracts/src/index.ts', import.meta.url),
);

/**
 * The palette is contract, not decoration. It is injected into the document
 * head at transform time so the first painted frame is already correct and no
 * hex value is ever hand-typed in CSS.
 */
const paletteVars = `:root{--c-ground:${PALETTE.ground};--c-bone:${PALETTE.paper};--c-muted:${PALETTE.muted};--c-signal:${PALETTE.signal};--c-breach:${PALETTE.breach};--c-clear:${PALETTE.clear};}html{background:${PALETTE.ground};}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'hopper-palette',
      transformIndexHtml() {
        return [
          {
            tag: 'style',
            attrs: { 'data-hopper-palette': '' },
            children: paletteVars,
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  ],
  resolve: {
    alias: { '@hopper/contracts': contractsEntry },
  },
  server: { port: 5174 },
});
