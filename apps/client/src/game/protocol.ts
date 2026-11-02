import { defaultConfig } from '@si/config';
import type {
  Command,
  DomainEvent,
  GroupPreview,
  GameState,
  GearSlot,
  Item,
  LordView,
  RuleError,
  SendPreview,
} from '@si/engine';
import type { ClockInfo } from '@si/protocol';

export type { ClockInfo };

export const HUMAN_ID = 'you';

/** Index 0 is the player; the rest go to bots in order. */
export const LORD_COLORS = defaultConfig.display.lordColors;

export interface NewGameOptions {
  seed: number;
  humanName: string;
  botNames: string[];
  /** The player's equipment, kept in the browser from one demo game to the next. */
  armory: Armory;
}

export interface Armory {
  items: Item[];
  gear: Partial<Record<GearSlot, string>>;
}

export interface Save {
  version: 5;
  state: GameState;
  gameNow: number;
  speed: number;
}

export type ToWorker =
  | { type: 'new'; options: NewGameOptions }
  | { type: 'load'; save: Save }
  | { type: 'command'; id: number; command: Command }
  | { type: 'preview'; id: number; from: number; to: number; troops: number }
  | { type: 'previewGroup'; id: number; from: number[]; to: number }
  | { type: 'speed'; speed: number }
  | { type: 'save' };

export type FromWorker =
  | { type: 'view'; view: LordView; clock: ClockInfo }
  | { type: 'events'; events: DomainEvent[] }
  | { type: 'result'; id: number; error: RuleError | null }
  | { type: 'preview'; id: number; preview: SendPreview }
  | { type: 'previewGroup'; id: number; preview: GroupPreview }
  | { type: 'save'; save: Save };
