import { useEffect, useRef, useState } from 'react';

/** True when the operating system asks for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  return reduced;
}

/**
 * Latches true once the element has been reached, and stays true.
 *
 * Deliberately a geometry check on scroll rather than an IntersectionObserver.
 * A jump — a nav anchor, a deep link, a restored scroll position — moves past
 * elements without ever intersecting, and the observer reports
 * `isIntersecting: false` for every one of them. Latching only on
 * intersection therefore leaves everything skipped over stuck at `opacity: 0`
 * permanently, so clicking "Plans" in the nav lands on a blank screen. This is
 * a handful of rects on a passive scroll listener; the cost is nothing and it
 * cannot miss.
 */
export function useInView<T extends HTMLElement>(
  _margin = '0px 0px -18% 0px',
): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;

    const check = () => {
      if (done || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      // entered from below, or already scrolled past — either way, reached
      if (r.top < window.innerHeight * 0.92) {
        done = true;
        setSeen(true);
        window.removeEventListener('scroll', check);
        window.removeEventListener('resize', check);
      }
    };

    check();
    // one more after layout settles, for fonts and late-measured sections
    const raf = requestAnimationFrame(check);
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return [ref, seen];
}

/**
 * Advances an integer 0..steps once per `interval`, starting when `armed`.
 * `lastHold` adds a beat before the final step, so a traversal lands on its
 * verdict rather than sliding into it.
 * With reduced motion it reports the final value immediately.
 */
export function useStepper(
  steps: number,
  interval: number,
  armed: boolean,
  lastHold = 0,
): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!armed) return;
    if (reduced) {
      setN(steps);
      return;
    }
    setN(0);
    const timers: number[] = [];
    for (let k = 1; k <= steps; k += 1) {
      const at = k * interval + (k === steps ? lastHold : 0);
      timers.push(window.setTimeout(() => setN(k), at));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [steps, interval, armed, reduced, lastHold]);

  return n;
}

/**
 * Latches true `ms` after `active` first goes true, and stays true. Used to
 * space the two traversals apart so they read as a sequence, not a chorus.
 * With reduced motion the wait is skipped — the final state is the point.
 */
export function useHold(active: boolean, ms: number): boolean {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!active || on) return;
    if (reduced) {
      setOn(true);
      return;
    }
    const t = window.setTimeout(() => setOn(true), ms);
    return () => window.clearTimeout(t);
  }, [active, ms, reduced, on]);

  return on;
}
