import { defaultConfig } from '@si/config';
import { GEM_COLORS } from '@si/config/constants';
import {
  stockGem,
  type Command,
  type DevAction,
  type DomainEvent,
  type GearSlot,
  type Gem,
  type GroupPreview,
  type Item,
  type LordView,
  type Rarity,
  type SendPreview,
  type Standing,
} from '@si/engine';
import { formatDuration, formatNumber } from '../format';
import { BOT_NAMES, RULE_TEXT, SERVER_TEXT, t, WIND_NAMES } from '../i18n';
import { QUALITY_SETTINGS, type QualitySetting } from '../map3d/quality';
import { toRealMs, useGame, type MapMode, type SeasonNews } from '../store';
import { isAlly, itemName, townLabel } from '../ui/labels';
import { LocalGameClient, type GameClient } from './client';
import type { ChatChannel, ClanDetail, ClanRankingRow, ClanSummary, HallResponse } from '@si/protocol';
import { api, ApiError } from './api';
import type { Armory, Save } from './protocol';
import { RemoteGameClient } from './remote';

const SAVE_KEY = 'shattered-isles:save:v1';
const LANG_KEY = 'shattered-isles:lang';
const TUTORIAL_KEY = 'shattered-isles:tutorial-done';
const TOKEN_KEY = 'shattered-isles:token';
const ARMORY_KEY = 'shattered-isles:armory';
/** Gems won at a single-player season end, added to the armory when the next season starts. */
const GEM_REWARDS_KEY = 'shattered-isles:gem-rewards';
const MAP_KEY = 'shattered-isles:map';
const QUALITY_KEY = 'shattered-isles:quality';

let client: GameClient | null = null;
let remote: RemoteGameClient | null = null;
/** Chat lines kept per channel on the client, like the server keeps. */
const CHAT_KEPT = 100;
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
    return save.version === 5 && save.state.status === 'RUNNING' ? save : null;
  } catch {
    return null;
  }
}

export function savedMapMode(): MapMode | null {
  const mode = read(MAP_KEY);
  return mode === '3d' || mode === '2d' ? mode : null;
}

export function chooseMapMode(mode: MapMode): void {
  write(MAP_KEY, mode);
  useGame.getState().setMapMode(mode);
}

export function savedQuality(): QualitySetting | null {
  const quality = read(QUALITY_KEY);
  return QUALITY_SETTINGS.find((q) => q === quality) ?? null;
}

export function chooseQuality(quality: QualitySetting): void {
  write(QUALITY_KEY, quality);
  useGame.getState().setQuality(quality);
}

export function savedLang(): 'es' | 'en' | null {
  const lang = read(LANG_KEY);
  return lang === 'es' || lang === 'en' ? lang : null;
}

export function rememberLang(lang: 'es' | 'en'): void {
  write(LANG_KEY, lang);
}

/** The demo keeps the player's equipment in the browser, so it carries over to the next game. */
function readArmory(): Armory {
  try {
    const armory = JSON.parse(read(ARMORY_KEY) ?? 'null') as Armory | null;
    if (armory && Array.isArray(armory.items) && typeof armory.gear === 'object') return armory;
  } catch {
    // A damaged record just starts the armory over.
  }
  return { items: [], gear: {} };
}

/**
 * How many gems a single-player rank wins: the same bands as the online rewards (each holds the top
 * `topShare` of the field, rounded up and never empty).
 */
export function seasonGemCount(standings: Standing[], lordId: string): number {
  const tiers = defaultConfig.rewards.tiers;
  const mine = standings.find((s) => s.lordId === lordId);
  if (!mine) return 0;
  const cutoffs = tiers.map((t) => Math.max(1, Math.ceil(standings.length * t.topShare)));
  const found = cutoffs.findIndex((cutoff) => mine.rank <= cutoff);
  return tiers[found < 0 ? tiers.length - 1 : found]?.gems ?? 0;
}

function readGemRewards(): Gem[] {
  try {
    const gems = JSON.parse(read(GEM_REWARDS_KEY) ?? '[]') as Gem[];
    return Array.isArray(gems) ? gems : [];
  } catch {
    return [];
  }
}

/** Gems for a finished single-player season (league 1), colors at random. */
function awardSeasonGems(count: number): void {
  const won = readGemRewards();
  const stamp = Date.now().toString(36);
  for (let k = 0; k < count; k++) {
    won.push({
      id: `${stamp}-${k}`,
      color: GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)] ?? 'TOPAZ',
      league: 0,
    });
  }
  write(GEM_REWARDS_KEY, JSON.stringify(won));
}

/** The armory with the gems won since the last season; repeats join owned gems as copies. */
function armoryWithRewards(): Armory {
  const armory = readArmory();
  const gems = armory.gems ? [...armory.gems] : [];
  for (const gem of readGemRewards()) stockGem(defaultConfig, gems, gem);
  write(GEM_REWARDS_KEY, null);
  return { ...armory, gems };
}

let lastArmory = '';

function keepArmory(view: LordView): void {
  const text = JSON.stringify({
    items: view.me.items,
    gear: view.me.gear,
    scrap: view.me.scrap,
    gems: view.me.gems,
  });
  if (text === lastArmory) return;
  lastArmory = text;
  write(ARMORY_KEY, text);
}

function localClient(): GameClient {
  if (client instanceof LocalGameClient) return client;
  client?.dispose();
  client = new LocalGameClient({
    onView: (view, clock) => {
      useGame.getState().receiveView(view, clock);
      keepArmory(view);
    },
    onEvents: (events) => notify(events),
    onSave: (save) => write(SAVE_KEY, JSON.stringify(save)),
  });
  return client;
}

export function startNewGame(bots: number): void {
  const { lang } = useGame.getState();
  useGame.getState().reset();
  localClient().start({
    // The engine is seeded; picking the seed itself may use real randomness.
    seed: Math.floor(Math.random() * 2 ** 31),
    humanName: t(lang, 'defaultName'),
    botNames: BOT_NAMES[lang].slice(0, bots),
    armory: armoryWithRewards(),
  });
  useGame.setState({ screen: 'game', mode: 'offline', tutorial: read(TUTORIAL_KEY) ? null : 0 });
}

export function continueGame(): boolean {
  const save = readSave();
  if (!save) return false;
  useGame.getState().reset();
  localClient().load(save);
  useGame.setState({ screen: 'game', mode: 'offline', tutorial: null });
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
  if (!client) return false;
  const error = await client.command(cmd);
  if (error) {
    const { lang, pushToast } = useGame.getState();
    pushToast(RULE_TEXT[lang][error.code] ?? error.message, 'bad');
    return false;
  }
  return true;
}

/** Runs a test tool in the online world (test accounts only). */
export async function devTool(action: DevAction): Promise<boolean> {
  if (!remote) return false;
  const error = await remote.dev(action);
  if (error) {
    const { lang, pushToast } = useGame.getState();
    pushToast(RULE_TEXT[lang][error.code] ?? error.message, 'bad');
    return false;
  }
  return true;
}

export function preview(from: number, to: number, troops: number): Promise<SendPreview> {
  return client ? client.preview(from, to, troops) : new Promise<SendPreview>(() => undefined);
}

export function previewGroup(from: number[], to: number): Promise<GroupPreview> {
  return client ? client.previewGroup(from, to) : new Promise<GroupPreview>(() => undefined);
}

function serverText(code: string): string {
  const { lang } = useGame.getState();
  return SERVER_TEXT[lang][code] ?? code;
}

function failure(error: unknown): string {
  return serverText(error instanceof ApiError ? error.code : 'NETWORK');
}

function socketUrl(token: string): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws?token=${encodeURIComponent(token)}`;
}

/** Offers the online world only when the page comes from the game server. */
export async function checkOnline(): Promise<void> {
  if (typeof location === 'undefined' || !location.protocol.startsWith('http')) return;
  try {
    await api.health();
  } catch {
    return;
  }
  useGame.setState({ onlineAvailable: true });
  const token = read(TOKEN_KEY);
  if (!token) return;
  try {
    const me = await api.me(token);
    useGame.setState({ token, profile: me.account, clan: me.clan });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') write(TOKEN_KEY, null);
  }
}

/** Creates the account on first use, joins the current season and connects. Returns an error text. */
export async function enterOnline(name?: string): Promise<string | null> {
  let { token } = useGame.getState();
  try {
    if (!token) {
      const created = await api.session(name ?? '');
      token = created.token;
      write(TOKEN_KEY, token);
      useGame.setState({ token, profile: created.account });
    }
    await api.join(token);
  } catch (error) {
    return failure(error);
  }
  client?.dispose();
  useGame.getState().reset();
  remote = new RemoteGameClient(socketUrl(token), {
    onView: (view, clock) => useGame.getState().receiveView(view, clock),
    onEvents: (events) => notify(events),
    onSeason: (news) => void startNextSeason(news),
    onConnection: (connected) => useGame.setState({ connected }),
    onChat: (message) =>
      useGame.setState((s) => ({
        chat: { ...s.chat, [message.channel]: [...s.chat[message.channel], message].slice(-CHAT_KEPT) },
        unread: s.panel === 'social' ? 0 : s.unread + 1,
      })),
    onChatHistory: (channel, messages) =>
      useGame.setState((s) => ({ chat: { ...s.chat, [channel]: messages } })),
    onClanChanged: () => void refreshProfile().catch(() => undefined),
  });
  client = remote;
  useGame.setState({ screen: 'game', mode: 'online', tutorial: read(TUTORIAL_KEY) ? null : 0 });
  return null;
}

/** The server closed the season: show the result and come back in the new one. */
async function startNextSeason(news: SeasonNews): Promise<void> {
  useGame.setState({ seasonNews: news, selected: null, send: null, picking: false, panel: null });
  const { token } = useGame.getState();
  if (!token) return;
  try {
    await api.join(token);
    await refreshProfile();
  } catch {
    // The next reconnect or menu action retries.
  }
}

export async function applyRecoveryCode(code: string): Promise<string | null> {
  const token = code.trim();
  try {
    const me = await api.me(token);
    write(TOKEN_KEY, token);
    useGame.setState({ token, profile: me.account });
    return null;
  } catch (error) {
    return failure(error);
  }
}

export async function refreshProfile(): Promise<void> {
  const { token } = useGame.getState();
  if (!token) return;
  const me = await api.me(token);
  useGame.setState({ profile: me.account, clan: me.clan });
}

async function styleAction(action: typeof api.unlock, style: string): Promise<void> {
  const { token, pushToast } = useGame.getState();
  if (!token) return;
  try {
    const result = await action(token, style);
    useGame.setState({ profile: result.account });
  } catch (error) {
    pushToast(failure(error), 'bad');
  }
}

export const unlockStyle = (style: string): Promise<void> => styleAction(api.unlock, style);

export async function buyItem(slot: GearSlot, rarity: Rarity): Promise<Item | null> {
  const { token, pushToast } = useGame.getState();
  if (!token) return null;
  try {
    const result = await api.buyItem(token, slot, rarity);
    useGame.setState({ profile: result.account });
    return result.item;
  } catch (error) {
    pushToast(failure(error), 'bad');
    return null;
  }
}
export const equipStyle = (style: string): Promise<void> => styleAction(api.equip, style);

export function loadHall(): Promise<HallResponse> {
  return api.hall(useGame.getState().profile?.league ?? 0);
}

export function leaveOnline(): void {
  client?.dispose();
  client = null;
  remote = null;
  useGame.getState().reset();
  useGame.setState({ screen: 'title', mode: 'offline', seasonNews: null, connected: true });
}

export function setSpeed(speed: number): void {
  client?.setSpeed(speed);
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
  const me = view.me.id;
  // One battle can climb several levels; a single toast names the last one.
  let level: number | null = null;
  let levelTroops = 0;
  for (const e of events) {
    switch (e.type) {
      case 'MARCH_LAUNCHED': {
        const target = view.towns.find((x) => x.id === e.march.to);
        if (e.march.owner === me) {
          if (store.tutorial === 2) store.setTutorial(3);
        } else if (target?.owner === me && isAlly(view, e.march.owner)) {
          pushToast(
            t(lang, 'toastAllyHelp', { name: lordName(view, e.march.owner), town: town(e.march.to) }),
            'good',
          );
        } else if (target?.owner === me && !e.march.scout) {
          const eta = formatDuration(toRealMs(store.clock, e.march.arriveAt - e.at));
          pushToast(
            t(lang, 'toastIncoming', { name: lordName(view, e.march.owner), town: town(e.march.to), t: eta }),
            'bad',
          );
        }
        break;
      }
      case 'SCOUTED':
        if (e.report.scout === me)
          pushToast(t(lang, 'toastScouted', { town: town(e.report.townId) }), 'good');
        else if (e.report.owner === me) {
          pushToast(
            t(lang, 'toastScoutedBy', { name: lordName(view, e.report.scout), town: town(e.report.townId) }),
            'bad',
          );
        }
        break;
      case 'BATTLE': {
        const r = e.report;
        if (r.attacker === me) {
          if (r.captured) pushToast(t(lang, 'toastTook', { town: town(r.townId) }), 'good');
          else if (r.winner === 'DEFENDER')
            pushToast(t(lang, 'toastFailed', { town: town(r.townId) }), 'bad');
        } else if (r.defender === me) {
          if (r.captured) pushToast(t(lang, 'toastLost', { town: town(r.townId) }), 'bad');
          else if (r.winner === 'DEFENDER')
            pushToast(t(lang, 'toastDefended', { town: town(r.townId) }), 'good');
        } else if (r.allies.some((a) => a.lordId === me)) {
          pushToast(
            t(lang, r.captured ? 'allyLost' : 'allyDefended', { town: town(r.townId) }),
            r.captured ? 'bad' : 'good',
          );
        }
        break;
      }
      case 'LEVEL_UP':
        if (e.lordId === me) {
          level = e.level;
          levelTroops += e.troops;
        }
        break;
      case 'MARCH_STATIONED': {
        const target = view.towns.find((x) => x.id === e.march.to);
        if (target?.owner === me && e.march.owner !== me) {
          pushToast(
            t(lang, 'toastAllyArrived', { name: lordName(view, e.march.owner), town: town(e.march.to) }),
            'good',
          );
        }
        break;
      }
      case 'BEACON_CHANGED': {
        const before = view.zones[e.zoneId]?.beaconOwner;
        if (e.owner === me) pushToast(t(lang, 'toastBeacon'), 'good');
        else if (before === me) pushToast(t(lang, 'toastBeaconLost'), 'bad');
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
      case 'ITEM_FOUND':
        if (e.lordId === me && e.into) {
          const level = e.into.level ?? 1;
          pushToast(
            t(lang, 'toastCopy', {
              item: itemName(lang, e.item),
              n: level,
              c: e.into.copies ?? 0,
              need: defaultConfig.gear.copiesPerLevel * level,
            }),
            'good',
          );
        } else if (e.lordId === me && e.source === 'LEVEL')
          pushToast(t(lang, 'toastItem', { item: itemName(lang, e.item) }), 'good');
        break;
      case 'LORD_EXILED':
        if (e.lordId === me) pushToast(t(lang, 'toastExiled'), 'bad');
        break;
      case 'LORD_ELIMINATED':
        if (e.lordId === me) pushToast(t(lang, 'toastEliminated'), 'bad');
        break;
      case 'SEASON_ENDED':
        // Online the server hands out gems at the season end; single player keeps them here.
        if (store.mode === 'offline') awardSeasonGems(seasonGemCount(e.standings, me));
        break;
      default:
        break;
    }
  }
  if (level !== null) {
    pushToast(t(lang, 'toastLevelUp', { n: level, troops: formatNumber(levelTroops, lang) }), 'good');
  }
}

export const DEMO_BOTS = defaultConfig.demo.bots;
export const SPEEDS = defaultConfig.demo.speeds;

export function sendChat(channel: ChatChannel, text: string): void {
  remote?.sendChat(channel, text);
}

/** Runs a clan call with the stored token; failures become a toast and `false`. */
async function clanCall(action: (token: string) => Promise<unknown>): Promise<boolean> {
  const { token, pushToast } = useGame.getState();
  if (!token) return false;
  try {
    await action(token);
    await refreshProfile();
    return true;
  } catch (error) {
    pushToast(failure(error), 'bad');
    return false;
  }
}

export const createClan = (name: string, tag: string): Promise<boolean> =>
  clanCall((token) => api.createClan(token, name, tag));
export const requestJoin = (clanId: string): Promise<boolean> =>
  clanCall((token) => api.requestJoin(token, clanId));
export const decideRequest = (clanId: string, accountId: string, accept: boolean): Promise<boolean> =>
  clanCall((token) => api.decide(token, clanId, accountId, accept));
export const leaveClan = (): Promise<boolean> => clanCall((token) => api.leaveClan(token));
export const kickMember = (accountId: string): Promise<boolean> =>
  clanCall((token) => api.kick(token, accountId));
export const setMemberRole = (accountId: string, role: 'officer' | 'member'): Promise<boolean> =>
  clanCall((token) => api.setRole(token, accountId, role));

export async function loadClan(clanId: string): Promise<ClanDetail | null> {
  const { token } = useGame.getState();
  if (!token) return null;
  try {
    return (await api.clan(token, clanId)).value;
  } catch {
    return null;
  }
}

export async function searchClans(query: string): Promise<ClanSummary[]> {
  try {
    return (await api.searchClans(query)).clans;
  } catch {
    return [];
  }
}

export async function loadClanRanking(): Promise<ClanRankingRow[]> {
  try {
    return (await api.clanRanking()).ranking;
  } catch {
    return [];
  }
}
