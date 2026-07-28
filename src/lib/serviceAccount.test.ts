import { describe, it, expect } from 'vitest';
import {
  encodeServiceAccount,
  decodeServiceAccount,
  getServiceAccountFromEnv,
} from './serviceAccount';
import type { ServiceAccount } from 'firebase-admin/app';

const sample: ServiceAccount = {
  projectId: 'my-project',
  clientEmail: 'test@my-project.iam.gserviceaccount.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----\n',
};

describe('serviceAccount helpers', () => {
  it('encodes and decodes to the same object', () => {
    const encoded = encodeServiceAccount(sample);
    const decoded = decodeServiceAccount(encoded);
    expect(decoded).toEqual(sample);
  });

  it('decodes plain JSON', () => {
    const json = JSON.stringify({
      project_id: sample.projectId,
      client_email: sample.clientEmail,
      private_key: sample.privateKey,
    });
    const decoded = decodeServiceAccount(json);
    expect(decoded).toEqual(sample);
  });

  it('normalizes escaped private key newlines', () => {
    const json = JSON.stringify({
      project_id: sample.projectId,
      client_email: sample.clientEmail,
      private_key: sample.privateKey?.replace(/\n/g, '\\n'),
    });

    expect(decodeServiceAccount(json).privateKey).toBe(sample.privateKey);
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
      'Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64'
    );
    if (orig === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = orig;
    }
  });

  it('rejects a non-PEM private key without exposing its value', () => {
    const orig = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = encodeServiceAccount({
      ...sample,
      privateKey: 'not-a-private-key',
    });

    expect(() => getServiceAccountFromEnv()).toThrow(
      'Invalid service account private key PEM format'
    );

    if (orig === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = orig;
    }
  });
});
