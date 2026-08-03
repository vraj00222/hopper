/**
 * useHopper — the one data hook.
 *
 * It tries ws://localhost:8787/ws. If a server is there, live messages drive
 * the reducer. If not, the scripted timeline in fixture.ts drives the exact
 * same reducer with the exact same message shapes. The component tree cannot
 * tell which, and the header never claims "live" when it is replaying.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { API_PORT, DEFAULT_APPROVER, WS_PATH } from '@hopper/contracts';
import type { ClientMessage, ServerMessage } from '@hopper/contracts';
import { BEATS, INITIAL_STATE, beat as beatOf } from '../fixture.js';
import { approvalMessages, initialUi, reduce, reduceAll, tickMessages } from './reducer.js';
import type { Mode, UiState } from './types.js';

export const WS_URL = `ws://localhost:${API_PORT}${WS_PATH}`;

type Action =
  | { kind: 'msg'; msg: ServerMessage }
  | { kind: 'msgs'; msgs: ServerMessage[] }
  | { kind: 'tick' }
  | { kind: 'approve'; id: string; approver: string }
  | { kind: 'reset' };

function root(state: UiState, action: Action): UiState {
  switch (action.kind) {
    case 'msg':
      return reduce(state, action.msg);
    case 'msgs':
      return reduceAll(state, action.msgs);
    case 'tick':
      return reduceAll(state, tickMessages(state));
    case 'approve':
      return reduceAll(state, approvalMessages(state, action.id, action.approver));
    case 'reset':
      return initialUi(INITIAL_STATE);
    default:
      return state;
  }
}

function env(key: string): string | undefined {
  const meta = import.meta as unknown as { env?: Record<string, string> };
  return meta.env?.[key];
}

function flag(key: string, param: string): boolean {
  if (env(key) === '1' || env(key) === 'true') return true;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has(param)) return true;
  return false;
}

/** 0, 2s, 4s, 8s, 15s, 15s… */
function backoff(attempt: number): number {
  return Math.min(15_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}

export interface Hopper {
  ui: UiState;
  mode: Mode;
  /** which scripted beat is playing, or null between beats */
  activeBeat: number | null;
  playedBeats: number[];
  send: (msg: ClientMessage) => void;
  runBeat: (step: number) => void;
  advance: () => void;
  reset: () => void;
  reducedMotion: boolean;
}

export function useHopper(): Hopper {
  const [ui, dispatch] = useReducer(root, INITIAL_STATE, initialUi);
  const [mode, setMode] = useState<Mode>(() => (flag('VITE_FIXTURE', 'fixture') ? 'replay' : 'connecting'));
  const [activeBeat, setActiveBeat] = useState<number | null>(null);
  const [playedBeats, setPlayedBeats] = useState<number[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  const timers = useRef<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  // ── the offline driver: play a scripted beat on wall-clock timers ────────
  const runBeat = useCallback(
    (step: number) => {
      if (modeRef.current === 'live' && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'demo', step } satisfies ClientMessage));
        setActiveBeat(step);
        return;
      }
      const b = beatOf(step);
      if (!b) return;
      clearTimers();
      setActiveBeat(step);
      setPlayedBeats((prev) => (prev.includes(step) ? prev : [...prev, step]));
      for (const c of b.cues) {
        timers.current.push(
          window.setTimeout(() => dispatch({ kind: 'msg', msg: c.msg }), c.at),
        );
      }
      timers.current.push(window.setTimeout(() => setActiveBeat(null), b.duration));
    },
    [clearTimers],
  );

  const advance = useCallback(() => {
    setPlayedBeats((prev) => {
      const next = BEATS.find((b) => !prev.includes(b.step))?.step ?? 1;
      window.setTimeout(() => runBeat(next), 0);
      return prev;
    });
  }, [runBeat]);

  const reset = useCallback(() => {
    clearTimers();
    setActiveBeat(null);
    setPlayedBeats([]);
    dispatch({ kind: 'reset' });
  }, [clearTimers]);

  // ── websocket, with backoff. Fixture drives whenever it is not open ──────
  useEffect(() => {
    if (flag('VITE_FIXTURE', 'fixture')) return undefined;

    let attempt = 0;
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      if (closed) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(WS_URL);
      } catch {
        schedule();
        return;
      }
      wsRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        clearTimers();
        setMode('live');
        socket.send(JSON.stringify({ type: 'subscribe' } satisfies ClientMessage));
      };
      socket.onmessage = (ev) => {
        try {
          dispatch({ kind: 'msg', msg: JSON.parse(String(ev.data)) as ServerMessage });
        } catch {
          /* a malformed frame is not worth taking the room down for */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        setMode('replay');
        schedule();
      };
    };

    const schedule = () => {
      attempt += 1;
      retry = window.setTimeout(connect, backoff(attempt));
    };

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [clearTimers]);

  // ── autoplay beat 1 so the room is never dead on arrival ────────────────
  const autoplayed = useRef(false);
  useEffect(() => {
    if (mode !== 'replay' || autoplayed.current) return undefined;
    autoplayed.current = true;
    const t = window.setTimeout(() => runBeat(1), 700);
    return () => window.clearTimeout(t);
  }, [mode, runBeat]);

  // ── 1Hz obligation clock, offline only (a live server sends its own) ────
  useEffect(() => {
    if (mode === 'live') return undefined;
    const i = window.setInterval(() => dispatch({ kind: 'tick' }), 1_000);
    return () => window.clearInterval(i);
  }, [mode]);

  useEffect(() => clearTimers, [clearTimers]);

  // ── the presenter's hands ───────────────────────────────────────────────
  const send = useCallback(
    (msg: ClientMessage) => {
      if (modeRef.current === 'live' && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
        return;
      }
      if (msg.type === 'approve') {
        dispatch({ kind: 'approve', id: msg.approval_id, approver: msg.approver || DEFAULT_APPROVER });
        return;
      }
      if (msg.type === 'demo') runBeat(msg.step ?? 1);
    },
    [runBeat],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        send({ type: 'demo', step: Number(e.key) });
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send, reset, advance]);

  return useMemo(
    () => ({ ui, mode, activeBeat, playedBeats, send, runBeat, advance, reset, reducedMotion }),
    [ui, mode, activeBeat, playedBeats, send, runBeat, advance, reset, reducedMotion],
  );
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
