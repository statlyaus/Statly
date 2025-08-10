import { describe, expect, it } from 'vitest';
import { decodeServiceAccount, encodeServiceAccount, ServiceAccount } from './firebaseHelpers';

describe('firebaseHelpers', () => {
  const sample: ServiceAccount = {
    project_id: 'proj',
    client_email: 'test@example.com',
    private_key: 'key',
  };

  it('encodes and decodes a service account', () => {
    const encoded = encodeServiceAccount(sample);
    const decoded = decodeServiceAccount(encoded);
    expect(decoded).toEqual(sample);
  });

  it('throws on invalid base64 input', () => {
    expect(() => decodeServiceAccount('not-base64')).toThrow();
  });

  it('throws when required fields are missing', () => {
    const partial = Buffer.from(JSON.stringify({ project_id: 'only' })).toString('base64');
    expect(() => decodeServiceAccount(partial)).toThrow();
  });
});

