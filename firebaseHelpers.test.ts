import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => {
  return {
    initializeApp: vi.fn(),
    cert: vi.fn((sa) => sa),
    getApps: vi.fn(() => []),
  };
});

vi.mock('firebase-admin/firestore', () => {
  return {
    getFirestore: vi.fn(() => ({ firestore: true })),
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('firebaseHelpers', () => {
  it('initializes successfully when GOOGLE_SERVICE_ACCOUNT is set', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'demo',
      private_key: 'key',
      client_email: 'demo@demo.iam.gserviceaccount.com',
    });

    const { initFirebase } = await import('./firebaseHelpers');
    const db = initFirebase();
    expect(db).toEqual({ firestore: true });

    const app = await import('firebase-admin/app');
    expect(app.initializeApp).toHaveBeenCalledOnce();
    expect(app.cert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'demo' })
    );
  });

  it('throws an error when GOOGLE_SERVICE_ACCOUNT is missing', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT;
    const { initFirebase } = await import('./firebaseHelpers');
    expect(() => initFirebase()).toThrow('Missing GOOGLE_SERVICE_ACCOUNT');
  });
});
