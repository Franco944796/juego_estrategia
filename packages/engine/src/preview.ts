import { resolveSiege, summarizeSiege, type BattleOutcome } from './combat';
import { validateCommand } from './commands';
import { fortification, projectedGarrison, townWalls } from './economy';
import { travelInfo, windIndexAt, windShiftMs, type TravelInfo } from './marches';
import { lordMods } from './modifiers';
import type { GameState, RuleError } from './types';
import { visibleIsles } from './vision';
import { areAllies, getTown } from './world';

export interface LaterDeparture {
  departAt: number;
  dir: number;
  durationMs: number;
  windFactor: number;
}

export interface SendPreview {
  error: RuleError | null;
  reinforce: boolean;
  travel: TravelInfo | null;
  arriveAt: number | null;
  /** Predicted against the garrison visible now; null when it is out of sight or the target is own. */
  battle: BattleOutcome | null;
  /** Travel time if the march waited for each forecast wind shift (sky routes only). */
  later: LaterDeparture[];
}

/** Read-only estimate for the send screen; the real outcome is decided on arrival. */
export function previewSend(
  state: GameState,
  lordId: string,
  fromId: number,
  toId: number,
  troops: number,
  now: number,
): SendPreview {
  const cfg = state.config;
  const t = Math.max(now, state.accruedAt);
  const validation = validateCommand(state, lordId, { type: 'SEND', from: fromId, to: toId, troops }, t);
  const error = validation.ok ? null : validation.error;
  const from = getTown(state, fromId);
  const to = getTown(state, toId);
  if (!from || !to || from.id === to.id) {
    return { error, reinforce: false, travel: null, arriveAt: null, battle: null, later: [] };
  }

  const travel = travelInfo(state, lordId, from, to, troops, t);
  const reinforce = to.owner === lordId || areAllies(state, lordId, to.owner);
  let battle: BattleOutcome | null = null;
  if (!reinforce && troops > 0 && visibleIsles(state, lordId).has(to.isleId)) {
    const siege = resolveSiege(cfg, {
      attacker: troops,
      attackMult: lordMods(state, lordId).attack,
      defenders: [
        { troops: projectedGarrison(state, to, t), defense: lordMods(state, to.owner).defense },
        ...to.stationed.map((s) => ({ troops: s.troops, defense: lordMods(state, s.lordId).defense })),
      ],
      fort: fortification(state, to),
      walls: townWalls(state, to),
    });
    battle = summarizeSiege(siege);
  }

  const later: LaterDeparture[] = [];
  if (travel.sky) {
    const index = windIndexAt(state, t);
    const shift = windShiftMs(state);
    for (let k = index + 1; k <= index + cfg.wind.forecastShifts && k < state.windDirs.length; k++) {
      const departAt = state.startsAt + k * shift;
      if (departAt >= state.endsAt) break;
      const alt = travelInfo(state, lordId, from, to, troops, departAt);
      later.push({
        departAt,
        dir: state.windDirs[k] ?? 0,
        durationMs: alt.durationMs,
        windFactor: alt.windFactor,
      });
    }
  }
  return { error, reinforce, travel, arriveAt: t + travel.durationMs, battle, later };
}

export interface GroupPreview {
  error: RuleError | null;
  reinforce: boolean;
  /** Troops of every source together, as projected now. */
  troops: number;
  /** All the marches arrive at this time, with the slowest one. */
  arriveAt: number | null;
  durationMs: number | null;
  battle: BattleOutcome | null;
}

/** Read-only estimate for a synchronized group: every source sends all it holds. */
export function previewGroup(
  state: GameState,
  lordId: string,
  fromIds: number[],
  toId: number,
  now: number,
): GroupPreview {
  const t = Math.max(now, state.accruedAt);
  const validation = validateCommand(state, lordId, { type: 'SEND_GROUP', from: fromIds, to: toId }, t);
  const error = validation.ok ? null : validation.error;
  const to = getTown(state, toId);
  const sources = fromIds.flatMap((id) => {
    const town = getTown(state, id);
    return town && town.owner === lordId && town.id !== toId ? [town] : [];
  });
  if (!to || sources.length === 0) {
    return { error, reinforce: false, troops: 0, arriveAt: null, durationMs: null, battle: null };
  }
  const legs = sources.map((from) => ({ from, troops: projectedGarrison(state, from, t) }));
  const troops = legs.reduce((sum, l) => sum + l.troops, 0);
  const durationMs = Math.max(
    ...legs.map((l) => travelInfo(state, lordId, l.from, to, l.troops, t).durationMs),
  );
  const reinforce = to.owner === lordId || areAllies(state, lordId, to.owner);
  let battle: BattleOutcome | null = null;
  if (!reinforce && troops > 0 && visibleIsles(state, lordId).has(to.isleId)) {
    battle = summarizeSiege(
      resolveSiege(state.config, {
        attacker: troops,
        attackMult: lordMods(state, lordId).attack,
        defenders: [
          { troops: projectedGarrison(state, to, t), defense: lordMods(state, to.owner).defense },
          ...to.stationed.map((s) => ({ troops: s.troops, defense: lordMods(state, s.lordId).defense })),
        ],
        fort: fortification(state, to),
        walls: townWalls(state, to),
      }),
    );
  }
  return { error, reinforce, troops, arriveAt: t + durationMs, durationMs, battle };
}
