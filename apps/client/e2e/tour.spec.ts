import { defaultConfig } from '@si/config';
import {
  advanceTo,
  createGame,
  execute,
  growIsle,
  type GameState,
  type LordInit,
  type LordView,
} from '@si/engine';
import { expect, test, type Page } from '@playwright/test';

// The single-file client build, opened straight from disk: single-player needs no server.
const DEMO = new URL('../dist/index.html', import.meta.url).href;
const SAVE_KEY = 'shattered-isles:save:v1';
const ME = 'you';

function newState(seed = 4242): GameState {
  const colors = defaultConfig.display.lordColors;
  const lords: LordInit[] = [
    { id: ME, name: 'Vos', color: colors[0] ?? '#fff', isBot: false },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `bot${i + 1}`,
      name: `Casa ${i + 1}`,
      color: colors[i + 1] ?? '#fff',
      isBot: true,
    })),
  ];
  return createGame({ seed, config: defaultConfig, startsAt: 0, lords });
}

async function load(page: Page, state: GameState, gameNow: number, speed = 1): Promise<LordView> {
  await page.goto(DEMO);
  await page.evaluate(
    ([key, save]) => {
      localStorage.setItem(key, save);
      localStorage.setItem('shattered-isles:tutorial-done', '1');
    },
    [SAVE_KEY, JSON.stringify({ version: 5, state, gameNow, speed })] as const,
  );
  await page.reload();
  await page.getByTestId('continue-game').click();
  await page.waitForFunction(() => Boolean(window.__shatteredIsles?.view()));
  const view = await page.evaluate(() => window.__shatteredIsles?.view() ?? null);
  if (!view) throw new Error('no view');
  return view;
}

/** Pans the camera to the town (as selecting it would) and returns where it lands on screen. */
async function bringIntoView(page: Page, townId: number): Promise<{ x: number; y: number }> {
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await page.evaluate((id) => window.__shatteredIsles?.centerOn(id), townId);
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  const point = await page.evaluate((id) => window.__shatteredIsles?.townScreen(id) ?? null, townId);
  if (!point) throw new Error('unknown town');
  return point;
}

async function fits(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const clipped = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.stat, .chip, .nav-label, .wind-rose, .drawer h2, .drawer button, .toast, .modal-card button, .card',
      ),
    ]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}: ${el.textContent ?? ''}`),
  );
  expect(clipped).toEqual([]);
}

async function shot(page: Page, name: string): Promise<void> {
  await fits(page);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test('skill points', async ({ page }) => {
  const state = newState();
  const me = state.lords[ME];
  if (!me) throw new Error('no lord');
  me.level = 4;
  await load(page, state, 0);
  await expect(page.getByTestId('portrait-points')).toHaveText('3');
  await page.getByTestId('portrait').click();
  await expect(page.getByTestId('skill-points')).toContainText('3');
  await shot(page, 'skills');
  // Every point asks first; cancelling spends nothing.
  await page.getByTestId('learn-GOLD').click();
  await expect(page.getByTestId('skill-confirm')).toBeVisible();
  await shot(page, 'skills-confirm');
  await page.getByTestId('skill-confirm').getByRole('button').first().click();
  await expect(page.getByTestId('skill-confirm')).toHaveCount(0);
  await expect(page.getByTestId('skill-points')).toContainText('3');
  for (const id of ['GOLD', 'ATTACK', 'ATTACK']) {
    await page.getByTestId(`learn-${id}`).click();
    await page.getByTestId('confirm-skill').click();
    await expect(page.getByTestId('skill-confirm')).toHaveCount(0);
  }
  await expect(page.getByTestId('skill-points')).toContainText('0');
  await expect(page.getByTestId('learn-GOLD')).toBeDisabled();
  await expect(page.getByTestId('portrait-points')).toHaveCount(0);
  await shot(page, 'skills-spent');
});

test('gear: slots, items and equipping', async ({ page }) => {
  const state = newState();
  const me = state.lords[ME];
  if (!me) throw new Error('no lord');
  me.items = [
    { id: 'w1', slot: 'WEAPON', rarity: 'COMMON' },
    { id: 'w2', slot: 'WEAPON', rarity: 'LEGENDARY' },
    { id: 'h1', slot: 'HELMET', rarity: 'EPIC' },
    { id: 'r1', slot: 'RING', rarity: 'RARE' },
  ];
  me.gear = { WEAPON: 'w1', HELMET: 'h1' };
  me.scrap = 30;
  me.gems = [{ id: 'g1', color: 'RUBY', league: 0 }];
  await load(page, state, 0);
  await page.getByTestId('portrait').click();
  await expect(page.getByTestId('tab-gear')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gear-item')).toHaveCount(2);
  await shot(page, 'gear');
  await page.getByTestId('equip-item').click();
  await expect(page.getByTestId('slot-WEAPON')).toContainText('15');
  // The common sword is spare now: destroying it asks first and gives 10 scrap.
  await page.getByTestId('destroy-item').click();
  await expect(page.getByTestId('destroy-confirm')).toBeVisible();
  await shot(page, 'gear-destroy');
  await page.getByTestId('confirm-destroy').click();
  await expect(page.getByTestId('scrap-total')).toContainText('40');
  await expect(page.getByTestId('gear-item')).toHaveCount(1);
  // One level of the legendary (+5 %) costs 20.
  await page.getByTestId('upgrade-item').click();
  await expect(page.getByTestId('slot-WEAPON')).toContainText('20');
  await expect(page.getByTestId('scrap-total')).toContainText('20');
  await expect(page.getByTestId('item-progress')).toContainText('2/20');
  await shot(page, 'gear-upgraded');
  // The legendary has nine sockets: set the loose ruby, then take it out again.
  await page.getByTestId('socket-gem').selectOption('g1');
  await expect(page.getByTestId('unsocket-gem')).toHaveCount(1);
  await expect(page.getByTestId('gems-total')).toContainText('0');
  await shot(page, 'gear-gem');
  await page.getByTestId('unsocket-gem').click();
  await expect(page.getByTestId('unsocket-gem')).toHaveCount(0);
  await page.getByTestId('slot-RING').click();
  await page.getByTestId('equip-item').click();
  await expect(page.getByTestId('slot-RING')).toContainText('6');
  await page.getByTestId('tab-stats').click();
  await shot(page, 'profile-stats');
});

test('a big town: walls, production and upgrading several levels', async ({ page }) => {
  const state = newState();
  const me = state.lords[ME];
  const capital = state.towns[me?.capitalId ?? -1];
  if (!me || !capital) throw new Error('no capital');
  capital.tier = 40;
  capital.garrison = 3_456_789_012;
  me.gold = 1e9;
  await load(page, state, 0);
  const point = await bringIntoView(page, capital.id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('town-sheet')).toBeVisible();
  await expect(page.getByTestId('upgrade-max')).toBeVisible();
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await shot(page, 'town-big');
  await page.getByTestId('upgrade-max').click();
  await expect(page.getByTestId('upgrade-max')).toHaveCount(0);
  await shot(page, 'town-upgraded');
});

test('a grouped attack from several towns', async ({ page }) => {
  const state = newState();
  const me = state.lords[ME];
  const capital = state.towns[me?.capitalId ?? -1];
  if (!capital) throw new Error('no capital');
  const d = (t: { pos: { x: number; y: number } }): number =>
    Math.hypot(t.pos.x - capital.pos.x, t.pos.y - capital.pos.y);
  const near = state.towns
    .filter((t) => t.owner === null && t.isleId === capital.isleId)
    .sort((a, b) => d(a) - d(b));
  const target = near[6];
  if (!target) throw new Error('no target');
  near.slice(0, 6).forEach((town, i) => {
    town.owner = ME;
    town.neutralCap = 0;
    town.privateTo = null;
    town.garrison = 15 + i * 40;
  });
  await load(page, state, 0);
  const point = await bringIntoView(page, target.id);
  await page.mouse.click(point.x, point.y);
  await page.getByTestId('group-button').click();
  await expect(page.getByTestId('group-sheet')).toBeVisible();
  const boxes = page.getByTestId('group-source');
  await expect(boxes).toHaveCount(7);
  await expect(page.locator('[data-testid=group-source]:checked')).toHaveCount(5);
  await expect(page.getByTestId('group-eta')).not.toContainText('—');
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await shot(page, 'group-sheet');
  await boxes.nth(6).check();
  await expect(page.getByTestId('group-total')).toContainText('6');
  await page.getByTestId('confirm-group').click();
  await expect(page.getByTestId('group-sheet')).toHaveCount(0);
  await page.getByTestId('nav-marches').click();
  await shot(page, 'group-marches');
});

test('town stages up close, with a march on the way', async ({ page }) => {
  const state = newState();
  const me = state.lords[ME];
  const capital = state.towns[me?.capitalId ?? -1];
  if (!capital) throw new Error('no capital');
  const d = (t: { pos: { x: number; y: number } }): number =>
    Math.hypot(t.pos.x - capital.pos.x, t.pos.y - capital.pos.y);
  const near = state.towns
    .filter((t) => t.owner === null && t.isleId === capital.isleId && t.privateTo === null)
    .sort((a, b) => d(a) - d(b));
  [1, 10, 30, 60, 90, 100].forEach((tier, i) => {
    const town = near[i];
    if (!town) return;
    town.tier = tier;
    town.owner = i % 2 === 0 ? ME : 'bot1';
    town.neutralCap = 0;
  });
  const target = near[6];
  if (!target) throw new Error('no target');
  expect(execute(state, ME, { type: 'SEND', from: capital.id, to: target.id, troops: 9 }, 0).ok).toBe(true);
  await load(page, state, 0);
  const point = await bringIntoView(page, near[2]?.id ?? capital.id);
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  await shot(page, 'stages-close');
  const castle = await bringIntoView(page, near[5]?.id ?? capital.id);
  await page.mouse.move(castle.x, castle.y);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  await shot(page, 'castle-close');
});

test('scouting a rival capital reports its defense without a battle', async ({ page }) => {
  const state = newState();
  const capital = state.towns[state.lords[ME]?.capitalId ?? -1];
  const rival = state.towns[state.lords.bot1?.capitalId ?? -1];
  if (!capital || !rival) throw new Error('no capitals');
  capital.garrison = 50;
  await load(page, state, 0);
  const point = await bringIntoView(page, rival.id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('capital-immune')).toBeVisible();
  await page.getByTestId('scout-button').click();
  await expect(page.getByTestId('troop-amount')).toContainText(/· 1\//);
  await expect(page.getByTestId('confirm-send')).toBeEnabled();
  await shot(page, 'scout-sheet');
  await page.getByTestId('confirm-send').click();
  await expect(page.getByTestId('send-sheet')).toHaveCount(0);
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('scout-defense')).toBeVisible({ timeout: 45_000 });
  await shot(page, 'scout-report');
  const owner = await page.evaluate(
    (id) => window.__shatteredIsles?.view()?.towns.find((t) => t.id === id)?.owner ?? null,
    rival.id,
  );
  expect(owner).toBe('bot1');
});

test('switching to the 2D map and back', async ({ page }) => {
  const view = await load(page, newState(), 0);
  await page.getByTestId('nav-menu').click();
  await page.getByTestId('map-2d').click();
  await expect(page.getByTestId('map-2d')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('nav-menu').click();
  const capital = view.me.capitalId ?? -1;
  const point = await bringIntoView(page, capital);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('town-sheet')).toBeVisible();
  await shot(page, 'map-2d');
  await page.reload();
  await page.getByTestId('continue-game').click();
  await page.getByTestId('nav-menu').click();
  await expect(page.getByTestId('map-2d')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('map-3d').click();
  await expect(page.locator('canvas.map-overlay')).toBeVisible();
  await expect(page.getByTestId('quality-auto')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('quality-low').click();
  await expect(page.getByTestId('quality-low')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas.map-overlay')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('shattered-isles:quality'))).toBe('low');
});

test('power: a stronger rival pays double, a much weaker one is off limits', async ({ page }) => {
  const state = newState();
  const capital = state.towns[state.lords[ME]?.capitalId ?? -1];
  if (!capital) throw new Error('no capital');
  const d = (t: { pos: { x: number; y: number } }): number =>
    Math.hypot(t.pos.x - capital.pos.x, t.pos.y - capital.pos.y);
  const [strong, weak] = state.towns
    .filter((t) => t.owner === null && t.privateTo === null && t.isleId === capital.isleId)
    .sort((a, b) => d(a) - d(b));
  if (!strong || !weak) throw new Error('no towns');
  for (const [town, owner, troops] of [
    [strong, 'bot1', 5000],
    [weak, 'bot2', 0],
  ] as const) {
    town.owner = owner;
    town.neutralCap = 0;
    town.garrison = troops;
  }
  // bot2 also loses its capital's troops, so its power drops far below ours.
  const bot2 = state.towns[state.lords.bot2?.capitalId ?? -1];
  if (bot2) bot2.garrison = 0;
  capital.garrison = 400;
  // Paused: on a slow renderer bot2 would rebuild its power before the second tap.
  await load(page, state, 0, 0);
  let point = await bringIntoView(page, strong.id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('lord-power')).toContainText('×2');
  await shot(page, 'enemy-power');
  await page.getByTestId('town-sheet').getByRole('button').first().click();
  point = await bringIntoView(page, weak.id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('too-weak')).toBeVisible();
  await expect(page.getByTestId('attack-button')).toHaveCount(0);
  await shot(page, 'enemy-too-weak');
});

test('incoming attack, marches and the defense report', async ({ page }) => {
  const state = newState();
  const capital = state.towns[state.lords[ME]?.capitalId ?? -1];
  // Capitals cannot be attacked, so the bot goes for another town of ours next to it.
  const nearby = state.towns
    .filter((t) => t.isleId === capital?.isleId && t.owner === null && t.privateTo === null)
    .sort(
      (a, b) =>
        Math.hypot(a.pos.x - (capital?.pos.x ?? 0), a.pos.y - (capital?.pos.y ?? 0)) -
        Math.hypot(b.pos.x - (capital?.pos.x ?? 0), b.pos.y - (capital?.pos.y ?? 0)),
    );
  // A base a bit farther off and two digits of troops, so the march is still on its way when we look.
  const mine = nearby[0];
  const base = nearby[10];
  if (!capital || !mine || !base) throw new Error('no towns');
  mine.owner = ME;
  mine.neutralCap = 0;
  mine.garrison = 30;
  base.owner = 'bot1';
  base.neutralCap = 0;
  base.garrison = 99;
  const sent = execute(state, 'bot1', { type: 'SEND', from: base.id, to: mine.id, troops: 99 }, 0);
  expect(sent.ok).toBe(true);
  await load(page, state, 0);
  await expect(page.getByTestId('nav-marches').locator('.badge')).toBeVisible();
  await page.getByTestId('nav-marches').click();
  await shot(page, 'marches-incoming');
  await page.getByTestId('nav-marches').click();
  await shot(page, 'map-incoming');
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('report-item').first()).toBeVisible({ timeout: 20_000 });
  await shot(page, 'reports-defense');
});

test('enemy town and a flight between isles', async ({ page }) => {
  const state = newState();
  growIsle(state, 0, []);
  const view = await load(page, state, 0);
  const capital = view.towns.find((t) => t.id === view.me.capitalId);
  const target = view.towns.find((t) => t.isleId === 1);
  if (!capital || !target) throw new Error('no target');
  const point = await bringIntoView(page, target.id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('town-sheet')).toBeVisible();
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await shot(page, 'enemy-town');
  await page.getByTestId('attack-button').click();
  await expect(page.getByTestId('eta')).not.toContainText('—');
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await shot(page, 'send-sky');
});

test('menu and the end of a busy season', async ({ page }) => {
  const state = newState();
  advanceTo(state, state.endsAt - 2000);
  await load(page, state, state.endsAt - 2000);
  await shot(page, 'late-map');
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 10_000 });
  // Every rank wins at least one Bronze gem, kept for the next single-player season.
  await expect(page.getByTestId('end-gems')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('shattered-isles:gem-rewards') ?? '[]').length),
    )
    .toBeGreaterThan(0);
  await shot(page, 'end-screen');
});
