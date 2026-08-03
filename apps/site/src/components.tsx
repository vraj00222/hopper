import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { fmtCountdown, isoPlusHours, secondsUntil } from '@hopper/contracts';
import type { HopRow } from './data';
import { SECTIONS } from './data';
import { useInView, useReducedMotion } from './hooks';

/* ── section reveal ───────────────────────────────────────────────────────── */

export function Rise({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`rise ${seen ? 'is-on' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* ── rail: the document rendered as a scale ───────────────────────────────── */

export function Rail() {
  const [marks, setMarks] = useState<{ id: string; label: string; at: number }[]>([]);
  const [pos, setPos] = useState(0);
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  useLayoutEffect(() => {
    const measure = () => {
      const doc = Math.max(document.body.scrollHeight - window.innerHeight, 1);
      setMarks(
        SECTIONS.map((s) => {
          const el = document.getElementById(s.id);
          const top = el ? el.getBoundingClientRect().top + window.scrollY - 70 : 0;
          return { id: s.id, label: s.label, at: Math.min(Math.max(top / doc, 0), 1) };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const doc = Math.max(document.body.scrollHeight - window.innerHeight, 1);
      setPos(Math.min(Math.max(window.scrollY / doc, 0), 1));
      let cur: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) cur = s.id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [marks.length]);

  const span = (f: number) => `calc(40px + ${f} * (100% - 80px))`;

  return (
    <div className="rail" aria-hidden="true">
      <div className="rail__axis" />
      {marks.map((m) => (
        <button
          key={m.id}
          type="button"
          tabIndex={-1}
          className={`rail__tick ${active === m.id ? 'is-on' : ''}`}
          style={{ top: span(m.at) }}
          onClick={() =>
            document.getElementById(m.id)?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          {m.label}
        </button>
      ))}
      <div className="rail__cursor" style={{ top: span(pos) }} />
    </div>
  );
}

/* ── hop track ────────────────────────────────────────────────────────────── */

export type Terminal = 'breach' | 'clear';

export function HopTrack({
  rows,
  reached,
  terminal,
}: {
  rows: HopRow[];
  reached: number;
  terminal: Terminal;
}) {
  return (
    <div className="hops">
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        let state = '';
        if (i < reached - 1) state = 'is-passed';
        else if (i === reached - 1)
          state = last ? (terminal === 'breach' ? 'is-end' : 'is-stop') : 'is-live';
        // A band spans a run of rows; label it once, where it starts.
        const opens = r.band !== '—' && (i === 0 || rows[i - 1].band !== r.band);
        return (
          <div className={`hop ${state}`} key={`${r.name}-${i}`}>
            <span className="hop__band">{opens ? r.band : ''}</span>
            <span className="hop__node">
              <span className="hop__mark" />
            </span>
            <span className="hop__text">
              <span className="hop__name">{r.name}</span>
              <span className="hop__meta">{r.meta}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── countdown ────────────────────────────────────────────────────────────── */

export function Countdown({ hours, live }: { hours: number; live: boolean }) {
  const deadline = useMemo(() => isoPlusHours(hours), [hours]);
  const [secs, setSecs] = useState(() => secondsUntil(deadline));
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!live || reduced) return;
    const t = window.setInterval(() => setSecs(secondsUntil(deadline)), 1000);
    return () => window.clearInterval(t);
  }, [deadline, live, reduced]);

  const clock = fmtCountdown(secs).replace('T-', '');
  const due = deadline.replace('T', ' ').replace(/\.\d+Z$/, 'Z');

  return (
    <>
      <span className="clock num">{clock}</span>
      <span className="clock__foot">
        due <b>{due}</b>
      </span>
    </>
  );
}
