import type { Command, DomainEvent, LordView, RuleError, SendPreview, Troops } from '@si/engine';
import type { ClockInfo, FromWorker, NewGameOptions, Save, ToWorker } from './protocol';
import EngineWorker from './worker?worker&inline';

export interface GameHandlers {
  onView(view: LordView, clock: ClockInfo): void;
  onEvents(events: DomainEvent[]): void;
  onSave(save: Save): void;
}

/** What the UI talks to. A future RemoteGameClient would implement it over REST + WebSocket. */
export interface GameClient {
  start(options: NewGameOptions): void;
  load(save: Save): void;
  command(command: Command): Promise<RuleError | null>;
  preview(from: number, to: number, troops: Troops): Promise<SendPreview>;
  setSpeed(speed: number): void;
  requestSave(): void;
  dispose(): void;
}

/** Engine and bots in a Web Worker with an accelerated clock: the offline single-player game. */
export class LocalGameClient implements GameClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly results = new Map<number, (error: RuleError | null) => void>();
  private readonly previews = new Map<number, (preview: SendPreview) => void>();

  constructor(handlers: GameHandlers) {
    this.worker = new EngineWorker();
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'view':
          handlers.onView(msg.view, msg.clock);
          return;
        case 'events':
          handlers.onEvents(msg.events);
          return;
        case 'save':
          handlers.onSave(msg.save);
          return;
        case 'result':
          this.results.get(msg.id)?.(msg.error);
          this.results.delete(msg.id);
          return;
        case 'preview':
          this.previews.get(msg.id)?.(msg.preview);
          this.previews.delete(msg.id);
          return;
      }
    };
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  start(options: NewGameOptions): void {
    this.post({ type: 'new', options });
  }

  load(save: Save): void {
    this.post({ type: 'load', save });
  }

  command(command: Command): Promise<RuleError | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.results.set(id, resolve);
      this.post({ type: 'command', id, command });
    });
  }

  preview(from: number, to: number, troops: Troops): Promise<SendPreview> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.previews.set(id, resolve);
      this.post({ type: 'preview', id, from, to, troops });
    });
  }

  setSpeed(speed: number): void {
    this.post({ type: 'speed', speed });
  }

  requestSave(): void {
    this.post({ type: 'save' });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
