import { describe, expect, it, vi } from 'vitest';

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
  it('uses the development socket token in non-production even when Firebase auth exists', async () => {
    await expect(resolveSocketAuthToken('statly-dev-tester')).resolves.toBe(
      'dev:statly-dev-tester'
    );
    expect(mocks.getIdToken).not.toHaveBeenCalled();
  });
});
