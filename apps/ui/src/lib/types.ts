/**
 * UI-local view state. Everything that is not in the frozen AppState contract
 * lives here — the hop wave (an animation cursor), the current pipeline
 * selection (a WS message with no home in AppState), and the log tail.
 *
 * The component tree reads UiState and nothing else. It never knows whether
 * the messages came from a websocket or from fixture.ts.
 */
import type { AppState } from '@hopper/contracts';

/** honest transport state — the header renders this verbatim */
export type Mode = 'connecting' | 'live' | 'replay';

/** the `pipeline` ServerMessage payload, kept out of band of AppState */
export interface Selection {
  pipeline_id: string;
  name: string;
  success_rate: number;
  avg_latency: number;
  advisory_class: string;
  reason: string;
}

/**
 * The signature element's cursor. Rings arrive one at a time; `chain` is
 * pre-sized to `total` and fills left-to-right so the track can be drawn dim
 * before the wave reaches it.
 */
export interface HopWave {
  ghsa_id: string;
  total: number;
  chain: string[];
  arrived: number;
  suppressed: boolean;
  terminal: boolean;
  /** bumped on every new wave so the animation can be re-keyed / replayed */
  nonce: number;
}

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  seq: number;
}

export interface UiState {
  app: AppState;
  wave: HopWave | null;
  selection: Selection | null;
  prev_selection: Selection | null;
  /** increments on every pipeline message — drives the "it changed" flash */
  selection_seq: number;
  logs: LogLine[];
}
