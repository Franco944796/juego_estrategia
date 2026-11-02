import type { GameConfig } from '@si/config';
import { MINUTE_MS } from '@si/config/constants';
import { advanceTo, createGame, type DomainEvent, type GameState, type LordInit } from '@si/engine';

export interface SeasonMetrics {
  seed: number;
  lords: number;
  battles: number;
  pvpBattles: number;
  /** PvP battles whose stronger side had at most 1.5× the weaker side's power. */
  tensionShare: number;
  captures: number;
  pvpCaptures: number;
  medianLandMin: number;
  medianSkyMin: number;
  /** Sky marches launched with a tailwind (factor above 1); null with no flight (a single isle). */
  tailwindShare: number | null;
  medianFirstCaptureMin: number;
  medianFirstBeaconMin: number | null;
  beaconLordShare: number;
  midSeasonMedianTowns: number;
  /** When the first town reached the top level, or null if none did. */
  firstTopLevelMin: number | null;
  /** Median over lords of their highest town level at the end. */
  medianBestTownLevel: number;
  /** Lost troops that reappeared in a capital, over all troops lost. */
  recoveredShare: number;
  upgradesPerLord: number;
  exiles: number;
  eliminations: number;
  /** Winner's Dominion over everyone's Dominion. */
  winnerShare: number;
  /** Median lord level at the end of the season. */
  medianLevel: number;
  /** Isles at the end: a new one is born when the newest is full or fully conquered. */
  islesAtEnd: number;
  runtimeMs: number;
}

const TENSION_RATIO = 1.5;

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function botLords(count: number): LordInit[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i + 1}`,
    name: `Bot ${i + 1}`,
    color: '#888888',
    isBot: true,
  }));
}

function townsPerLord(state: GameState): number[] {
  return state.lordOrder.map((id) => state.towns.filter((t) => t.owner === id).length);
}

export function simulateSeason(config: GameConfig, seed: number, bots: number): SeasonMetrics {
  const started = performance.now();
  const state = createGame({ seed, config, startsAt: 0, lords: botLords(bots) });
  const minutes = (t: number): number => (t - state.startsAt) / MINUTE_MS;
  const firstHalf = advanceTo(state, state.startsAt + (state.endsAt - state.startsAt) / 2);
  const midTowns = townsPerLord(state);
  const events: DomainEvent[] = [...firstHalf, ...advanceTo(state, state.endsAt)];

  let battles = 0;
  let pvpBattles = 0;
  let tense = 0;
  let captures = 0;
  let pvpCaptures = 0;
  let upgrades = 0;
  let lost = 0;
  let recovered = 0;
  let firstTopLevel: number | null = null;
  let exiles = 0;
  let eliminations = 0;
  let sky = 0;
  let tailwind = 0;
  const land: number[] = [];
  const skyMinutes: number[] = [];
  const firstCapture = new Map<string, number>();
  const firstBeacon = new Map<string, number>();

  for (const e of events) {
    switch (e.type) {
      case 'BATTLE': {
        battles++;
        const r = e.report;
        lost += r.attackerLost + r.defenderLost;
        recovered +=
          r.attackerRecovered + r.defenderRecovered + r.allies.reduce((sum, a) => sum + a.recovered, 0);
        if (e.report.defender === null) break;
        pvpBattles++;
        const strong = Math.max(e.report.attackerPower, e.report.defenderPower);
        const weak = Math.min(e.report.attackerPower, e.report.defenderPower);
        if (weak > 0 && strong / weak <= TENSION_RATIO) tense++;
        break;
      }
      case 'TOWN_CAPTURED':
        captures++;
        if (e.from !== null) pvpCaptures++;
        if (!firstCapture.has(e.to)) firstCapture.set(e.to, minutes(e.at));
        break;
      case 'MARCH_LAUNCHED': {
        const duration = (e.march.arriveAt - e.march.departAt) / MINUTE_MS;
        if (e.march.sky) {
          sky++;
          skyMinutes.push(duration);
          if (e.march.windFactor > 1) tailwind++;
        } else {
          land.push(duration);
        }
        break;
      }
      case 'BEACON_CHANGED':
        if (e.owner !== null && !firstBeacon.has(e.owner)) firstBeacon.set(e.owner, minutes(e.at));
        break;
      case 'TOWN_UPGRADED':
        upgrades++;
        if (firstTopLevel === null && e.tier >= config.towns.maxTier) firstTopLevel = minutes(e.at);
        break;
      case 'LORD_EXILED':
        exiles++;
        break;
      case 'LORD_ELIMINATED':
        eliminations++;
        break;
      default:
        break;
    }
  }

  const standings = state.standings ?? [];
  const total = standings.reduce((sum, s) => sum + s.dominion, 0);
  return {
    seed,
    lords: bots,
    battles,
    pvpBattles,
    tensionShare: pvpBattles > 0 ? tense / pvpBattles : 0,
    captures,
    pvpCaptures,
    medianLandMin: median(land),
    medianSkyMin: median(skyMinutes),
    tailwindShare: sky > 0 ? tailwind / sky : null,
    medianFirstCaptureMin: median([...firstCapture.values()]),
    medianFirstBeaconMin: firstBeacon.size > 0 ? median([...firstBeacon.values()]) : null,
    beaconLordShare: firstBeacon.size / bots,
    midSeasonMedianTowns: median(midTowns),
    firstTopLevelMin: firstTopLevel,
    medianBestTownLevel: median(
      state.lordOrder.map((id) =>
        Math.max(0, ...state.towns.filter((t) => t.owner === id).map((t) => t.tier)),
      ),
    ),
    recoveredShare: lost > 0 ? recovered / lost : 0,
    upgradesPerLord: upgrades / bots,
    exiles,
    eliminations,
    winnerShare: total > 0 ? (standings[0]?.dominion ?? 0) / total : 0,
    medianLevel: median(state.lordOrder.map((id) => state.lords[id]?.level ?? 1)),
    islesAtEnd: state.isles.length,
    runtimeMs: performance.now() - started,
  };
}

type NumericKey = {
  [K in keyof SeasonMetrics]: SeasonMetrics[K] extends number | null ? K : never;
}[keyof SeasonMetrics];

/** Mean over the runs, skipping seasons where the metric did not happen (null). */
export function mean(runs: SeasonMetrics[], key: NumericKey): number | null {
  const values = runs.map((r) => r[key]).filter((v): v is number => v !== null && !Number.isNaN(v));
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export interface Target {
  key: NumericKey;
  label: string;
  min?: number;
  max?: number;
  digits: number;
  /** Shown as n/a instead of off when it never happened (a tailwind needs a second isle). */
  optional?: boolean;
}

// Pacing targets per preset; docs/BALANCE.md explains them.
export const TARGETS: Record<'demo' | 'live', Target[]> = {
  demo: [
    { key: 'medianFirstCaptureMin', label: 'First capture per lord (game min, median)', max: 10, digits: 1 },
    {
      key: 'tailwindShare',
      label: 'Sky marches launched with a tailwind',
      min: 0.5,
      digits: 2,
      optional: true,
    },
    { key: 'midSeasonMedianTowns', label: 'Towns per lord at mid-season (median)', min: 6, digits: 1 },
    { key: 'medianFirstBeaconMin', label: 'First beacon (game min, median)', max: 90, digits: 0 },
    { key: 'beaconLordShare', label: 'Lords who lit a beacon', min: 0.75, digits: 2 },
    { key: 'tensionShare', label: 'PvP battles within 1.5× power', min: 0.2, max: 0.4, digits: 2 },
    { key: 'firstTopLevelMin', label: 'First town at level 100 (game min)', min: 120, max: 240, digits: 0 },
    { key: 'winnerShare', label: 'Winner share of all Dominion', max: 0.35, digits: 2 },
  ],
  live: [
    { key: 'medianFirstCaptureMin', label: 'First capture per lord (min, median)', max: 60, digits: 1 },
    {
      key: 'tailwindShare',
      label: 'Sky marches launched with a tailwind',
      min: 0.5,
      digits: 2,
      optional: true,
    },
    { key: 'midSeasonMedianTowns', label: 'Towns per lord at mid-season (median)', min: 6, digits: 1 },
    { key: 'medianFirstBeaconMin', label: 'First beacon (min, median)', max: 1440, digits: 0 },
    { key: 'beaconLordShare', label: 'Lords who lit a beacon', min: 0.75, digits: 2 },
    { key: 'tensionShare', label: 'PvP battles within 1.5× power', min: 0.2, max: 0.4, digits: 2 },
    { key: 'firstTopLevelMin', label: 'First town at level 100 (min)', min: 2500, max: 4500, digits: 0 },
    { key: 'winnerShare', label: 'Winner share of all Dominion', max: 0.35, digits: 2 },
  ],
};

export function meets(target: Target, value: number | null): boolean {
  if (value === null) return false;
  return (
    (target.min === undefined || value >= target.min) && (target.max === undefined || value <= target.max)
  );
}

function range(target: Target): string {
  if (target.min !== undefined && target.max !== undefined) return `${target.min}–${target.max}`;
  if (target.min !== undefined) return `≥ ${target.min}`;
  return `≤ ${target.max ?? ''}`;
}

export function renderReport(runs: SeasonMetrics[], header: string, targets: Target[]): string {
  const fmt = (v: number | null, digits: number): string => (v === null ? '—' : v.toFixed(digits));
  const rows = targets.map((t) => {
    const value = mean(runs, t.key);
    const status = value === null && t.optional ? 'n/a' : meets(t, value) ? 'ok' : 'off';
    return `| ${t.label} | ${range(t)} | ${fmt(value, t.digits)} | ${status} |`;
  });
  const extra: [string, NumericKey, number][] = [
    ['Land march, game minutes (median)', 'medianLandMin', 2],
    ['Sky march, game minutes (median)', 'medianSkyMin', 2],
    ['Battles per season', 'battles', 0],
    ['PvP battles per season', 'pvpBattles', 0],
    ['Captures per season', 'captures', 0],
    ['PvP captures per season', 'pvpCaptures', 0],
    ['Upgrades per lord', 'upgradesPerLord', 1],
    ['Best town level per lord at season end (median)', 'medianBestTownLevel', 1],
    ['Lord level at season end (median)', 'medianLevel', 1],
    ['Lost troops recovered in a capital', 'recoveredShare', 2],
    ['Isles at season end', 'islesAtEnd', 1],
    ['Exiles per season', 'exiles', 1],
    ['Eliminations per season', 'eliminations', 1],
    ['Runtime per season (ms)', 'runtimeMs', 0],
  ];
  return [
    header,
    '',
    '| Metric | Target | Result | Status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '| Other metric | Mean |',
    '| --- | --- |',
    ...extra.map(([label, key, digits]) => `| ${label} | ${fmt(mean(runs, key), digits)} |`),
    '',
  ].join('\n');
}
