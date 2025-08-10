import { describe, it, expect } from 'vitest';
import { encodeServiceAccount, decodeServiceAccount } from './serviceAccount';

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
});
