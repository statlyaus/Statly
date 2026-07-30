import { expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100';

export const DEVELOPMENT_USER = {
  uid: 'statly-dev-tester',
  email: 'admin@statly.dev',
  displayName: 'Statly Dev Tester',
};

export const DEVELOPMENT_PASSWORD =
  process.env.STATLY_LOCAL_AUTH_PHRASE ?? 'statly-dev-tester-local-only';

export async function authenticateAsDevelopmentUser(page: Page) {
  await page.context().addCookies([
    {
      name: 'statly_dev_user',
      value: DEVELOPMENT_USER.uid,
      url: BASE_URL,
      sameSite: 'Lax',
    },
  ]);

  await page.addInitScript((user) => {
    window.localStorage.setItem('statly.devAuth.user', JSON.stringify(user));
  }, DEVELOPMENT_USER);
}

export function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDevelopmentNoise(text)) return;
    errors.push(text);
  });

  page.on('pageerror', (error) => {
    const message = error.message;
    if (isExpectedDevelopmentNoise(message)) return;
    errors.push(message);
  });

  return errors;
}

export async function expectNoAppErrorBoundary(page: Page) {
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText('Draft Error')).toHaveCount(0);
  await expect(page.getByText('rankings.find is not a function')).toHaveCount(0);
}

export async function expectNoPageLevelHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

function isExpectedDevelopmentNoise(message: string) {
  return [
    'Download the React DevTools',
    'Failed to load resource: the server responded with a status of 404',
  ].some((expected) => message.includes(expected));
}
