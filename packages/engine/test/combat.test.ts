import { defaultConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { armyPower, counter, counterVs, resolveBattle, type BattleInput } from '../src/combat';
import { config, troops } from './helpers';

const ONES = troops(1, 1, 1);
const cfg = defaultConfig;

function battle(input: Partial<BattleInput> & Pick<BattleInput, 'attacker' | 'defender'>, c = cfg) {
  return resolveBattle(c, {
    attackMults: ONES,
    defenseMults: ONES,
    fort: 1,
    attackerLossMult: 1,
    defenderLossMult: 1,
    ...input,
  });
}

describe('counters', () => {
  it('follows the triangle lancer > griffin > archer > lancer', () => {
    expect(counter(cfg, 'LANCER', 'GRIFFIN')).toBe(1.5);
    expect(counter(cfg, 'GRIFFIN', 'ARCHER')).toBe(1.5);
    expect(counter(cfg, 'ARCHER', 'LANCER')).toBe(1.5);
    expect(counter(cfg, 'GRIFFIN', 'LANCER')).toBeCloseTo(1 / 1.5, 12);
    expect(counter(cfg, 'ARCHER', 'ARCHER')).toBe(1);
  });

  it('averages over the enemy composition', () => {
    expect(counterVs(cfg, 'LANCER', troops(1, 1, 1))).toBeCloseTo((1 + 1 / 1.5 + 1.5) / 3, 12);
    expect(counterVs(cfg, 'LANCER', troops(0, 0, 4))).toBe(1.5);
    expect(counterVs(cfg, 'LANCER', troops(0, 0, 0))).toBe(1);
  });

  it('weights power by stat, type multiplier and counters', () => {
    expect(armyPower(cfg, troops(10), troops(0, 0, 10), 'attack', ONES)).toBe(15);
    expect(armyPower(cfg, troops(10), troops(10), 'defense', troops(2, 1, 1))).toBeCloseTo(24, 12);
  });
});

describe('resolveBattle', () => {
  it('lets the stronger side win and floors the winner survivors', () => {
    const out = battle({ attacker: troops(10), defender: troops(0, 0, 10) });
    expect(out.attackerPower).toBe(15);
    expect(out.defenderPower).toBeCloseTo((10 * 0.8) / 1.5, 12);
    expect(out.winner).toBe('ATTACKER');
    const loss = (out.defenderPower / out.attackerPower) ** 1.5;
    expect(out.attackerSurvivors).toEqual(troops(Math.floor(10 * (1 - loss))));
    expect(out.attackerSurvivors.LANCER).toBe(7);
    expect(out.defenderSurvivors).toEqual(troops(0));
    expect(out.attackerLost).toEqual(troops(3));
    expect(out.defenderLost).toEqual(troops(0, 0, 10));
  });

  it('gives ties to the defender', () => {
    const even = config({ troops: { LANCER: { attack: 1, defense: 1, speed: 1, prodMult: 1 } } });
    const out = battle({ attacker: troops(10), defender: troops(10) }, even);
    expect(out.attackerPower).toBe(out.defenderPower);
    expect(out.winner).toBe('DEFENDER');
    expect(out.attackerSurvivors).toEqual(troops(0));
  });

  it('takes an empty town without losses', () => {
    const out = battle({ attacker: troops(3), defender: troops(0) });
    expect(out.defenderPower).toBe(0);
    expect(out.winner).toBe('ATTACKER');
    expect(out.attackerSurvivors).toEqual(troops(3));
  });

  it('multiplies defense by fortification and scales winner losses', () => {
    const plain = battle({ attacker: troops(10), defender: troops(4) });
    const walled = battle({ attacker: troops(10), defender: troops(4), fort: 2 });
    expect(walled.defenderPower).toBeCloseTo(plain.defenderPower * 2, 12);
    const veteran = battle({ attacker: troops(100), defender: troops(40), attackerLossMult: 0.5 });
    const normal = battle({ attacker: troops(100), defender: troops(40) });
    expect(veteran.attackerSurvivors.LANCER).toBeGreaterThan(normal.attackerSurvivors.LANCER);
  });

  it('wipes the attacker when the defender wins', () => {
    const out = battle({ attacker: troops(2), defender: troops(10) });
    expect(out.winner).toBe('DEFENDER');
    expect(out.attackerSurvivors).toEqual(troops(0));
    expect(out.defenderSurvivors.LANCER).toBeGreaterThan(0);
    expect(out.defenderSurvivors.LANCER).toBeLessThan(10);
  });
});
