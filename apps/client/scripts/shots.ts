// Visual review of the 3D map on a real GPU: `pnpm --filter @si/client shots -- --quality high --theme noche`.
// Serves nothing itself: the built client must be reachable over http (file:// cannot load textures).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { defaultConfig } from '@si/config';
import { createGame, execute, type GameState, type LordInit } from '@si/engine';

const args = new Map<string, string>();
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args.set(a.slice(2), all[i + 1] ?? '');
});
const url = args.get('url') ?? 'http://127.0.0.1:4179/';
const quality = args.get('quality') ?? 'high';
const theme = args.get('theme') ?? 'pergamino';
const [width = 1280, height = 800] = (args.get('size') ?? '1280x800').split('x').map(Number);
// Not under test-results: Playwright empties that folder on every run.
const out = args.get('out') ?? 'shots';
const only = args.get('only');
const ME = 'you';

/** A town next to the capital that the player's army takes a few seconds into the game. */
let prey = -1;

function scene(): GameState {
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
  const state = createGame({ seed: 4242, config: defaultConfig, startsAt: 0, lords });
  const capital = state.towns.find((t) => t.owner === ME && t.isCapital);
  if (!capital) throw new Error('no capital');
  capital.tier = 100;
  capital.garrison = 5000;
  const d = (t: { pos: { x: number; y: number } }): number =>
    Math.hypot(t.pos.x - capital.pos.x, t.pos.y - capital.pos.y);
  const near = state.towns
    .filter((t) => t.owner === null && t.isleId === capital.isleId && t.privateTo === null)
    .sort((a, b) => d(a) - d(b));
  [1, 10, 30, 60, 90, 100, 45, 75].forEach((tier, i) => {
    const town = near[i];
    if (!town) return;
    town.tier = tier;
    town.owner = i % 2 === 0 ? ME : 'bot1';
    town.garrison = 400;
  });
  const weak = near[8];
  if (weak) {
    // Neutral: a bot this much weaker than the player cannot be attacked (rule R17).
    weak.garrison = 0;
    prey = weak.id;
    execute(state, ME, { type: 'SEND', from: capital.id, to: weak.id, troops: 99 }, 0);
  }
  for (const i of [9, 10]) {
    const to = near[i];
    if (to) execute(state, ME, { type: 'SEND', from: capital.id, to: to.id, troops: 300 }, 0);
  }
  return state;
}

const browser = await chromium.launch({
  args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const problems: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) =>
  problems.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`),
);
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
});
await page.goto(url);
await page.evaluate(
  ([save, q, th]) => {
    localStorage.setItem('shattered-isles:save:v1', save);
    localStorage.setItem('shattered-isles:tutorial-done', '1');
    localStorage.setItem('shattered-isles:quality', q);
    localStorage.setItem('shattered-isles:theme', th);
  },
  [JSON.stringify({ version: 5, state: scene(), gameNow: 0, speed: 1 }), quality, theme] as const,
);
await page.reload();
await page.getByTestId('continue-game').click();
await page.waitForFunction(() => Boolean(window.__shatteredIsles?.view()));
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});
console.log('GPU:', gpu);

mkdirSync(out, { recursive: true });
const tag = `${quality}-${theme}-${width}`;
const shot = async (name: string): Promise<void> => {
  if (only && only !== name) return;
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `${tag}-${name}.png`) });
};
const zoom = async (delta: number, steps: number): Promise<void> => {
  await page.mouse.move(width / 2, height * 0.45);
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, delta);
};

if (args.has('capture')) {
  // Waits for the player's army to take the weak town and pictures the burst over it.
  await page.evaluate((id) => window.__shatteredIsles?.centerOn(id), prey);
  const taken = await page
    .waitForFunction(
      (id) => window.__shatteredIsles?.view()?.towns.find((t) => t.id === id)?.owner === 'you',
      prey,
      { timeout: 120_000, polling: 'raf' },
    )
    .then(() => true)
    .catch(() => false);
  if (taken) {
    await page.waitForTimeout(280);
    await page.screenshot({ path: join(out, `${tag}-capture.png`) });
  }
  console.log('capture:', taken ? 'pictured' : 'the town was not taken');
  await browser.close();
  process.exit(0);
}

await shot('start');
await zoom(-240, 4);
await shot('close');
await zoom(240, 14);
await shot('far');
// A string, because tsx wraps named inner functions in a helper the page does not have.
const frames = await page.evaluate<number>(`new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else resolve((n / (performance.now() - t0)) * 1000);
  };
  requestAnimationFrame(tick);
})`);
console.log('fps (far):', frames.toFixed(1));
for (const p of [...new Set(problems)].slice(0, 12)) console.log(p);
await browser.close();
