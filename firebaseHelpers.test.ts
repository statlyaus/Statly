import { describe, expect, it } from 'vitest';
import { parseServiceAccountBase64 } from './firebaseHelpers';

describe('firebaseHelpers', () => {
  it('invalid base64 input', () => {
    expect(() => parseServiceAccountBase64('not-base64')).toThrow(
      'Invalid service account base64 string'
    );
  });

  it('missing required fields', () => {
    const incomplete = Buffer.from(
      JSON.stringify({ project_id: 'proj' }),
      'utf-8'
    ).toString('base64');
    expect(() => parseServiceAccountBase64(incomplete)).toThrow(
      'Missing required service account fields'
    );
  });
});
