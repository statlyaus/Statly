import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDevelopmentAuthEnabled, isServerDevelopmentAuthEnabled } from '@/lib/devAuth';

describe('development auth feature gates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps development auth disabled by default outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH', '');
    vi.stubEnv('STATLY_ENABLE_DEV_AUTH', '');

    expect(isDevelopmentAuthEnabled()).toBe(false);
    expect(isServerDevelopmentAuthEnabled()).toBe(false);
  });

  it('requires a separate server opt-in before trusting development credentials', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH', 'true');
    vi.stubEnv('STATLY_ENABLE_DEV_AUTH', '');

    expect(isDevelopmentAuthEnabled()).toBe(true);
    expect(isServerDevelopmentAuthEnabled()).toBe(false);

    vi.stubEnv('STATLY_ENABLE_DEV_AUTH', 'true');

    expect(isServerDevelopmentAuthEnabled()).toBe(true);
  });

  it('denies development auth in production even when both flags are set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH', 'true');
    vi.stubEnv('STATLY_ENABLE_DEV_AUTH', 'true');

    expect(isDevelopmentAuthEnabled()).toBe(false);
    expect(isServerDevelopmentAuthEnabled()).toBe(false);
  });
});
