import React from 'react';
import { createRoot } from 'react-dom/client';
import { PALETTE } from '@hopper/contracts';
import { App } from './App.js';
import './styles.css';

/**
 * The palette is written onto :root from the contract. Nothing in the CSS
 * hand-types a hex — every other colour in the stylesheet is a color-mix of
 * these six.
 */
for (const [name, value] of Object.entries(PALETTE)) {
  document.documentElement.style.setProperty(`--${name}`, value);
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
