import { describe, expect, it, vi } from 'vitest';

describe('firebaseHelpers', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});

describe('firebaseAdmin', () => {
  it('rejects when service account env var is malformed', async () => {
    vi.resetModules();
    const original = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from('not json').toString('base64');
    try {
      await expect(import('@/lib/firebaseAdmin')).rejects.toThrow(SyntaxError);
    } finally {
      if (original === undefined) {
        delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
      } else {
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = original;
      }
      vi.resetModules();
    }
  });
});

