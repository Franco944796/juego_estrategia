import type { BattleWinner, GameConfig } from './types';

export interface SiegeInput {
  attacker: number;
  /** Multiplier on the attacker's troops (skill points in attack). */
  attackMult: number;
  /** The owner's garrison first, then each allied contingent, with its lord's defense multiplier. */
  defenders: { troops: number; defense: number }[];
  fort: number;
  walls: number;
}

export interface SiegeOutcome {
  attackerPower: number;
  defenderPower: number;
  winner: BattleWinner;
  attackerSurvivors: number;
  attackerLost: number;
  /** Per contingent; the owner's power includes the walls. */
  defenders: { power: number; survivors: number; lost: number }[];
}

function survivors(army: number, lossFraction: number): number {
  return Math.floor(army * Math.max(0, 1 - lossFraction));
}

/**
 * Deterministic: the higher power wins, ties go to the defender, the losing side loses every troop.
 * The winner loses (loser power / winner power) ^ lossExponent. Walls add defense and never fall.
 */
export function resolveSiege(cfg: GameConfig, input: SiegeInput): SiegeOutcome {
  const attackerPower = input.attacker * input.attackMult;
  const powers = input.defenders.map(
    (d, i) => d.troops * d.defense * input.fort + (i === 0 ? input.walls : 0),
  );
  const defenderPower = powers.reduce((sum, p) => sum + p, 0);

  const winner: BattleWinner = attackerPower > defenderPower ? 'ATTACKER' : 'DEFENDER';
  let attackerSurvivors = 0;
  let lossFraction = 1;
  if (winner === 'ATTACKER') {
    attackerSurvivors = survivors(input.attacker, (defenderPower / attackerPower) ** cfg.combat.lossExponent);
  } else {
    lossFraction = (defenderPower === 0 ? 0 : attackerPower / defenderPower) ** cfg.combat.lossExponent;
  }
  const defenders = input.defenders.map((d, i) => {
    const kept = winner === 'ATTACKER' ? 0 : survivors(d.troops, lossFraction);
    return { power: powers[i] ?? 0, survivors: kept, lost: d.troops - kept };
  });
  return {
    attackerPower,
    defenderPower,
    winner,
    attackerSurvivors,
    attackerLost: input.attacker - attackerSurvivors,
    defenders,
  };
}

export interface BattleOutcome {
  attackerPower: number;
  defenderPower: number;
  winner: BattleWinner;
  attackerSurvivors: number;
  defenderSurvivors: number;
  attackerLost: number;
  defenderLost: number;
}

/** A siege seen as one attacker against all the defenders together. */
export function summarizeSiege(siege: SiegeOutcome): BattleOutcome {
  return {
    attackerPower: siege.attackerPower,
    defenderPower: siege.defenderPower,
    winner: siege.winner,
    attackerSurvivors: siege.attackerSurvivors,
    defenderSurvivors: siege.defenders.reduce((sum, d) => sum + d.survivors, 0),
    attackerLost: siege.attackerLost,
    defenderLost: siege.defenders.reduce((sum, d) => sum + d.lost, 0),
  };
}
