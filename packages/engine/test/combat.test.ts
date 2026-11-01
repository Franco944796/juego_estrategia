import { defaultConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { resolveSiege, summarizeSiege, type SiegeInput } from '../src/combat';

const cfg = defaultConfig;

/** Defenders given as troop counts, with defense ×1 unless `defense` says otherwise. */
function siege(
  input: Partial<Omit<SiegeInput, 'defenders'>> & {
    attacker: number;
    defenders?: number[];
    defense?: number[];
  },
) {
  const { defenders = [0], defense = [], ...rest } = input;
  return resolveSiege(cfg, {
    attackMult: 1,
    fort: 1,
    walls: 0,
    ...rest,
    defenders: defenders.map((troops, i) => ({ troops, defense: defense[i] ?? 1 })),
  });
}

describe('resolveSiege', () => {
  it('lets the stronger side win and floors the winner survivors', () => {
    const out = siege({ attacker: 10, defenders: [4] });
    expect(out.attackerPower).toBe(10);
    expect(out.defenderPower).toBe(4);
    expect(out.winner).toBe('ATTACKER');
    expect(out.attackerSurvivors).toBe(Math.floor(10 * (1 - 0.4 ** 1.5)));
    expect(out.attackerLost).toBe(10 - out.attackerSurvivors);
    expect(out.defenders).toEqual([{ power: 4, survivors: 0, lost: 4 }]);
  });

  it('needs one troop more than the walls to take an empty town', () => {
    expect(siege({ attacker: 20, walls: 20 }).winner).toBe('DEFENDER');
    const won = siege({ attacker: 21, walls: 20 });
    expect(won.winner).toBe('ATTACKER');
    expect(won.attackerSurvivors).toBe(Math.floor(21 * (1 - (20 / 21) ** 1.5)));
  });

  it('adds the walls to the fortified troops of the owner only', () => {
    const out = siege({ attacker: 1, defenders: [10, 4], fort: 1.5, walls: 30 });
    expect(out.defenders.map((d) => d.power)).toEqual([45, 6]);
    expect(out.defenderPower).toBe(51);
  });

  it('scales each contingent by its own defense multiplier', () => {
    const out = siege({ attacker: 1, defenders: [10, 10], defense: [1.5, 1], fort: 2, walls: 5 });
    expect(out.defenders.map((d) => d.power)).toEqual([35, 20]);
  });

  it('scales the attack with the attack multiplier', () => {
    expect(siege({ attacker: 20, attackMult: 1.1, walls: 21 }).winner).toBe('ATTACKER');
    expect(siege({ attacker: 20, walls: 21 }).winner).toBe('DEFENDER');
  });

  it('takes an undefended town without losses', () => {
    const out = siege({ attacker: 3 });
    expect(out.defenderPower).toBe(0);
    expect(out.attackerSurvivors).toBe(3);
  });

  it('wipes the attacker when the defender wins and keeps the walls', () => {
    const out = siege({ attacker: 10, defenders: [20], walls: 5 });
    expect(out.winner).toBe('DEFENDER');
    expect(out.attackerSurvivors).toBe(0);
    const kept = Math.floor(20 * (1 - (10 / 25) ** 1.5));
    expect(out.defenders[0]).toEqual({ power: 25, survivors: kept, lost: 20 - kept });
    expect(summarizeSiege(out)).toMatchObject({ defenderSurvivors: kept, attackerLost: 10 });
  });
});
