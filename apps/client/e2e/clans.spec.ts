import { expect, test, type Page } from '@playwright/test';

async function enter(page: Page, name: string): Promise<void> {
  // Several players at once: the lighter 2D map keeps software rendering fast (the tour covers 3D).
  await page.addInitScript(() => localStorage.setItem('shattered-isles:map', '2d'));
  await page.goto('/');
  await page.getByTestId('lord-name').fill(name);
  await page.getByTestId('create-lord').click();
  await page.waitForFunction(() => Boolean(window.__shatteredIsles?.view()));
  await page.getByTestId('tutorial-skip').click();
}

async function fits(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.drawer h2, .drawer button, .nav-label, .chat-list li')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent ?? ''),
  );
  expect(clipped).toEqual([]);
}

test('found a clan, accept a member, chat and rank clans', async ({ browser }) => {
  const ana = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR' })
  ).newPage();
  const bo = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-AR' })
  ).newPage();
  const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const tag = suffix.slice(-4);
  await enter(ana, `Ana${suffix}`);
  await enter(bo, `Bo${suffix}`);

  await ana.getByTestId('nav-social').click();
  await ana.getByTestId('social-clan').click();
  await ana.getByTestId('clan-name').fill(`Vientos ${suffix}`);
  await ana.getByTestId('clan-tag').fill(tag);
  await ana.getByTestId('clan-create').click();
  await expect(ana.getByTestId('my-clan')).toContainText(`[${tag}]`);

  await bo.getByTestId('nav-social').click();
  await bo.getByTestId('social-clan').click();
  const result = bo.getByTestId('clan-result').filter({ hasText: `[${tag}]` });
  await result.getByRole('button').click();
  await expect(result.getByRole('button')).toBeDisabled();

  const request = ana.getByTestId('clan-request').filter({ hasText: `Bo${suffix}` });
  await expect(request).toBeVisible();
  await ana.screenshot({ path: test.info().outputPath('clan-request.png') });
  await request.getByRole('button').first().click();
  await expect(ana.getByTestId('clan-member')).toHaveCount(2);
  await expect(bo.getByTestId('my-clan')).toBeVisible();
  await fits(bo);
  await bo.screenshot({ path: test.info().outputPath('clan-member-mobile.png') });

  await bo.getByTestId('social-chat').click();
  await bo.getByTestId('chat-clan').click();
  await bo.getByTestId('chat-input').fill('¿Atacamos al amanecer?');
  await bo.getByTestId('chat-send').click();
  await ana.getByTestId('social-chat').click();
  await ana.getByTestId('chat-clan').click();
  await expect(ana.getByTestId('chat-line').filter({ hasText: '¿Atacamos al amanecer?' })).toBeVisible();
  await ana.getByTestId('chat-global').click();
  await ana.getByTestId('chat-input').fill(`Hola a todos ${suffix}`);
  await ana.getByTestId('chat-send').click();
  await bo.getByTestId('chat-global').click();
  await expect(bo.getByTestId('chat-line').filter({ hasText: `Hola a todos ${suffix}` })).toBeVisible();
  await fits(bo);
  await bo.screenshot({ path: test.info().outputPath('chat-mobile.png') });
  await ana.screenshot({ path: test.info().outputPath('chat-desktop.png') });

  await ana.getByTestId('nav-ranking').click();
  await ana.getByTestId('ranking-clans').click();
  await expect(ana.getByTestId('clan-ranking-row').filter({ hasText: `[${tag}]` })).toBeVisible();
  await ana.screenshot({ path: test.info().outputPath('clan-ranking.png') });
});
