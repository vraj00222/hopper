/**
 * The light switch.
 *
 * Dark is the instrument's resting state and the only state a first load can
 * produce — the console is presented on dark, and nothing here is allowed to
 * change that under a presenter. Light is opt-in, remembered, and nothing more.
 *
 * The mechanism is one attribute: `:root[data-theme='light']` in styles.css
 * carries the whole palette. The wrinkle is that main.tsx writes the contract's
 * PALETTE onto :root as *inline* properties, and an inline property beats a
 * stylesheet rule — so switching to light has to take those six back off, and
 * switching to dark has to put them back. That keeps @hopper/contracts the
 * source of truth for dark while letting the stylesheet own light.
 */
import { PALETTE } from '@hopper/contracts';

export type Theme = 'dark' | 'light';

const KEY = 'hopper.theme';

/** localStorage throws in a locked-down browser; a theme is never worth a crash */
function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* nothing to do — the session keeps the theme, the next one starts dark */
  }
}

/** anything that is not the exact string 'light' is dark. No system sniffing:
 *  a machine that happens to prefer light must not restage the demo. */
export function storedTheme(): Theme {
  return read() === 'light' ? 'light' : 'dark';
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, persist = true): void {
  const root = document.documentElement;
  root.dataset.theme = theme;

  if (theme === 'light') {
    for (const name of Object.keys(PALETTE)) root.style.removeProperty(`--${name}`);
  } else {
    for (const [name, value] of Object.entries(PALETTE)) {
      root.style.setProperty(`--${name}`, value);
    }
  }

  if (persist) write(theme);
}

/** boot: adopt what was stored, and store nothing that was not already chosen */
export function bootTheme(): Theme {
  const theme = storedTheme();
  applyTheme(theme, false);
  return theme;
}
