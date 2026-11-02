import { describe, expect, it } from 'vitest';
import { plunderAt, townWalls } from '../src/economy';
import { advanceTo, execute } from '../src/game';
import type { BattleReport, DomainEvent, GameState } from '../src/types';
import { view } from '../src/view';
import { gainXp, migrateState, recoverTroops, xpForLevel } from '../src/world';
import {
  capitalOf,
  game,
  give,
  lord,
  neutralsBeside,
  NO_PRODUCTION,
  NO_RECOVERY,
  OPEN_CAPITALS,
  T0,
} from './helpers';

/** Sends `troops` from `lordId`'s capital to `target` and resolves the battle. */
function attack(state: GameState, lordId: string, targetId: number, troops: number): DomainEvent[] {
  const capital = capitalOf(state, lordId);
  const sent = execute(state, lordId, { type: 'SEND', from: capital.id, to: targetId, troops }, T0);
  const march = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
  if (!march || march.type !== 'MARCH_LAUNCHED') throw new Error(`no march: ${JSON.stringify(sent)}`);
  return advanceTo(state, march.march.arriveAt);
}

function reportOf(events: DomainEvent[]): BattleReport {
  const battle = events.find((e) => e.type === 'BATTLE');
  if (!battle || battle.type !== 'BATTLE') throw new Error('no battle');
  return battle.report;
}

describe('kill rewards', () => {
  it('pays 5 experience and 5 gold per troop killed attacking', () => {
    const state = game({ config: { ...NO_PRODUCTION, ...NO_RECOVERY } });
    const target = neutralsBeside(state, capitalOf(state, 'h1'))[0];
    if (!target) throw new Error('no neutral');
    give(state, target, null, 6);
    target.tier = 1;
    const events = attack(state, 'h1', target.id, 40);
    const report = reportOf(events);
    expect(report).toMatchObject({ captured: true, defenderLost: 6, walls: 20 });
    expect(report.rewards).toEqual({ attackerXp: 30, attackerGold: 30, defenderXp: 0, defenderGold: 0 });
    expect(lord(state, 'h1')).toMatchObject({
      level: 1,
      xp: 30,
      gold: 120 + 30 + plunderAt(state.config, 1),
    });
    expect(events.map((e) => e.type).slice(0, 2)).toEqual(['BATTLE', 'TOWN_CAPTURED']);
  });

  it('pays 3 experience and 3 gold per troop killed defending, shared by the power brought', () => {
    const state = game({
      lords: [
        ...['h1', 'h2', 'h3'].map((id) => ({
          id,
          name: id,
          color: '#123456',
          isBot: false,
          clanId: id === 'h3' ? null : 'c',
        })),
      ],
      config: { ...NO_PRODUCTION, ...NO_RECOVERY, ...OPEN_CAPITALS },
    });
    const town = capitalOf(state, 'h1');
    town.garrison = 100;
    town.stationed = [{ lordId: 'h2', troops: 100 }];
    const report = reportOf(attack(state, 'h3', town.id, 40));
    expect(report.winner).toBe('DEFENDER');
    // The losing attacker still kills a few defenders and is paid for them.
    expect(report.rewards).toMatchObject({
      attackerXp: report.defenderLost * 5,
      attackerGold: report.defenderLost * 5,
      defenderXp: 120,
    });
    // Paid share by share, so it may land a hair off the round total.
    expect(report.rewards.defenderGold).toBeCloseTo(120, 9);
    expect(report.defenderLost).toBeGreaterThan(0);
    const owner = 100 * report.fort + townWalls(state, town);
    const ally = 100 * report.fort;
    // Both shares are enough for level 2, which costs 50.
    expect(lord(state, 'h1').level).toBe(2);
    expect(lord(state, 'h2').level).toBe(2);
    expect(lord(state, 'h1').xp + 50).toBeCloseTo((120 * owner) / (owner + ally), 9);
    expect(lord(state, 'h2').xp + 50).toBeCloseTo((120 * ally) / (owner + ally), 9);
    expect(lord(state, 'h2').gold).toBeCloseTo(120 + (120 * ally) / (owner + ally), 9);
  });
});

describe('troop recovery', () => {
  it('returns 90 % of the attacker dead to its capital at once', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = neutralsBeside(state, capital)[0];
    if (!target) throw new Error('no neutral');
    give(state, target, null, 30);
    target.tier = 1;
    const report = reportOf(attack(state, 'h1', target.id, 40));
    expect(report.captured).toBe(false);
    expect(report.attackerLost).toBe(40);
    expect(report.attackerRecovered).toBe(36);
    expect(report.defenderRecovered).toBe(0);
    expect(capital.garrison).toBe(36);
  });

  it('returns 90 % of the defender dead to the capital, wherever it moves', () => {
    const state = game({ config: { ...NO_PRODUCTION, ...OPEN_CAPITALS } });
    const capital = capitalOf(state, 'h2');
    const other = neutralsBeside(state, capital)[0];
    if (!other) throw new Error('no neutral');
    give(state, other, 'h2', 0);
    capital.garrison = 10;
    capitalOf(state, 'h1').garrison = 1000;
    const report = reportOf(attack(state, 'h1', capital.id, 1000));
    expect(report.captured).toBe(true);
    expect(report.defenderRecovered).toBe(9);
    expect(lord(state, 'h2').capitalId).toBe(other.id);
    expect(other.garrison).toBe(9);
  });

  it('falls back to the highest-level town and drops troops with no town left', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    const capital = capitalOf(state, 'h1');
    const extra = neutralsBeside(state, capital)[0];
    if (!extra) throw new Error('no neutral');
    give(state, extra, 'h1', 0);
    extra.tier = 3;
    h1.capitalId = null;
    expect(recoverTroops(state, 'h1', 10, 0.9)).toBe(9);
    expect(extra.garrison).toBe(9);
    expect(recoverTroops(state, 'h1', 1, 0.9)).toBe(0);
    for (const town of state.towns) if (town.owner === 'h1') town.owner = null;
    expect(recoverTroops(state, 'h1', 10, 0.9)).toBe(0);
  });
});

describe('lord levels and skills', () => {
  it('levels up with experience and gives one skill point per level', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    const events: DomainEvent[] = [];
    const needed = xpForLevel(state, 1) + xpForLevel(state, 2) + xpForLevel(state, 3);
    gainXp(state, h1, needed + 1, T0, events);
    expect(h1).toMatchObject({ level: 4, xp: 1 });
    expect(events).toEqual([2, 3, 4].map((level) => ({ type: 'LEVEL_UP', at: T0, lordId: 'h1', level })));
    expect(xpForLevel(state, 1)).toBe(50);
    expect(xpForLevel(state, 2)).toBe(125);
    expect(view(state, 'h1', T0).me.skillPoints).toBe(3);
  });

  it('spends points one at a time, only while there are some left', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    expect(execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'GOLD' }, T0)).toMatchObject({
      ok: false,
      error: { rule: 'R13', code: 'NO_SKILL_POINTS' },
    });
    h1.level = 3;
    const learned = execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'ATTACK' }, T0);
    expect(learned.events).toEqual([
      { type: 'SKILL_LEARNED', at: T0, lordId: 'h1', skill: 'ATTACK', points: 1 },
    ]);
    execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'ATTACK' }, T0);
    expect(h1.skills).toEqual({ GOLD: 0, TROOPS: 0, ATTACK: 2 });
    expect(execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'GOLD' }, T0).ok).toBe(false);
    expect(execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'WINGS' }, T0)).toMatchObject({
      error: { code: 'BAD_COMMAND' },
    });
    expect(view(state, 'h1', T0).me).toMatchObject({
      skills: { GOLD: 0, TROOPS: 0, ATTACK: 2 },
      skillPoints: 0,
      skillPerPoint: { GOLD: 0.05, TROOPS: 0.05, ATTACK: 0.05 },
      recovery: { attacker: 0.9, defender: 0.9 },
    });
  });

  it('stops at the maximum level and shows progress in the view', () => {
    const state = game({ config: { levels: { maxLevel: 3 } } });
    const h1 = lord(state, 'h1');
    gainXp(state, h1, 10_000, T0, []);
    expect(h1).toMatchObject({ level: 3, xp: 0 });
    expect(view(state, 'h1', T0).me).toMatchObject({ level: 3, xp: 0, nextLevelXp: null });
    expect(view(state, 'h2', T0).me).toMatchObject({ level: 1, xp: 0, nextLevelXp: 50 });
    expect(view(state, 'h2', T0).lords.find((l) => l.id === 'h1')?.level).toBe(3);
  });

  it('fills levels in old saves', () => {
    const state = game();
    const old = JSON.parse(JSON.stringify(state)) as GameState;
    delete (old.lords.h2 as Partial<ReturnType<typeof lord>>).level;
    delete (old.lords.h2 as Partial<ReturnType<typeof lord>>).xp;
    expect(migrateState(old).lords.h2).toMatchObject({ level: 1, xp: 0 });
  });
});
