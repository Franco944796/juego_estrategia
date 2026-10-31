import { TROOP_TYPES } from '@si/config/constants';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectedGarrison } from '../src/economy';
import { advanceTo, createGame, execute } from '../src/game';
import { hashState } from '../src/hash';
import { scaleTroops } from '../src/troops';
import type { GameState } from '../src/types';
import { reachableTowns } from '../src/world';
import { bots, config, humans, MIN, T0, troops } from './helpers';

interface Step {
  dt: number;
  lord: number;
  kind: number;
  a: number;
  b: number;
  frac: number;
  spec: number;
  probe: boolean;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  dt: fc.integer({ min: 0, max: 15 * MIN }),
  lord: fc.nat(1),
  kind: fc.nat(3),
  a: fc.nat(50),
  b: fc.nat(50),
  frac: fc.double({ min: 0, max: 1, noNaN: true }),
  spec: fc.nat(2),
  probe: fc.boolean(),
});

function buildCommand(state: GameState, lordId: string, step: Step, now: number): unknown {
  const own = state.towns.filter((t) => t.owner === lordId);
  const from = own[step.a % Math.max(1, own.length)];
  switch (step.kind) {
    case 0:
      return { type: 'UPGRADE', townId: from?.id ?? step.a };
    case 1:
      return { type: 'RESPECIALIZE', townId: from?.id ?? step.a, spec: TROOP_TYPES[step.spec] };
    case 2: {
      if (!from) return { type: 'SEND', from: step.a, to: step.b, troops: troops(1) };
      const targets = reachableTowns(state, from);
      const to = targets[step.b % targets.length];
      return {
        type: 'SEND',
        from: from.id,
        to: to?.id ?? step.b,
        troops: scaleTroops(projectedGarrison(state, from, now), step.frac),
      };
    }
    default: {
      const draft = state.lords[lordId]?.draft ?? null;
      return { type: 'CHOOSE_EDICT', edict: draft ? draft[step.b % draft.length] : 'LEGEND' };
    }
  }
}

function checkInvariants(state: GameState): void {
  const wholeAndPositive = (n: number): boolean => Number.isInteger(n) && n >= 0;
  for (const town of state.towns) {
    for (const type of TROOP_TYPES) expect(wholeAndPositive(town.garrison[type])).toBe(true);
    if (town.owner === null) expect(town.isCapital).toBe(false);
    else expect(state.lords[town.owner]).toBeDefined();
  }
  for (const march of state.marches) {
    for (const type of TROOP_TYPES) expect(wholeAndPositive(march.troops[type])).toBe(true);
  }
  for (const id of state.lordOrder) {
    const l = state.lords[id];
    if (!l) throw new Error('missing lord');
    expect(l.gold).toBeGreaterThanOrEqual(0);
    expect(l.dominion).toBeGreaterThanOrEqual(0);
    const capitals = state.towns.filter((t) => t.owner === id && t.isCapital).map((t) => t.id);
    expect(capitals).toEqual(l.capitalId === null ? [] : [l.capitalId]);
  }
}

describe('determinism and invariants', () => {
  it('replaying the accepted commands rebuilds the same state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.array(stepArb, { minLength: 1, maxLength: 30 }),
        (seed, steps) => {
          const lords = [...humans(2), ...bots(2)];
          const cfg = config();
          const live = createGame({ seed, config: cfg, startsAt: T0, lords });
          const log: { lordId: string; command: unknown; now: number }[] = [];
          let now = T0;
          for (const step of steps) {
            now += step.dt;
            if (step.probe) advanceTo(live, now - Math.floor(step.dt / 2));
            const lordId = step.lord === 0 ? 'h1' : 'h2';
            const command = buildCommand(live, lordId, step, now);
            if (execute(live, lordId, command, now).ok) log.push({ lordId, command, now });
            checkInvariants(live);
          }
          const end = now + 10 * MIN;
          advanceTo(live, end);
          checkInvariants(live);

          const replay = createGame({ seed, config: cfg, startsAt: T0, lords });
          for (const entry of log)
            expect(execute(replay, entry.lordId, entry.command, entry.now).ok).toBe(true);
          advanceTo(replay, end);
          expect(hashState(replay)).toBe(hashState(live));
        },
      ),
      { numRuns: 25 },
    );
  });
});
