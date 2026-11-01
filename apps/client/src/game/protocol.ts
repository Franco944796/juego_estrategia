import type { Command, DomainEvent, GameState, LordView, RuleError, SendPreview, Troops } from '@si/engine';

export const HUMAN_ID = 'you';

/** Index 0 is the player; the rest go to bots in order. */
export const LORD_COLORS = [
  '#ffd166',
  '#ef476f',
  '#06d6a0',
  '#4cc9f0',
  '#f78c6b',
  '#b388ff',
  '#f15bb5',
  '#8ac926',
  '#ff924c',
  '#00bbf9',
  '#e9c46a',
  '#c77dff',
];

export interface NewGameOptions {
  seed: number;
  humanName: string;
  botNames: string[];
}

export interface Save {
  version: 1;
  state: GameState;
  gameNow: number;
  speed: number;
}

export interface ClockInfo {
  gameNow: number;
  /** Game milliseconds per real millisecond; 0 while paused or after the season. */
  rate: number;
  speed: number;
  timeScale: number;
}

export type ToWorker =
  | { type: 'new'; options: NewGameOptions }
  | { type: 'load'; save: Save }
  | { type: 'command'; id: number; command: Command }
  | { type: 'preview'; id: number; from: number; to: number; troops: Troops }
  | { type: 'speed'; speed: number }
  | { type: 'save' };

export type FromWorker =
  | { type: 'view'; view: LordView; clock: ClockInfo }
  | { type: 'events'; events: DomainEvent[] }
  | { type: 'result'; id: number; error: RuleError | null }
  | { type: 'preview'; id: number; preview: SendPreview }
  | { type: 'save'; save: Save };
