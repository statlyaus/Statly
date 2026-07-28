import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIdToken: vi.fn(async () => 'firebase-id-token'),
}));

vi.mock('@/lib/firebaseClient', () => ({
  auth: {
    currentUser: {
      getIdToken: mocks.getIdToken,
    },
  },
}));

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

import { resolveSocketAuthToken } from '@/providers/SocketProvider';

describe('SocketProvider development auth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the development socket token when explicitly enabled even when Firebase auth exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH', 'true');

    await expect(resolveSocketAuthToken('statly-dev-tester')).resolves.toBe(
      'dev:statly-dev-tester'
    );
    expect(mocks.getIdToken).not.toHaveBeenCalled();
  });
});
