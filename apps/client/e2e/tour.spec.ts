import { defaultConfig } from '@si/config';
import { advanceTo, createGame, execute, type GameState, type LordInit, type LordView } from '@si/engine';
import { expect, test, type Page } from '@playwright/test';

const DEMO = new URL('../../../demo/shattered-isles.html', import.meta.url).href;
const SAVE_KEY = 'shattered-isles:save:v1';
const ME = 'you';

function newState(seed = 4242): GameState {
  const colors = defaultConfig.display.lordColors;
  const lords: LordInit[] = [
    { id: ME, name: 'Vos', color: colors[0] ?? '#fff', isBot: false, spec: 'LANCER' },
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
    [SAVE_KEY, JSON.stringify({ version: 1, state, gameNow, speed: 1 })] as const,
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

test('edict draft', async ({ page }) => {
  const state = newState();
  const me = state.lords[ME];
  if (!me) throw new Error('no lord');
  me.glory = 12;
  me.draftsOpened = 1;
  me.draft = ['GOLDEN_TIDE', 'SWIFT_WINGS', 'LEGEND'];
  await load(page, state, 0);
  await expect(page.getByTestId('nav-edicts').locator('.badge')).toBeVisible();
  await page.getByTestId('nav-edicts').click();
  await expect(page.getByTestId('edict-option')).toHaveCount(3);
  await shot(page, 'edicts');
  await page.getByTestId('edict-option').first().click();
  await expect(page.getByTestId('edict-option')).toHaveCount(0);
  await shot(page, 'edicts-chosen');
});

test('incoming attack, marches and the defense report', async ({ page }) => {
  const state = newState();
  const capital = state.towns[state.lords[ME]?.capitalId ?? -1];
  const base = state.towns.find((t) => t.isleId === capital?.isleId && t.owner === null);
  if (!capital || !base) throw new Error('no towns');
  base.owner = 'bot1';
  base.neutralCap = 0;
  base.garrison = { LANCER: 10, ARCHER: 30, GRIFFIN: 0 };
  const sent = execute(
    state,
    'bot1',
    { type: 'SEND', from: base.id, to: capital.id, troops: { LANCER: 0, ARCHER: 25, GRIFFIN: 0 } },
    0,
  );
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
  const view = await load(page, state, 0);
  const capital = view.towns[view.me.capitalId ?? -1];
  const lanes = view.lanes.filter((l) => l.a === capital?.isleId || l.b === capital?.isleId);
  const otherIsle = lanes.map((l) => (l.a === capital?.isleId ? l.b : l.a)).find((id) => id !== 0);
  const target = view.towns.find((t) => t.isleId === otherIsle);
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
