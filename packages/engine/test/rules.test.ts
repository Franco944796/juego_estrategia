import { describe, expect, it } from 'vitest';
import { upgradeCostAt } from '../src/economy';
import { advanceTo, execute } from '../src/game';
import type { ExecResult, GameState, RuleId } from '../src/types';
import {
  capitalOf,
  game,
  give,
  lord,
  MIN,
  neutralsBeside,
  T0,
  publicNeutral,
  townOutOfReach,
} from './helpers';

function expectRule(result: ExecResult, rule: RuleId): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.rule).toBe(rule);
}

function expectOk(result: ExecResult): void {
  if (!result.ok) throw new Error(`rejected by ${result.error.rule}: ${result.error.message}`);
}

function setup(): { state: GameState; capital: number; neutral: number } {
  const state = game();
  const capital = capitalOf(state, 'h1');
  const neutral = neutralsBeside(state, capital)[0];
  if (!neutral) throw new Error('no neutral');
  return { state, capital: capital.id, neutral: neutral.id };
}

describe('rule register', () => {
  it('R01 the acting lord exists and is alive', () => {
    const { state, capital } = setup();
    expectRule(execute(state, 'ghost', { type: 'UPGRADE', townId: capital }, T0), 'R01');
    lord(state, 'h2').alive = false;
    expectRule(execute(state, 'h2', { type: 'UPGRADE', townId: capital }, T0), 'R01');
    lord(state, 'h1').gold = 1000;
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0));
  });

  it('R02 the season is running', () => {
    const { state, capital } = setup();
    lord(state, 'h1').gold = 10_000;
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0 - 1), 'R02');
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0 + MIN));
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, state.endsAt), 'R02');
    expect(state.status).toBe('ENDED');
  });

  it('R03 only the owner acts on a town', () => {
    const { state, capital, neutral } = setup();
    lord(state, 'h1').gold = 1000;
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: neutral }, T0), 'R03');
    expectRule(execute(state, 'h2', { type: 'UPGRADE', townId: capital }, T0), 'R03');
    expectRule(execute(state, 'h2', { type: 'SEND', from: capital, to: neutral, troops: 1 }, T0), 'R03');
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0));
  });

  it('R04 upgrades stop at the maximum level', () => {
    const { state, capital } = setup();
    lord(state, 'h1').gold = 1e30;
    const town = state.towns[capital];
    if (!town) throw new Error('no town');
    town.tier = 99;
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital, levels: 5 }, T0));
    expect(town.tier).toBe(100);
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0), 'R04');
  });

  it('R05 the lord can pay for at least one level, and buys as many as asked and paid for', () => {
    const { state, capital } = setup();
    const cfg = state.config;
    lord(state, 'h1').gold = 0;
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0), 'R05');
    const cost = upgradeCostAt(cfg, 2) ?? 0;
    lord(state, 'h1').gold = cost;
    const result = execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0);
    expectOk(result);
    expect(lord(state, 'h1').gold).toBe(0);
    expect(result.events).toEqual([
      { type: 'TOWN_UPGRADED', at: T0, lordId: 'h1', townId: capital, tier: 3, cost },
    ]);
    const two = (upgradeCostAt(cfg, 3) ?? 0) + (upgradeCostAt(cfg, 4) ?? 0);
    lord(state, 'h1').gold = two + 1;
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital, levels: 10 }, T0));
    expect(state.towns[capital]?.tier).toBe(5);
    expect(lord(state, 'h1').gold).toBeCloseTo(1, 6);
  });

  it('R07 the troop count is whole and enough', () => {
    const { state, capital, neutral } = setup();
    const send = (t: number) =>
      execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: t }, T0);
    expectRule(send(-1), 'R07');
    expectRule(send(1.5), 'R07');
    expectRule(send(0), 'R07');
    expectOk(send(1));
  });

  it('R08 a town cannot send more than it holds', () => {
    const { state, capital, neutral } = setup();
    expectRule(execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: 41 }, T0), 'R08');
    expectOk(execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: 40 }, T0));
  });

  it('R09 the target differs from the source', () => {
    const { state, capital } = setup();
    expectRule(execute(state, 'h1', { type: 'SEND', from: capital, to: capital, troops: 1 }, T0), 'R09');
  });

  it('R10 the target is on the same isle or one lane away', () => {
    const { state, capital, neutral } = setup();
    const far = townOutOfReach(state, capitalOf(state, 'h1'));
    expectRule(execute(state, 'h1', { type: 'SEND', from: capital, to: far.id, troops: 1 }, T0), 'R10');
    expectOk(execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: 1 }, T0));
  });

  it('R11 the Throne cannot be targeted while sealed', () => {
    const state = game({ config: { throne: { enabled: true } } });
    const inner = publicNeutral(state);
    give(state, inner, 'h1', 50);
    const cmd = { type: 'SEND', from: inner.id, to: state.throneTownId, troops: 5 };
    expectRule(execute(state, 'h1', cmd, T0), 'R11');
    const events = advanceTo(state, state.throneUnsealAt);
    expect(events.some((e) => e.type === 'THRONE_UNSEALED')).toBe(true);
    expectOk(execute(state, 'h1', cmd, state.throneUnsealAt));
  });

  it('R12 a lord keeps a bounded number of marches in flight', () => {
    const state = game({ config: { march: { maxActivePerLord: 1 } } });
    const capital = capitalOf(state, 'h1');
    const neutral = neutralsBeside(state, capital)[0];
    if (!neutral) throw new Error('no neutral');
    const cmd = { type: 'SEND', from: capital.id, to: neutral.id, troops: 1 };
    expectOk(execute(state, 'h1', cmd, T0));
    expectRule(execute(state, 'h1', cmd, T0), 'R12');
  });

  it('R13 skills need an unspent point', () => {
    const { state } = setup();
    expectRule(execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'GOLD' }, T0), 'R13');
    lord(state, 'h1').level = 2;
    expectOk(execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'GOLD' }, T0));
    expect(lord(state, 'h1').skills.GOLD).toBe(1);
    expectRule(execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'TROOPS' }, T0), 'R13');
  });

  it('R14 malformed commands are rejected', () => {
    const { state, capital, neutral } = setup();
    const bad: unknown[] = [
      null,
      'UPGRADE',
      { type: 'NOPE' },
      { type: 'UPGRADE' },
      { type: 'UPGRADE', townId: 99_999 },
      { type: 'UPGRADE', townId: 1.5 },
      { type: 'UPGRADE', townId: capital, levels: 0 },
      { type: 'UPGRADE', townId: capital, levels: 1.5 },
      { type: 'UPGRADE', townId: capital, levels: '3' },
      { type: 'RESPECIALIZE', townId: capital, spec: 'LANCER' },
      { type: 'SEND', from: capital, to: neutral, troops: { LANCER: 1, ARCHER: 1 } },
      { type: 'SEND', from: capital, to: neutral },
      { type: 'LEARN_SKILL', skill: 'FLIGHT' },
      { type: 'LEARN_SKILL' },
    ];
    for (const cmd of bad) expectRule(execute(state, 'h1', cmd, T0), 'R14');
  });

  it('never mutates the state when a command is rejected', () => {
    const { state, capital, neutral } = setup();
    const before = JSON.stringify(state);
    const tooMany = { type: 'SEND', from: capital, to: neutral, troops: 10_000 };
    expectRule(execute(state, 'h1', tooMany, T0 + 5 * MIN), 'R08');
    expect(JSON.stringify(state)).toBe(before);
  });
});
