import { describe, expect, it } from 'vitest';

import { toSafeRedirect } from './safeRedirect';

describe('toSafeRedirect', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    [
      '/leagues/e2e-completed-league/social?view=board',
      '/leagues/e2e-completed-league/social?view=board',
    ],
    ['/leagues/1#chat', '/leagues/1#chat'],
  ])('keeps same-site path %s', (input, expected) => {
    expect(toSafeRedirect(input)).toBe(expected);
  });

  it.each([
    '/..//evil.example',
    '/.//evil.example',
    '/a/..//evil.example',
    '/%2e%2e//evil.example',
  ])('never yields an off-site target for dot-segment path %s', (input) => {
    const origin = 'https://statly.example';
    const target = toSafeRedirect(input);
    expect(target === undefined || new URL(target, origin).origin === origin).toBe(true);
    expect(target?.startsWith('//')).not.toBe(true);
  });

  it.each([
    undefined,
    '',
    '//evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    '/\t/evil.example',
    '\\\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'dashboard',
  ])('rejects %j', (input) => {
    expect(toSafeRedirect(input)).toBeUndefined();
  });
});
