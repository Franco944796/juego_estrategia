import { BEATS, TROOP_TYPES } from '@si/config/constants';
import { subTroops, totalTroops, zeroTroops } from './troops';
import type { BattleWinner, GameConfig, Troops, TroopType } from './types';

/** Counter multiplier of one unit type against another. */
export function counter(cfg: GameConfig, unit: TroopType, enemy: TroopType): number {
  if (BEATS[unit] === enemy) return cfg.combat.counterBonus;
  if (BEATS[enemy] === unit) return 1 / cfg.combat.counterBonus;
  return 1;
}

/** Average counter multiplier of `unit` over the enemy's composition (1 against nobody). */
export function counterVs(cfg: GameConfig, unit: TroopType, enemy: Troops): number {
  const total = totalTroops(enemy);
  if (total === 0) return 1;
  let sum = 0;
  for (const type of TROOP_TYPES) sum += (enemy[type] / total) * counter(cfg, unit, type);
  return sum;
}

export function armyPower(
  cfg: GameConfig,
  army: Troops,
  enemy: Troops,
  stat: 'attack' | 'defense',
  typeMults: Troops,
): number {
  let power = 0;
  for (const type of TROOP_TYPES) {
    if (army[type] === 0) continue;
    power += army[type] * cfg.troops[type][stat] * typeMults[type] * counterVs(cfg, type, enemy);
  }
  return power;
}

export interface BattleInput {
  attacker: Troops;
  defender: Troops;
  attackMults: Troops;
  defenseMults: Troops;
  fort: number;
  attackerLossMult: number;
  defenderLossMult: number;
}

export interface BattleOutcome {
  attackerPower: number;
  defenderPower: number;
  winner: BattleWinner;
  attackerSurvivors: Troops;
  defenderSurvivors: Troops;
  attackerLost: Troops;
  defenderLost: Troops;
}

function survivors(army: Troops, lossFraction: number): Troops {
  const keep = Math.max(0, 1 - lossFraction);
  return {
    LANCER: Math.floor(army.LANCER * keep),
    ARCHER: Math.floor(army.ARCHER * keep),
    GRIFFIN: Math.floor(army.GRIFFIN * keep),
  };
}

/** Deterministic: the higher power wins, ties go to the defender, the loser loses every unit. */
export function resolveBattle(cfg: GameConfig, input: BattleInput): BattleOutcome {
  const attackerPower = armyPower(cfg, input.attacker, input.defender, 'attack', input.attackMults);
  const defenderPower =
    armyPower(cfg, input.defender, input.attacker, 'defense', input.defenseMults) * input.fort;

  const winner: BattleWinner = attackerPower > defenderPower ? 'ATTACKER' : 'DEFENDER';
  let attackerSurvivors: Troops;
  let defenderSurvivors: Troops;
  if (winner === 'ATTACKER') {
    const ratio = defenderPower / attackerPower;
    attackerSurvivors = survivors(input.attacker, ratio ** cfg.combat.lossExponent * input.attackerLossMult);
    defenderSurvivors = zeroTroops();
  } else {
    const ratio = defenderPower === 0 ? 0 : attackerPower / defenderPower;
    defenderSurvivors = survivors(input.defender, ratio ** cfg.combat.lossExponent * input.defenderLossMult);
    attackerSurvivors = zeroTroops();
  }
  return {
    attackerPower,
    defenderPower,
    winner,
    attackerSurvivors,
    defenderSurvivors,
    attackerLost: subTroops(input.attacker, attackerSurvivors),
    defenderLost: subTroops(input.defender, defenderSurvivors),
  };
}
