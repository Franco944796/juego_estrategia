import type { LordView, TownView } from '@si/engine';
import { expect, test, type Page } from '@playwright/test';

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

async function tapTown(page: Page, id: number): Promise<void> {
  await page.waitForFunction(() => window.__shatteredIsles?.cameraSettled() ?? false);
  const point = await page.evaluate((townId) => window.__shatteredIsles?.townScreen(townId) ?? null, id);
  if (!point) throw new Error(`town ${id} is not on screen`);
  await page.mouse.click(point.x, point.y);
}

async function enter(page: Page, name: string): Promise<LordView> {
  await page.goto('/');
  await page.getByTestId('lord-name').fill(name);
  await page.getByTestId('create-lord').click();
  const view = await gameView(page);
  await page.getByTestId('tutorial-skip').click();
  return view;
}

test('two players share the online world, fight neutrals and keep their session', async ({ browser }) => {
  const ana = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR' })
  ).newPage();
  const bo = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US' })
  ).newPage();

  // Repeated runs share one server, so names are unique and the world may hold earlier players.
  const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const anaName = `Ana${suffix}`;
  const boName = `Bo${suffix}`;
  const anaView = await enter(ana, anaName);
  await enter(bo, boName);
  await expect(ana.getByTestId('online-card')).toHaveCount(0);

  await ana.getByTestId('nav-ranking').click();
  await expect(ana.getByTestId('ranking-row').filter({ hasText: boName })).toHaveCount(1);
  await bo.getByTestId('nav-ranking').click();
  await expect(bo.getByTestId('ranking-row').filter({ hasText: anaName })).toHaveCount(1);
  await bo.getByTestId('nav-menu').click();
  await expect(bo.getByTestId('profile')).toBeVisible();
  expect(
    await bo.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await bo.screenshot({ path: test.info().outputPath('online-profile-mobile.png') });
  await bo.getByTestId('profile').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await bo.screenshot({ path: test.info().outputPath('online-profile-mobile-end.png') });
  await ana.getByTestId('nav-ranking').click();

  const capitalId = anaView.me.capitalId;
  const capital = anaView.towns.find((t) => t.id === capitalId);
  const target = capital && nearestNeutral(anaView, capital);
  if (capitalId === null || !target) throw new Error('no neutral next to the capital');
  await tapTown(ana, capitalId);
  await ana.getByTestId('send-button').click();
  await tapTown(ana, target.id);
  await ana.getByTestId('send-all').click();
  await expect(ana.getByTestId('eta')).not.toContainText('—');
  await ana.getByTestId('confirm-send').click();
  await ana.getByTestId('nav-reports').click();
  await expect(ana.getByTestId('report-item').first()).toBeVisible({ timeout: 30_000 });

  await ana.getByTestId('nav-menu').click();
  await expect(ana.getByTestId('profile')).toBeVisible();
  await expect(ana.getByTestId('recovery-code')).not.toBeEmpty();
  await ana.screenshot({ path: test.info().outputPath('online-profile.png') });

  await ana.reload();
  await expect(ana.getByTestId('enter-world')).toContainText(anaName);
  await ana.screenshot({ path: test.info().outputPath('online-title.png') });
  await ana.getByTestId('enter-world').click();
  const again = await gameView(ana);
  expect(again.me.capitalId).toBe(capitalId);
  expect(again.towns.find((t) => t.id === target.id)?.owner).toBe(again.me.id);
});
