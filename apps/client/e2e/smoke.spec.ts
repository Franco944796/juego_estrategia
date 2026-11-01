import type { LordView, TownView } from '@si/engine';
import { expect, test, type Page } from '@playwright/test';

const DEMO = new URL('../../../demo/shattered-isles.html', import.meta.url).href;

async function gameView(page: Page): Promise<LordView> {
  await page.waitForFunction(() => Boolean(window.__shatteredIsles?.view()));
  const view = await page.evaluate(() => window.__shatteredIsles?.view() ?? null);
  if (!view) throw new Error('no view');
  return view;
}

/** The neutral town closest to `town` that the viewer can see (often one of its private towns). */
function nearestNeutral(view: LordView, town: TownView): TownView | undefined {
  const d = (t: TownView): number => Math.hypot(t.pos.x - town.pos.x, t.pos.y - town.pos.y);
  return view.towns
    .filter((t) => t.owner === null && t.isleId === town.isleId)
    .sort((a, b) => d(a) - d(b))[0];
}

async function tapTown(page: Page, id: number, touch: boolean): Promise<void> {
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  const point = await page.evaluate((townId) => window.__shatteredIsles?.townScreen(townId) ?? null, id);
  if (!point) throw new Error(`town ${id} is not on screen`);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

/** Elements whose text does not fit their box. */
function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.stat, .chip, .nav-label, .wind-rose, .drawer h2, .drawer button, .toast',
      ),
    ]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}: ${el.textContent ?? ''}`),
  );
}

test('plays the opening, wins a battle and fits the screen', async ({ page }, testInfo) => {
  const touch = testInfo.project.name === 'mobile';
  await page.goto(DEMO);
  await page.getByTestId('new-game').click();
  const view = await gameView(page);
  const capitalId = view.me.capitalId;
  if (capitalId === null) throw new Error('no capital');
  const capital = view.towns.find((t) => t.id === capitalId);
  const target = capital && nearestNeutral(view, capital);
  if (!capital || !target) throw new Error('no neutral town next to the capital');

  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', '0');
  await tapTown(page, capitalId, touch);
  await expect(page.getByTestId('town-sheet')).toBeVisible();
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', '1');
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await page.screenshot({ path: testInfo.outputPath('town-sheet.png') });

  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('pick-banner')).toBeVisible();
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await page.screenshot({ path: testInfo.outputPath('pick.png') });
  await tapTown(page, target.id, touch);
  await expect(page.getByTestId('send-sheet')).toBeVisible();
  await page.getByTestId('send-all').click();
  await expect(page.getByTestId('confirm-send')).toBeEnabled();
  await expect(page.getByTestId('eta')).not.toContainText('—');
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  await page.screenshot({ path: testInfo.outputPath('send-sheet.png') });
  await page.getByTestId('confirm-send').click();
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', '3');
  await page.getByTestId('tutorial-next').click();
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);

  await page.getByTestId('nav-menu').click();
  await page.getByTestId('speed-4').click();
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('report-item').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('reports.png') });

  await page.getByTestId('nav-ranking').click();
  await expect(page.getByTestId('ranking-row')).toHaveCount(view.lords.length);
  await page.getByTestId('nav-ranking').click();
  await page.screenshot({ path: testInfo.outputPath('map.png') });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await clipped(page)).toEqual([]);
});

test('continues a saved season after a reload', async ({ page }) => {
  await page.goto(DEMO);
  await page.getByTestId('new-game').click();
  await gameView(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('continue-game')).toBeVisible();
  await page.getByTestId('continue-game').click();
  await gameView(page);
  await expect(page.getByTestId('hud-gold')).toBeVisible();
});
