import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeServiceAccount } from '../../src/lib/serviceAccount';

const sampleServiceAccount = {
  projectId: 'statly-staging',
  clientEmail: 'firebase-adminsdk@test.iam.gserviceaccount.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n',
};

describe('firebaseAdmin initialization', () => {
  const originalEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const originalGoogleProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalGcloudProject = process.env.GCLOUD_PROJECT;
  const originalPublicProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = encodeServiceAccount(sampleServiceAccount);
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  });

  afterEach(() => {
    vi.doUnmock('firebase-admin/app');
    vi.doUnmock('firebase-admin/firestore');
    vi.doUnmock('firebase-admin/auth');

    if (originalEnv === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = originalEnv;
    }

    if (originalGoogleProject === undefined) {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    } else {
      process.env.GOOGLE_CLOUD_PROJECT = originalGoogleProject;
    }

    if (originalGcloudProject === undefined) {
      delete process.env.GCLOUD_PROJECT;
    } else {
      process.env.GCLOUD_PROJECT = originalGcloudProject;
    }

    if (originalPublicProject === undefined) {
      delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    } else {
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalPublicProject;
    }
  });

  it('does not reuse a pre-existing default admin app without a project id', async () => {
    const defaultApp = { name: '[DEFAULT]', options: {} };
    const configuredApp = {
      name: 'statly-admin',
      options: { projectId: sampleServiceAccount.projectId },
    };
    const cert = vi.fn((serviceAccount: unknown) => ({
      type: 'cert',
      serviceAccount,
    }));
    const applicationDefault = vi.fn(() => ({ type: 'adc' }));
    const initializeApp = vi.fn(() => configuredApp);
    const getApps = vi.fn(() => [defaultApp]);
    const getFirestore = vi.fn(() => ({ kind: 'firestore' }));
    const getAuth = vi.fn(() => ({ kind: 'auth' }));

    vi.doMock('firebase-admin/app', () => ({
      applicationDefault,
      cert,
      getApps,
      initializeApp,
    }));
    vi.doMock('firebase-admin/firestore', () => ({
      getFirestore,
    }));
    vi.doMock('firebase-admin/auth', () => ({
      getAuth,
    }));

    await import('../../src/lib/firebaseAdmin');

    expect(applicationDefault).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ type: 'cert' }),
        projectId: sampleServiceAccount.projectId,
      }),
      'statly-admin'
    );
    expect(getFirestore).toHaveBeenCalledWith(configuredApp);
    expect(getAuth).toHaveBeenCalledWith(configuredApp);
  });

  it('treats checked-in placeholder service account values as absent', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = 'YOUR_PRODUCTION_SERVICE_ACCOUNT_BASE64';

    const configuredApp = {
      name: 'statly-admin',
      options: { projectId: 'your-production-project-id' },
    };
    const cert = vi.fn((serviceAccount: unknown) => ({
      type: 'cert',
      serviceAccount,
    }));
    const applicationDefault = vi.fn(() => ({ type: 'adc' }));
    const initializeApp = vi.fn(() => configuredApp);
    const getApps = vi.fn(() => []);
    const getFirestore = vi.fn(() => ({ kind: 'firestore' }));
    const getAuth = vi.fn(() => ({ kind: 'auth' }));

    vi.doMock('firebase-admin/app', () => ({
      applicationDefault,
      cert,
      getApps,
      initializeApp,
    }));
    vi.doMock('firebase-admin/firestore', () => ({
      getFirestore,
    }));
    vi.doMock('firebase-admin/auth', () => ({
      getAuth,
    }));

    await import('../../src/lib/firebaseAdmin');

    expect(cert).not.toHaveBeenCalled();
    expect(applicationDefault).toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ type: 'adc' }),
        projectId: 'your-production-project-id',
      }),
      'statly-admin'
    );
  });

  it('fails fast when a real service account value is malformed', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = 'not-json-and-not-a-placeholder';

    const applicationDefault = vi.fn(() => ({ type: 'adc' }));

    vi.doMock('firebase-admin/app', () => ({
      applicationDefault,
      cert: vi.fn(),
      getApps: vi.fn(() => []),
      initializeApp: vi.fn(),
    }));
    vi.doMock('firebase-admin/firestore', () => ({
      getFirestore: vi.fn(),
    }));
    vi.doMock('firebase-admin/auth', () => ({
      getAuth: vi.fn(),
    }));

    await expect(import('../../src/lib/firebaseAdmin')).rejects.toThrow(SyntaxError);
    expect(applicationDefault).not.toHaveBeenCalled();
  });
});
