import React from 'react';
import { createRoot } from 'react-dom/client';
import { PALETTE } from '@hopper/contracts';
import { App } from './App.js';
import { bootTheme } from './lib/theme.js';
import './styles.css';

/**
 * The dark palette is written onto :root from the contract, which stays the
 * source of truth for the instrument's resting state. styles.css declares the
 * same six so the first paint is already dark with no JS, and carries the light
 * table under `:root[data-theme='light']`.
 *
 * Dark on a fresh browser, always: bootTheme only adopts a theme somebody
 * chose, and it never reads the OS preference.
 */
bootTheme();

/** the mark: a wave leaving a package, and the clause it lands on */
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" fill="${PALETTE.ground}"/>` +
    `<circle cx="9" cy="16" r="2.8" fill="${PALETTE.signal}"/>` +
    `<circle cx="9" cy="16" r="7" fill="none" stroke="${PALETTE.signal}" stroke-width="1.4" opacity="0.6"/>` +
    `<circle cx="9" cy="16" r="11.5" fill="none" stroke="${PALETTE.signal}" stroke-width="1.2" opacity="0.3"/>` +
    `<path d="M25.5 9 L30 22 L21 22 Z" fill="${PALETTE.breach}"/>` +
    `</svg>`,
)}`;
document.head.appendChild(favicon);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
