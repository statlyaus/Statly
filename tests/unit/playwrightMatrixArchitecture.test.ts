import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Playwright browser matrix', () => {
  it('runs the full suite in Chromium and smoke coverage in Firefox and WebKit', () => {
    const config = read('playwright.config.ts');

    expect(config).toContain("name: 'chromium'");
    expect(config).toContain("name: 'firefox-smoke'");
    expect(config).toContain("name: 'webkit-smoke'");
    expect(config.match(/testMatch: \/\.\*\\\.smoke\\\.test\\\.ts\//g)).toHaveLength(2);
    expect(config).toContain("devices['Desktop Firefox']");
    expect(config).toContain("devices['Desktop Safari']");
  });

  it('installs every configured browser engine in CI', () => {
    const workflow = read('.github/workflows/ci.yml');

    expect(workflow).toContain('npx playwright install --with-deps chromium firefox webkit');
  });
});
