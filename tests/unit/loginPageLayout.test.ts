import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('login page layout', () => {
  it('uses the product-auth shell instead of the legacy split-gradient marketing panel', () => {
    const loginPage = readRepoFile('src/app/(auth)/login/page.tsx');

    expect(loginPage).toContain('Your fantasy AFL command center.');
    expect(loginPage).toContain('Sign in to Statly');
    expect(loginPage).toContain('Live draft');
    expect(loginPage).toContain('Draft order');
    expect(loginPage).toContain('My roster');
    expect(loginPage).toContain('<AuthForm');

    expect(loginPage).not.toContain('Welcome to Statly');
    expect(loginPage).not.toContain('Welcome Back');
    expect(loginPage).not.toContain('bg-gradient-to-br from-blue-600 to-purple-700');
    expect(loginPage).not.toContain('Your ultimate fantasy sports dashboard');
  });
});
