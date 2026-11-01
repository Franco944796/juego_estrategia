import type { Command, DomainEvent, LordView, RuleError, SendPreview } from '@si/engine';
import type { ChatChannel, ChatMessage, ClientMessage, ClockInfo, ServerMessage } from '@si/protocol';
import type { GameClient } from './client';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
/** Close code the server uses for a bad token; reconnecting would not help. */
const UNAUTHORIZED = 4001;

export interface RemoteHandlers {
  onView(view: LordView, clock: ClockInfo): void;
  onEvents(events: DomainEvent[]): void;
  onSeason(news: Extract<ServerMessage, { type: 'season' }>): void;
  onConnection(connected: boolean): void;
  onChat(message: ChatMessage): void;
  onChatHistory(channel: ChatChannel, messages: ChatMessage[]): void;
  onClanChanged(): void;
}

/** The online world over WebSocket. Speed, saving and new games belong to the server, so they do nothing. */
export class RemoteGameClient implements GameClient {
  private socket: WebSocket | null = null;
  private closed = false;
  private retryMs = RECONNECT_MIN_MS;
  private nextId = 1;
  private readonly pending: ClientMessage[] = [];
  private readonly results = new Map<number, (error: RuleError | null) => void>();
  private readonly previews = new Map<number, (preview: SendPreview) => void>();

  constructor(
    private readonly url: string,
    private readonly handlers: RemoteHandlers,
  ) {
    this.connect();
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.retryMs = RECONNECT_MIN_MS;
      this.handlers.onConnection(true);
      for (const message of this.pending.splice(0)) socket.send(JSON.stringify(message));
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      switch (msg.type) {
        case 'view':
          this.handlers.onView(msg.view, msg.clock);
          return;
        case 'events':
          this.handlers.onEvents(msg.events);
          return;
        case 'season':
          this.handlers.onSeason(msg);
          return;
        case 'chat':
          this.handlers.onChat(msg.message);
          return;
        case 'chatHistory':
          this.handlers.onChatHistory(msg.channel, msg.messages);
          return;
        case 'clanChanged':
          this.handlers.onClanChanged();
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
    socket.onclose = (event) => {
      this.handlers.onConnection(false);
      if (this.closed || event.code === UNAUTHORIZED) return;
      setTimeout(() => {
        if (!this.closed) this.connect();
      }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
    };
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.pending.push(message);
  }

  start(): void {}

  load(): void {}

  setSpeed(): void {}

  requestSave(): void {}

  command(command: Command): Promise<RuleError | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.results.set(id, resolve);
      this.send({ type: 'command', id, command });
    });
  }

  preview(from: number, to: number, troops: number): Promise<SendPreview> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.previews.set(id, resolve);
      this.send({ type: 'preview', id, from, to, troops });
    });
  }

  sendChat(channel: ChatChannel, text: string): void {
    this.send({ type: 'chat', channel, text });
  }

  dispose(): void {
    this.closed = true;
    this.socket?.close();
  }
}
