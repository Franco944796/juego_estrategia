import { defaultConfig } from '@si/config';
import type { Command, DomainEvent, GameState, LordView, RuleError, SendPreview, Troops } from '@si/engine';
import type { ClockInfo } from '@si/protocol';

export type { ClockInfo };

export const HUMAN_ID = 'you';

/** Index 0 is the player; the rest go to bots in order. */
export const LORD_COLORS = defaultConfig.display.lordColors;

export interface NewGameOptions {
  seed: number;
  humanName: string;
  botNames: string[];
}

export interface Save {
  version: 2;
  state: GameState;
  gameNow: number;
  speed: number;
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
