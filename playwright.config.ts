import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { sampleTradeStoryBundle } from './tests/fixtures/aflTradeStorySampleBundle';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const socketPort = Number(process.env.PLAYWRIGHT_SOCKET_PORT ?? 4102);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const socketURL = process.env.PLAYWRIGHT_SOCKET_URL ?? `http://localhost:${socketPort}`;
const firebaseProjectId = process.env.PLAYWRIGHT_FIREBASE_PROJECT_ID ?? 'statly-e2e';
const useSocketWebServer =
  process.env.PLAYWRIGHT_WITH_SOCKET === 'true' ||
  (process.env.PLAYWRIGHT_WITH_SOCKET !== 'false' && !process.env.CI);
const useDraftWorkerWebServer =
  useSocketWebServer && process.env.PLAYWRIGHT_WITH_DRAFT_WORKER === 'true';

/**
 * The public trade pages (/, /afl/trades) read one approved bundle. Browser tests serve the synthetic
 * sample bundle; PLAYWRIGHT_TRADE_BUNDLE_PATH points them at another stored bundle instead (the
 * genuine one in .statly-local, on the owner's Mac only).
 */
function publicTradeBundle(): { id: string; path: string } {
  const override = process.env.PLAYWRIGHT_TRADE_BUNDLE_PATH?.trim();
  if (override) {
    const { bundleId } = JSON.parse(readFileSync(override, 'utf8')) as { bundleId: string };
    return { id: bundleId, path: override };
  }
  const bundle = sampleTradeStoryBundle();
  const path = join(process.cwd(), 'test-results', 'e2e-public-trade-bundle.json');
  // The config loads in every worker; write the file only when it is missing or a different bundle.
  const stored = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { bundleId?: string }).bundleId
    : undefined;
  if (stored !== bundle.bundleId) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(bundle));
  }
  return { id: bundle.bundleId, path };
}
const tradeBundle = publicTradeBundle();

const nextCommand = [
  'NODE_ENV=development',
  'STATLY_ENABLE_DEV_AUTH=true',
  'STATLY_ENABLE_DEV_TOOLS=true',
  'NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true',
  'NEXT_PUBLIC_FIREBASE_API_KEY=',
  `GOOGLE_CLOUD_PROJECT=${firebaseProjectId}`,
  `GCLOUD_PROJECT=${firebaseProjectId}`,
  `NEXT_PUBLIC_FIREBASE_PROJECT_ID=${firebaseProjectId}`,
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=',
  'NEXT_PUBLIC_FIREBASE_APP_ID=',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=',
  'FIREBASE_ADMIN_DISABLED=true',
  'SENTRY_DISABLED=true',
  'NEXT_PUBLIC_SENTRY_DISABLED=true',
  'NEXT_PUBLIC_USE_EMULATORS=false',
  'NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS=true',
  `NEXT_PUBLIC_SOCKET_DISABLED=${useSocketWebServer ? 'false' : 'true'}`,
  `NEXT_PUBLIC_SOCKET_URL=${socketURL}`,
  'AFL_TRADE_STORY_PUBLIC_ENABLED=true',
  `AFL_TRADE_STORY_PUBLIC_BUNDLE_ID=${tradeBundle.id}`,
  `AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH=${tradeBundle.path}`,
  './node_modules/.bin/next dev --turbopack',
  `-p ${port}`,
].join(' ');

const socketCommand = [
  'NODE_ENV=development',
  'STATLY_ENABLE_DEV_AUTH=true',
  'NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true',
  'FIREBASE_ADMIN_DISABLED=true',
  'SENTRY_DISABLED=true',
  'NEXT_PUBLIC_SENTRY_DISABLED=true',
  `SOCKET_PORT=${socketPort}`,
  `SOCKET_IO_CORS_ORIGINS=${baseURL},http://localhost:${port}`,
  './node_modules/.bin/tsx -r dotenv/config ./src/server/socketioServer.ts',
].join(' ');

const draftWorkerCommand = [
  'NODE_ENV=development',
  'STATLY_ENABLE_DEV_AUTH=true',
  'NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true',
  'FIREBASE_ADMIN_DISABLED=true',
  'SENTRY_DISABLED=true',
  'NEXT_PUBLIC_SENTRY_DISABLED=true',
  './node_modules/.bin/tsx ./src/server/workers/enhancedDraftWorker.ts',
].join(' ');

const webServerCommand = useSocketWebServer
  ? useDraftWorkerWebServer
    ? [
        './node_modules/.bin/concurrently',
        '-k',
        '-s first',
        '-n web,socket,draft-worker',
        '-c blue,magenta,green',
        `"${nextCommand}"`,
        `"${socketCommand}"`,
        `"${draftWorkerCommand}"`,
      ].join(' ')
    : [
        './node_modules/.bin/concurrently',
        '-k',
        '-s first',
        '-n web,socket',
        '-c blue,magenta',
        `"${nextCommand}"`,
        `"${socketCommand}"`,
      ].join(' ')
  : nextCommand;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global.setup.ts',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/playwright',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: webServerCommand,
    url: useDraftWorkerWebServer ? `${baseURL}/api/ping` : baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-smoke',
      testMatch: /.*\.smoke\.test\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-smoke',
      testMatch: /.*\.smoke\.test\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
