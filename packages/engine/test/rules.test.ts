import { describe, expect, it } from 'vitest';
import { advanceTo, execute } from '../src/game';
import type { ExecResult, GameState, RuleId } from '../src/types';
import {
  capitalOf,
  game,
  give,
  innerRingTown,
  lord,
  MIN,
  neutralsBeside,
  T0,
  townOutOfReach,
  troops,
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
    expectRule(execute(state, 'h2', { type: 'RESPECIALIZE', townId: capital, spec: 'ARCHER' }, T0), 'R03');
    expectRule(
      execute(state, 'h2', { type: 'SEND', from: capital, to: neutral, troops: troops(1) }, T0),
      'R03',
    );
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0));
  });

  it('R04 upgrades stop at the maximum tier', () => {
    const { state, capital } = setup();
    lord(state, 'h1').gold = 10_000;
    const town = state.towns[capital];
    if (!town) throw new Error('no town');
    town.tier = 4;
    expectOk(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0));
    expect(town.tier).toBe(5);
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0), 'R04');
  });

  it('R05 the lord can pay', () => {
    const { state, capital } = setup();
    lord(state, 'h1').gold = 0;
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0), 'R05');
    expectRule(execute(state, 'h1', { type: 'RESPECIALIZE', townId: capital, spec: 'ARCHER' }, T0), 'R05');
    lord(state, 'h1').gold = 240;
    const result = execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0);
    expectOk(result);
    expect(lord(state, 'h1').gold).toBe(0);
    expect(result.events).toEqual([
      { type: 'TOWN_UPGRADED', at: T0, lordId: 'h1', townId: capital, tier: 3, cost: 240 },
    ]);
  });

  it('R06 respecialization needs a different type', () => {
    const { state, capital } = setup();
    expectRule(execute(state, 'h1', { type: 'RESPECIALIZE', townId: capital, spec: 'LANCER' }, T0), 'R06');
    const town = state.towns[capital];
    if (!town) throw new Error('no town');
    town.carry = 0.5;
    const result = execute(state, 'h1', { type: 'RESPECIALIZE', townId: capital, spec: 'GRIFFIN' }, T0);
    expectOk(result);
    expect(town.spec).toBe('GRIFFIN');
    expect(town.carry).toBe(0);
    expect(lord(state, 'h1').gold).toBe(120 - 80);
  });

  it('R07 troop amounts are whole, non-negative and enough', () => {
    const { state, capital, neutral } = setup();
    const send = (t: ReturnType<typeof troops>) =>
      execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: t }, T0);
    expectRule(send(troops(-1, 5)), 'R07');
    expectRule(send(troops(1.5)), 'R07');
    expectRule(send(troops(0)), 'R07');
    expectOk(send(troops(1)));
  });

  it('R08 a town cannot send more than it holds', () => {
    const { state, capital, neutral } = setup();
    expectRule(
      execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: troops(19) }, T0),
      'R08',
    );
    expectRule(
      execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: troops(0, 0, 9) }, T0),
      'R08',
    );
    expectOk(
      execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: troops(18, 14, 8) }, T0),
    );
  });

  it('R09 the target differs from the source', () => {
    const { state, capital } = setup();
    expectRule(
      execute(state, 'h1', { type: 'SEND', from: capital, to: capital, troops: troops(1) }, T0),
      'R09',
    );
  });

  it('R10 the target is on the same isle or one lane away', () => {
    const { state, capital, neutral } = setup();
    const far = townOutOfReach(state, capitalOf(state, 'h1'));
    expectRule(
      execute(state, 'h1', { type: 'SEND', from: capital, to: far.id, troops: troops(1) }, T0),
      'R10',
    );
    expectOk(execute(state, 'h1', { type: 'SEND', from: capital, to: neutral, troops: troops(1) }, T0));
  });

  it('R11 the Throne cannot be targeted while sealed', () => {
    const { state } = setup();
    const inner = innerRingTown(state);
    give(state, inner, 'h1', troops(50));
    const cmd = { type: 'SEND', from: inner.id, to: state.throneTownId, troops: troops(5) };
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
    const cmd = { type: 'SEND', from: capital.id, to: neutral.id, troops: troops(1) };
    expectOk(execute(state, 'h1', cmd, T0));
    expectRule(execute(state, 'h1', cmd, T0), 'R12');
  });

  it('R13 edicts come only from the pending draft', () => {
    const { state } = setup();
    expectRule(execute(state, 'h1', { type: 'CHOOSE_EDICT', edict: 'LEGEND' }, T0), 'R13');
    lord(state, 'h1').draft = ['LEGEND', 'MUSTER', 'VETERANS'];
    expectRule(execute(state, 'h1', { type: 'CHOOSE_EDICT', edict: 'ARCHITECTS' }, T0), 'R13');
    const result = execute(state, 'h1', { type: 'CHOOSE_EDICT', edict: 'LEGEND' }, T0);
    expectOk(result);
    expect(lord(state, 'h1').edicts).toEqual(['LEGEND']);
    expect(lord(state, 'h1').draft).toBeNull();
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
      { type: 'RESPECIALIZE', townId: capital, spec: 'DRAGON' },
      { type: 'SEND', from: capital, to: neutral, troops: { LANCER: 1, ARCHER: 1 } },
      { type: 'SEND', from: capital, to: neutral },
      { type: 'CHOOSE_EDICT', edict: 'FLIGHT' },
    ];
    for (const cmd of bad) expectRule(execute(state, 'h1', cmd, T0), 'R14');
  });

  it('never mutates the state when a command is rejected', () => {
    const { state, capital } = setup();
    const before = JSON.stringify(state);
    expectRule(execute(state, 'h1', { type: 'UPGRADE', townId: capital }, T0 + 5 * MIN), 'R05');
    expect(JSON.stringify(state)).toBe(before);
  });
});
