import { describe, expect, it } from 'vitest';
import { decodeServiceAccount } from './firebaseHelpers';

describe('firebaseHelpers', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });

  it('throws on invalid JSON', () => {
    const bad = Buffer.from('{ not json }').toString('base64');
    expect(() => decodeServiceAccount(bad)).toThrow(
      'Invalid service account base64 string'
    );
  });
});

