import { collection } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'statly-test.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'statly-test',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:test',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'statly-test.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123',
  NEXT_PUBLIC_USE_EMULATORS: 'false',
};

describe('firebaseClient', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [key, value] of Object.entries(clientEnv)) {
      vi.stubEnv(key, value);
    }
  });

  afterEach(async () => {
    const { deleteApp, getApps } = await import('firebase/app');
    await Promise.all(getApps().map((app) => deleteApp(app)));
    vi.unstubAllEnvs();
  });

  it('returns a Firestore instance compatible with ESM Firestore helpers', async () => {
    const { getClientFirestore } = await import('./firebaseClient');

    const waiversRef = collection(getClientFirestore(), 'leagues', 'league-1', 'waivers');

    expect(waiversRef.path).toBe('leagues/league-1/waivers');
  });
});
