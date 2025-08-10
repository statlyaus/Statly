import { describe, it, expect } from 'vitest';
import {
  encodeServiceAccount,
  decodeServiceAccount,
  getServiceAccountFromEnv,
} from './serviceAccount';

const sample = {
  project_id: 'my-project',
  client_email: 'test@my-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----\n',
};

describe('serviceAccount helpers', () => {
  it('encodes and decodes to the same object', () => {
    const encoded = encodeServiceAccount(sample);
    const decoded = decodeServiceAccount(encoded);
    expect(decoded).toEqual(sample);
  });

  it('decodes plain JSON', () => {
    const json = JSON.stringify(sample);
    const decoded = decodeServiceAccount(json);
    expect(decoded).toEqual(sample);
  });

  it('loads service account from env', () => {
    const orig = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = encodeServiceAccount(sample);
    const sa = getServiceAccountFromEnv();
    expect(sa).toEqual(sample);
    if (orig === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = orig;
    }
  });

  it('throws when env var missing', () => {
    const orig = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    expect(() => getServiceAccountFromEnv()).toThrow(
      'Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64',
    );
    if (orig === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = orig;
    }
  });
});
