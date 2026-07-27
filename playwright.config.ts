import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const socketPort = Number(process.env.PLAYWRIGHT_SOCKET_PORT ?? 4102);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const socketURL = process.env.PLAYWRIGHT_SOCKET_URL ?? `http://localhost:${socketPort}`;
const firebaseProjectId = process.env.PLAYWRIGHT_FIREBASE_PROJECT_ID ?? 'statly-e2e';
const useSocketWebServer =
  process.env.PLAYWRIGHT_WITH_SOCKET === 'true' ||
  (process.env.PLAYWRIGHT_WITH_SOCKET !== 'false' && !process.env.CI);

const nextCommand = [
  'NODE_ENV=development',
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
  `NEXT_PUBLIC_SOCKET_IO_URL=${socketURL}`,
  './node_modules/.bin/next dev --turbopack',
  `-p ${port}`,
].join(' ');

const socketCommand = [
  'NODE_ENV=development',
  `SOCKET_PORT=${socketPort}`,
  `SOCKET_IO_CORS_ORIGINS=${baseURL},http://localhost:${port}`,
  './node_modules/.bin/tsx -r dotenv/config ./src/server/socketioServer.ts',
].join(' ');

const webServerCommand = useSocketWebServer
  ? [
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
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
