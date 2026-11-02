import { describe, expect, it } from 'vitest';
import { advanceTo, execute } from '../src/game';
import { travelInfo } from '../src/marches';
import { previewSend } from '../src/preview';
import { capitalOf, game, give, MIN, neutralsBeside, T0, townAcrossLane, townOutOfReach } from './helpers';

describe('previewSend', () => {
  it('predicts the battle that the march will fight', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = neutralsBeside(state, capital)[0];
    if (!target) throw new Error('no neutral');
    const army = 40;
    const preview = previewSend(state, 'h1', capital.id, target.id, army, T0);
    expect(preview.error).toBeNull();
    expect(preview.reinforce).toBe(false);
    expect(preview.travel?.sky).toBe(false);
    expect(preview.later).toEqual([]);
    expect(preview.battle?.winner).toBe('ATTACKER');
    expect(preview.arriveAt).toBe(T0 + (preview.travel?.durationMs ?? 0));

    const result = execute(state, 'h1', { type: 'SEND', from: capital.id, to: target.id, troops: army }, T0);
    expect(result.ok).toBe(true);
    const events = advanceTo(state, preview.arriveAt ?? T0);
    const battle = events.find((e) => e.type === 'BATTLE');
    if (!battle || battle.type !== 'BATTLE') throw new Error('no battle');
    expect(battle.report.attackerPower).toBe(preview.battle?.attackerPower);
    expect(battle.report.defenderPower).toBe(preview.battle?.defenderPower);
  });

  it('lists the travel time after each forecast wind shift', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = townAcrossLane(state, capital);
    const preview = previewSend(state, 'h1', capital.id, target.id, 1, T0);
    expect(preview.travel?.sky).toBe(true);
    expect(preview.later.map((l) => l.departAt)).toEqual([T0 + 30 * MIN, T0 + 60 * MIN]);
    for (const option of preview.later) {
      const info = travelInfo(state, 'h1', capital, target, 1, option.departAt);
      expect(option.durationMs).toBe(info.durationMs);
      expect(option.windFactor).toBe(info.windFactor);
    }
  });

  it('reports rule errors and skips battles it cannot predict', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const far = townOutOfReach(state, capital);
    const blocked = previewSend(state, 'h1', capital.id, far.id, 1, T0);
    expect(blocked.error?.rule).toBe('R10');
    expect(blocked.battle).toBeNull();
    expect(blocked.travel).not.toBeNull();

    const own = neutralsBeside(state, capital)[0];
    if (!own) throw new Error('no neutral');
    give(state, own, 'h1', 0);
    const reinforce = previewSend(state, 'h1', capital.id, own.id, 5, T0);
    expect(reinforce.reinforce).toBe(true);
    expect(reinforce.battle).toBeNull();

    const self = previewSend(state, 'h1', capital.id, capital.id, 1, T0);
    expect(self.error?.rule).toBe('R09');
    expect(self.travel).toBeNull();
  });
});
