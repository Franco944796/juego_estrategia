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

const DEMO = new URL('../../../demo/shattered-isles.html', import.meta.url).href;
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

async function load(page: Page, state: GameState, gameNow: number): Promise<LordView> {
  await page.goto(DEMO);
  await page.evaluate(
    ([key, save]) => {
      localStorage.setItem(key, save);
      localStorage.setItem('shattered-isles:tutorial-done', '1');
    },
    [SAVE_KEY, JSON.stringify({ version: 4, state, gameNow, speed: 1 })] as const,
  );
  await page.reload();
  await page.getByTestId('continue-game').click();
  await page.waitForFunction(() => Boolean(window.__shatteredIsles?.view()));
  const view = await page.evaluate(() => window.__shatteredIsles?.view() ?? null);
  if (!view) throw new Error('no view');
  return view;
}

/** Drags the map until the town sits in the middle of the screen. */
async function bringIntoView(page: Page, townId: number): Promise<{ x: number; y: number }> {
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  const size = page.viewportSize() ?? { width: 390, height: 844 };
  const center = { x: size.width / 2, y: size.height * 0.45 };
  const point = await page.evaluate((id) => window.__shatteredIsles?.townScreen(id) ?? null, townId);
  if (!point) throw new Error('unknown town');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + (center.x - point.x), center.y + (center.y - point.y), { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate((id) => window.__shatteredIsles?.townScreen(id) ?? null, townId);
  if (!moved) throw new Error('unknown town');
  return moved;
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
  await page.getByTestId('learn-GOLD').click();
  await page.getByTestId('learn-ATTACK').click();
  await page.getByTestId('learn-ATTACK').click();
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
  await load(page, state, 0);
  await page.getByTestId('portrait').click();
  await expect(page.getByTestId('tab-gear')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gear-item')).toHaveCount(2);
  await shot(page, 'gear');
  await page.getByTestId('equip-item').click();
  await expect(page.getByTestId('slot-WEAPON')).toContainText('15');
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

test('incoming attack, marches and the defense report', async ({ page }) => {
  const state = newState();
  const capital = state.towns[state.lords[ME]?.capitalId ?? -1];
  const base = state.towns.find((t) => t.isleId === capital?.isleId && t.owner === null);
  if (!capital || !base) throw new Error('no towns');
  base.owner = 'bot1';
  base.neutralCap = 0;
  base.garrison = 40;
  const sent = execute(state, 'bot1', { type: 'SEND', from: base.id, to: capital.id, troops: 9 }, 0);
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
  await shot(page, 'end-screen');
});
