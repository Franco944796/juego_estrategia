import type { LordView } from '@si/engine';
import { create } from 'zustand';
import type { ClockInfo } from './game/protocol';
import { detectLang, type Lang } from './i18n';

export type Panel = 'marches' | 'reports' | 'ranking' | 'edicts' | 'menu';
export type Tone = 'info' | 'good' | 'bad';

export interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

export interface Clock extends ClockInfo {
  /** performance.now() when the clock arrived, to extrapolate game time between views. */
  receivedAt: number;
}

export interface GameStore {
  lang: Lang;
  screen: 'title' | 'game';
  view: LordView | null;
  clock: Clock;
  selected: number | null;
  /** Waiting for the player to tap a destination for the selected town. */
  picking: boolean;
  send: { from: number; to: number } | null;
  panel: Panel | null;
  toasts: Toast[];
  tutorial: number | null;
  setLang(lang: Lang): void;
  setScreen(screen: 'title' | 'game'): void;
  receiveView(view: LordView, clock: ClockInfo): void;
  select(townId: number | null): void;
  startPicking(): void;
  openSend(from: number, to: number): void;
  closeSheet(): void;
  setPanel(panel: Panel | null): void;
  pushToast(text: string, tone?: Tone): void;
  dismissToast(id: number): void;
  setTutorial(step: number | null): void;
  reset(): void;
}

const TOAST_MS = 4500;
const MAX_TOASTS = 4;
let toastId = 1;

const idleClock: Clock = { gameNow: 0, rate: 0, speed: 1, timeScale: 1, receivedAt: 0 };

export const useGame = create<GameStore>()((set, get) => ({
  lang: detectLang(),
  screen: 'title',
  view: null,
  clock: idleClock,
  selected: null,
  picking: false,
  send: null,
  panel: null,
  toasts: [],
  tutorial: null,
  setLang: (lang) => set({ lang }),
  setScreen: (screen) => set({ screen }),
  receiveView: (view, clock) => set({ view, clock: { ...clock, receivedAt: performance.now() } }),
  select: (townId) => set({ selected: townId, picking: false, send: null, panel: null }),
  startPicking: () => set({ picking: true, send: null }),
  openSend: (from, to) => set({ send: { from, to }, picking: false, selected: from, panel: null }),
  closeSheet: () => set({ selected: null, picking: false, send: null }),
  setPanel: (panel) => set({ panel, picking: false, send: null, selected: null }),
  pushToast: (text, tone = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-MAX_TOASTS) });
    setTimeout(() => get().dismissToast(id), TOAST_MS);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  setTutorial: (tutorial) => set({ tutorial }),
  reset: () =>
    set({
      view: null,
      clock: idleClock,
      selected: null,
      picking: false,
      send: null,
      panel: null,
      toasts: [],
    }),
}));

/** Game time now, extrapolated from the last clock the worker sent. */
export function estimateGameNow(clock: Clock, endsAt: number): number {
  return Math.min(endsAt, clock.gameNow + (performance.now() - clock.receivedAt) * clock.rate);
}

/** Converts a game duration to real milliseconds at the current speed (base speed while paused). */
export function toRealMs(clock: Clock, gameMs: number): number {
  const rate = clock.rate > 0 ? clock.rate : clock.timeScale;
  return gameMs / rate;
}
