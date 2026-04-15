/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('isAuthBypassEnabled', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('returns false during next production build when BYPASS_AUTH is true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BYPASS_AUTH', 'true');
    vi.stubEnv('STATLY_NEXT_BUILD', '1');
    const { isAuthBypassEnabled } = await import('./authBypass');
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it('throws when BYPASS_AUTH is true in production runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BYPASS_AUTH', 'true');
    // Anything other than "1" must behave like real production runtime.
    vi.stubEnv('STATLY_NEXT_BUILD', '0');
    const { isAuthBypassEnabled } = await import('./authBypass');
    expect(() => isAuthBypassEnabled()).toThrow(/BYPASS_AUTH must remain disabled in production/);
  });
});
