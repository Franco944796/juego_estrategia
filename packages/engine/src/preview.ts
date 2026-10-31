import { resolveBattle, type BattleOutcome } from './combat';
import { validateCommand } from './commands';
import { fortification, projectedGarrison } from './economy';
import { travelInfo, windIndexAt, windShiftMs, type TravelInfo } from './marches';
import { lordMods, neutralMods } from './modifiers';
import { totalTroops } from './troops';
import type { GameState, RuleError, Troops } from './types';
import { visibleIsles } from './vision';
import { getTown } from './world';

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
  troops: Troops,
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
  const reinforce = to.owner === lordId;
  let battle: BattleOutcome | null = null;
  if (!reinforce && totalTroops(troops) > 0 && visibleIsles(state, lordId).has(to.isleId)) {
    const attack = lordMods(state, lordId);
    const defense = to.owner === null ? neutralMods() : lordMods(state, to.owner);
    battle = resolveBattle(cfg, {
      attacker: troops,
      defender: projectedGarrison(state, to, t),
      attackMults: attack.attack,
      defenseMults: defense.defense,
      fort: fortification(state, to),
      attackerLossMult: attack.winnerLosses,
      defenderLossMult: defense.winnerLosses,
    });
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
