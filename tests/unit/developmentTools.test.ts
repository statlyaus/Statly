import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDevelopmentToolsEnabled } from '@/server/developmentTools';

describe('development tools feature gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled by default outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STATLY_ENABLE_DEV_TOOLS', '');

    expect(isDevelopmentToolsEnabled()).toBe(false);
  });

  it('allows an explicit non-production opt-in', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STATLY_ENABLE_DEV_TOOLS', 'true');

    expect(isDevelopmentToolsEnabled()).toBe(true);
  });

  it('stays disabled in production when the flag is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STATLY_ENABLE_DEV_TOOLS', 'true');

    expect(isDevelopmentToolsEnabled()).toBe(false);
  });
});
