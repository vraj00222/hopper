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
 * With reduced motion it reports the final value immediately.
 */
export function useStepper(steps: number, interval: number, armed: boolean): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!armed) return;
    if (reduced) {
      setN(steps);
      return;
    }
    let i = 0;
    setN(0);
    const t = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps) window.clearInterval(t);
    }, interval);
    return () => window.clearInterval(t);
  }, [steps, interval, armed, reduced]);

  return n;
}
