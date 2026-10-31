import { TROOP_TYPES } from '@si/config/constants';
import type { Troops } from './types';

export function zeroTroops(): Troops {
  return { LANCER: 0, ARCHER: 0, GRIFFIN: 0 };
}

export function cloneTroops(t: Troops): Troops {
  return { LANCER: t.LANCER, ARCHER: t.ARCHER, GRIFFIN: t.GRIFFIN };
}

export function totalTroops(t: Troops): number {
  return t.LANCER + t.ARCHER + t.GRIFFIN;
}

export function addTroops(a: Troops, b: Troops): Troops {
  return { LANCER: a.LANCER + b.LANCER, ARCHER: a.ARCHER + b.ARCHER, GRIFFIN: a.GRIFFIN + b.GRIFFIN };
}

export function subTroops(a: Troops, b: Troops): Troops {
  return { LANCER: a.LANCER - b.LANCER, ARCHER: a.ARCHER - b.ARCHER, GRIFFIN: a.GRIFFIN - b.GRIFFIN };
}

export function scaleTroops(t: Troops, factor: number): Troops {
  return {
    LANCER: Math.floor(t.LANCER * factor),
    ARCHER: Math.floor(t.ARCHER * factor),
    GRIFFIN: Math.floor(t.GRIFFIN * factor),
  };
}

export function fitsIn(part: Troops, whole: Troops): boolean {
  return TROOP_TYPES.every((type) => part[type] <= whole[type]);
}

/** Splits a neutral garrison: `mainShare` of the town's specialization, the rest evenly. */
export function splitGarrison(total: number, main: keyof Troops, mainShare: number): Troops {
  const others = TROOP_TYPES.filter((type) => type !== main);
  const each = Math.floor((total - Math.round(total * mainShare)) / others.length);
  const result = zeroTroops();
  for (const type of others) result[type] = each;
  result[main] = total - each * others.length;
  return result;
}
