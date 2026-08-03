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

/** Latches true the first time the element crosses into view and stays true. */
export function useInView<T extends HTMLElement>(
  margin = '0px 0px -18% 0px',
): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: margin, threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);

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
