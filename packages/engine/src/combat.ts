import { BEATS, TROOP_TYPES } from '@si/config/constants';
import { addTroops, subTroops, totalTroops, zeroTroops } from './troops';
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

export interface DefendingContingent {
  troops: Troops;
  defenseMults: Troops;
  lossMult: number;
}

export interface SiegeInput {
  attacker: Troops;
  attackMults: Troops;
  attackerLossMult: number;
  /** The owner's garrison first, then any allied contingents stationed in the town. */
  defenders: DefendingContingent[];
  fort: number;
}

export interface SiegeOutcome {
  attackerPower: number;
  defenderPower: number;
  winner: BattleWinner;
  attackerSurvivors: Troops;
  attackerLost: Troops;
  defenders: { power: number; survivors: Troops; lost: Troops }[];
}

/**
 * Deterministic: the higher power wins, ties go to the defender, the losing side loses every unit.
 * Defending contingents pool their power; each loses the same fraction, scaled by its own lord's edicts.
 */
export function resolveSiege(cfg: GameConfig, input: SiegeInput): SiegeOutcome {
  const allDefenders = input.defenders.reduce((sum, d) => addTroops(sum, d.troops), zeroTroops());
  const attackerPower = armyPower(cfg, input.attacker, allDefenders, 'attack', input.attackMults);
  const powers = input.defenders.map(
    (d) => armyPower(cfg, d.troops, input.attacker, 'defense', d.defenseMults) * input.fort,
  );
  const defenderPower = powers.reduce((sum, p) => sum + p, 0);

  const winner: BattleWinner = attackerPower > defenderPower ? 'ATTACKER' : 'DEFENDER';
  let attackerSurvivors = zeroTroops();
  let lossFraction = 1;
  if (winner === 'ATTACKER') {
    const ratio = defenderPower / attackerPower;
    attackerSurvivors = survivors(input.attacker, ratio ** cfg.combat.lossExponent * input.attackerLossMult);
  } else {
    lossFraction = (defenderPower === 0 ? 0 : attackerPower / defenderPower) ** cfg.combat.lossExponent;
  }
  const defenders = input.defenders.map((d, i) => {
    const kept = winner === 'ATTACKER' ? zeroTroops() : survivors(d.troops, lossFraction * d.lossMult);
    return { power: powers[i] ?? 0, survivors: kept, lost: subTroops(d.troops, kept) };
  });
  return {
    attackerPower,
    defenderPower,
    winner,
    attackerSurvivors,
    attackerLost: subTroops(input.attacker, attackerSurvivors),
    defenders,
  };
}

export function resolveBattle(cfg: GameConfig, input: BattleInput): BattleOutcome {
  const siege = resolveSiege(cfg, {
    attacker: input.attacker,
    attackMults: input.attackMults,
    attackerLossMult: input.attackerLossMult,
    defenders: [
      { troops: input.defender, defenseMults: input.defenseMults, lossMult: input.defenderLossMult },
    ],
    fort: input.fort,
  });
  const [garrison] = siege.defenders;
  return {
    attackerPower: siege.attackerPower,
    defenderPower: siege.defenderPower,
    winner: siege.winner,
    attackerSurvivors: siege.attackerSurvivors,
    defenderSurvivors: garrison?.survivors ?? zeroTroops(),
    attackerLost: siege.attackerLost,
    defenderLost: garrison?.lost ?? zeroTroops(),
  };
}
