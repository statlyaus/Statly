import { describe, expect, it } from 'vitest';
import { parseServiceAccountFromBase64 } from './firebaseHelpers';

const validServiceAccount = {
  project_id: 'pid',
  client_email: 'client@example.com',
  private_key: 'key',
};
const validB64 = Buffer.from(JSON.stringify(validServiceAccount), 'utf-8').toString('base64');

describe('parseServiceAccountFromBase64', () => {
  it('returns parsed service account when all fields present', () => {
    expect(parseServiceAccountFromBase64(validB64)).toEqual(validServiceAccount);
  });

  it('throws specific error when fields are missing', () => {
    const missingFields = Buffer.from(
      JSON.stringify({ project_id: 'pid' }),
      'utf-8'
    ).toString('base64');

    expect(() => parseServiceAccountFromBase64(missingFields)).toThrow(
      'Missing required service account fields'
    );
  });

  it('throws error for invalid base64 or JSON', () => {
    expect(() => parseServiceAccountFromBase64('not-base64')).toThrow(
      'Invalid service account JSON'
    );
  });
});
