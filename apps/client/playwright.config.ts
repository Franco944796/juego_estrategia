import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const ONLINE_PORT = 8790;
const ONLINE_URL = `http://127.0.0.1:${ONLINE_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  // The online tests need the game server serving the built client (apps/client/dist).
  webServer: {
    command: 'pnpm --filter @si/server start',
    url: `${ONLINE_URL}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(ONLINE_PORT),
      TIME_SCALE: '20',
      DB_PATH: join(tmpdir(), `shattered-isles-e2e-${Date.now()}.db`),
    },
  },
  projects: [
    {
      name: 'mobile',
      testMatch: /smoke|tour/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        locale: 'es-AR',
      },
    },
    {
      name: 'desktop',
      testMatch: /smoke|tour/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, locale: 'en-US' },
    },
    {
      name: 'online',
      testMatch: 'online.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: ONLINE_URL },
    },
  ],
});
