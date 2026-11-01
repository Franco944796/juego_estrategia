import { defaultConfig } from '@si/config';
import type { Command, DomainEvent, LordView, SendPreview, Troops } from '@si/engine';
import { formatDuration } from '../format';
import { BOT_NAMES, RULE_TEXT, t, WIND_NAMES } from '../i18n';
import { toRealMs, useGame } from '../store';
import { townLabel } from '../ui/labels';
import { LocalGameClient, type GameClient } from './client';
import { HUMAN_ID, type Save } from './protocol';

const SAVE_KEY = 'shattered-isles:save:v1';
const LANG_KEY = 'shattered-isles:lang';
const TUTORIAL_KEY = 'shattered-isles:tutorial-done';

let client: GameClient | null = null;
let speedBeforeHide: number | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Storage can be full or blocked; the game keeps running without saving.
  }
}

export function readSave(): Save | null {
  const raw = read(SAVE_KEY);
  if (!raw) return null;
  try {
    const save = JSON.parse(raw) as Save;
    return save.version === 1 && save.state.status === 'RUNNING' ? save : null;
  } catch {
    return null;
  }
}

export function savedLang(): 'es' | 'en' | null {
  const lang = read(LANG_KEY);
  return lang === 'es' || lang === 'en' ? lang : null;
}

export function rememberLang(lang: 'es' | 'en'): void {
  write(LANG_KEY, lang);
}

function ensureClient(): GameClient {
  client ??= new LocalGameClient({
    onView: (view, clock) => useGame.getState().receiveView(view, clock),
    onEvents: (events) => notify(events),
    onSave: (save) => write(SAVE_KEY, JSON.stringify(save)),
  });
  return client;
}

export function startNewGame(bots: number): void {
  const { lang } = useGame.getState();
  useGame.getState().reset();
  ensureClient().start({
    // The engine is seeded; picking the seed itself may use real randomness.
    seed: Math.floor(Math.random() * 2 ** 31),
    humanName: t(lang, 'defaultName'),
    botNames: BOT_NAMES[lang].slice(0, bots),
  });
  useGame.setState({ screen: 'game', tutorial: read(TUTORIAL_KEY) ? null : 0 });
}

export function continueGame(): boolean {
  const save = readSave();
  if (!save) return false;
  useGame.getState().reset();
  ensureClient().load(save);
  useGame.setState({ screen: 'game', tutorial: null });
  return true;
}

export function abandonGame(): void {
  write(SAVE_KEY, null);
  useGame.getState().reset();
  useGame.setState({ screen: 'title', tutorial: null });
}

export function finishTutorial(): void {
  write(TUTORIAL_KEY, '1');
  useGame.getState().setTutorial(null);
}

export async function command(cmd: Command): Promise<boolean> {
  const error = await ensureClient().command(cmd);
  if (error) {
    const { lang, pushToast } = useGame.getState();
    pushToast(RULE_TEXT[lang][error.code] ?? error.message, 'bad');
    return false;
  }
  return true;
}

export function preview(from: number, to: number, troops: Troops): Promise<SendPreview> {
  return ensureClient().preview(from, to, troops);
}

export function setSpeed(speed: number): void {
  ensureClient().setSpeed(speed);
}

/** Pauses while the page is hidden, so a background tab does not lose the season. */
export function watchVisibility(): () => void {
  const onChange = (): void => {
    if (!client || useGame.getState().screen !== 'game') return;
    if (document.hidden) {
      speedBeforeHide = useGame.getState().clock.speed;
      client.setSpeed(0);
      client.requestSave();
    } else if (speedBeforeHide !== null) {
      client.setSpeed(speedBeforeHide);
      speedBeforeHide = null;
    }
  };
  const onHide = (): void => client?.requestSave();
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('pagehide', onHide);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('pagehide', onHide);
  };
}

function lordName(view: LordView, id: string | null): string {
  const lang = useGame.getState().lang;
  if (id === null) return t(lang, 'neutral');
  return view.lords.find((l) => l.id === id)?.name ?? id;
}

/** Turns engine events that concern the player into toasts and tutorial progress. */
function notify(events: DomainEvent[]): void {
  const store = useGame.getState();
  const { lang, view, pushToast } = store;
  if (!view) return;
  const town = (id: number): string => townLabel(lang, view, id);
  for (const e of events) {
    switch (e.type) {
      case 'MARCH_LAUNCHED': {
        const target = view.towns.find((x) => x.id === e.march.to);
        if (e.march.owner === HUMAN_ID) {
          if (store.tutorial === 2) store.setTutorial(3);
        } else if (target?.owner === HUMAN_ID) {
          const eta = formatDuration(toRealMs(store.clock, e.march.arriveAt - e.at));
          pushToast(
            t(lang, 'toastIncoming', { name: lordName(view, e.march.owner), town: town(e.march.to), t: eta }),
            'bad',
          );
        }
        break;
      }
      case 'BATTLE': {
        const r = e.report;
        if (r.attacker === HUMAN_ID) {
          if (r.captured) pushToast(t(lang, 'toastTook', { town: town(r.townId) }), 'good');
          else if (r.winner === 'DEFENDER')
            pushToast(t(lang, 'toastFailed', { town: town(r.townId) }), 'bad');
        } else if (r.defender === HUMAN_ID) {
          if (r.captured) pushToast(t(lang, 'toastLost', { town: town(r.townId) }), 'bad');
          else if (r.winner === 'DEFENDER')
            pushToast(t(lang, 'toastDefended', { town: town(r.townId) }), 'good');
        }
        break;
      }
      case 'BEACON_CHANGED': {
        const before = view.isles.find((i) => i.id === e.isleId)?.beaconOwner;
        if (e.owner === HUMAN_ID) pushToast(t(lang, 'toastBeacon'), 'good');
        else if (before === HUMAN_ID) pushToast(t(lang, 'toastBeaconLost'), 'bad');
        break;
      }
      case 'WIND_SHIFTED':
        pushToast(t(lang, 'toastWind', { dir: WIND_NAMES[lang][e.dir] ?? '' }));
        break;
      case 'THRONE_UNSEALED':
        pushToast(t(lang, 'toastThrone'), 'good');
        break;
      case 'TOWN_CAPTURED':
        if (e.townId === view.season.throneTownId)
          pushToast(t(lang, 'toastThroneTaken', { name: lordName(view, e.to) }));
        break;
      case 'EDICT_DRAFT':
        if (e.lordId === HUMAN_ID) pushToast(t(lang, 'toastDraft'), 'good');
        break;
      case 'LORD_EXILED':
        if (e.lordId === HUMAN_ID) pushToast(t(lang, 'toastExiled'), 'bad');
        break;
      case 'LORD_ELIMINATED':
        if (e.lordId === HUMAN_ID) pushToast(t(lang, 'toastEliminated'), 'bad');
        break;
      default:
        break;
    }
  }
}

export const DEMO_BOTS = defaultConfig.demo.bots;
export const SPEEDS = defaultConfig.demo.speeds;
