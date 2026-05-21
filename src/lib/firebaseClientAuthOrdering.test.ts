import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('firebaseClient emulator ordering', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', {});
  });

  it('initializes Auth before Firestore when emulator mode is enabled', async () => {
    const calls: string[] = [];
    const app = { name: '[DEFAULT]' };
    const auth = { app };
    const firestore = { app };

    vi.doMock('@/lib/envClient', () => ({
      getClientEnv: () => ({
        NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'statly-test.firebaseapp.com',
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'statly-test',
        NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:test',
        NEXT_PUBLIC_USE_EMULATORS: 'true',
        NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082',
        NEXT_PUBLIC_AUTH_EMULATOR_HOST: 'http://127.0.0.1:9100',
      }),
    }));
    vi.doMock('@/lib/logger', () => ({
      info: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(),
    }));
    vi.doMock('firebase/app', () => ({
      getApps: vi.fn(() => []),
      initializeApp: vi.fn(() => app),
      getApp: vi.fn(() => app),
    }));
    vi.doMock('firebase/auth', () => ({
      browserLocalPersistence: {},
      getAuth: vi.fn(() => {
        calls.push('getAuth');
        return auth;
      }),
      setPersistence: vi.fn(),
      connectAuthEmulator: vi.fn(() => {
        calls.push('connectAuthEmulator');
      }),
    }));
    vi.doMock('firebase/firestore', () => ({
      getFirestore: vi.fn(() => {
        calls.push('getFirestore');
        return firestore;
      }),
      connectFirestoreEmulator: vi.fn(() => {
        calls.push('connectFirestoreEmulator');
      }),
    }));

    const { getClientFirestore } = await import('./firebaseClient');

    expect(getClientFirestore()).toBe(firestore);
    expect(calls).toEqual([
      'getAuth',
      'connectAuthEmulator',
      'getFirestore',
      'connectFirestoreEmulator',
    ]);
  });
});
