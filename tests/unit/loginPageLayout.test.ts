import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('login page layout', () => {
  it('uses a focused auth shell without the promotional preview', () => {
    const loginPage = readRepoFile('src/app/(auth)/login/page.tsx');

    expect(loginPage).toContain('Sign in to Statly');
    expect(loginPage).toContain('/brand/statly-primary-logo.png');
    expect(loginPage).toContain('sm:w-80');
    expect(loginPage).toContain('<AuthForm');

    expect(loginPage).not.toContain('Your fantasy AFL command center.');
    expect(loginPage).not.toContain('Live draft');
    expect(loginPage).not.toContain('Draft order');
    expect(loginPage).not.toContain('My roster');
    expect(loginPage).not.toContain('/brand/statly-wordmark-logo.png');
    expect(loginPage).not.toContain('/brand/statly-compact-logo.png');
    expect(loginPage).not.toContain('Welcome to Statly');
    expect(loginPage).not.toContain('Welcome Back');
    expect(loginPage).not.toContain('bg-gradient-to-br from-blue-600 to-purple-700');
    expect(loginPage).not.toContain('Your ultimate fantasy sports dashboard');
  });
});
