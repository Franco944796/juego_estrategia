import { defaultConfig, validateConfig } from '@si/config';
import { advanceTo, createGame, execute, previewSend, view, type GameState, type LordInit } from '@si/engine';
import {
  HUMAN_ID,
  LORD_COLORS,
  type FromWorker,
  type NewGameOptions,
  type Save,
  type ToWorker,
} from './protocol';

const config = validateConfig(defaultConfig);
const TICK_MS = 100;
const VIEW_EVERY_MS = 250;
const SAVE_EVERY_MS = 5000;

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

let state: GameState | null = null;
let gameNow = 0;
let speed = 1;
let lastReal = performance.now();
let lastView = 0;
let lastSave = 0;

function rate(s: GameState): number {
  return s.status === 'RUNNING' ? s.config.demo.timeScale * speed : 0;
}

function postView(s: GameState): void {
  scope.postMessage({
    type: 'view',
    view: view(s, HUMAN_ID, gameNow),
    clock: { gameNow, rate: rate(s), speed, timeScale: s.config.demo.timeScale },
  });
  lastView = performance.now();
}

function postSave(s: GameState): void {
  const save: Save = { version: 3, state: s, gameNow, speed };
  scope.postMessage({ type: 'save', save });
  lastSave = performance.now();
}

/** Moves the accelerated clock and runs every engine event that came due. */
function tick(force = false): void {
  const real = performance.now();
  const s = state;
  if (!s) return;
  gameNow = Math.min(s.endsAt, gameNow + (real - lastReal) * rate(s));
  lastReal = real;
  const events = advanceTo(s, gameNow);
  if (events.length > 0) scope.postMessage({ type: 'events', events });
  if (force || events.length > 0 || real - lastView >= VIEW_EVERY_MS) postView(s);
  if (real - lastSave >= SAVE_EVERY_MS || events.some((e) => e.type === 'SEASON_ENDED')) postSave(s);
}

function newGame(options: NewGameOptions): GameState {
  const { seed, humanName, botNames, armory } = options;
  const lords: LordInit[] = [
    { id: HUMAN_ID, name: humanName, color: LORD_COLORS[0] ?? '#fff', isBot: false, ...armory },
    ...botNames.map((name, i) => ({
      id: `bot${i + 1}`,
      name,
      color: LORD_COLORS[(i + 1) % LORD_COLORS.length] ?? '#fff',
      isBot: true,
    })),
  ];
  return createGame({ seed, config, startsAt: 0, lords });
}

scope.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'new':
      state = newGame(msg.options);
      gameNow = state.startsAt;
      speed = 1;
      lastReal = performance.now();
      tick(true);
      postSave(state);
      return;
    case 'load':
      state = msg.save.state;
      gameNow = msg.save.gameNow;
      speed = msg.save.speed;
      lastReal = performance.now();
      tick(true);
      return;
    case 'command': {
      if (!state) return;
      tick();
      const result = execute(state, HUMAN_ID, msg.command, gameNow);
      if (result.events.length > 0) scope.postMessage({ type: 'events', events: result.events });
      scope.postMessage({ type: 'result', id: msg.id, error: result.ok ? null : result.error });
      postView(state);
      return;
    }
    case 'preview':
      if (!state) return;
      scope.postMessage({
        type: 'preview',
        id: msg.id,
        preview: previewSend(state, HUMAN_ID, msg.from, msg.to, msg.troops, gameNow),
      });
      return;
    case 'speed':
      if (!state) return;
      tick();
      speed = msg.speed;
      postView(state);
      return;
    case 'save':
      if (state) postSave(state);
      return;
  }
};

setInterval(() => tick(), TICK_MS);
