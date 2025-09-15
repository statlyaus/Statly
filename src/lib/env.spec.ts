import { describe, it, expect } from 'vitest';
import { __TESTING__ as EnvTesting, getServerEnv } from './env';

describe('env helpers', () => {
  it('decodeServiceAccount throws on invalid base64', () => {
    expect(() => EnvTesting.decodeServiceAccount('@@notbase64@@')).toThrow();
  });

  it('decodeServiceAccount throws on missing required keys', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64');
    expect(() => EnvTesting.decodeServiceAccount(bad)).toThrow();
  });

  it('getServerEnv returns serviceAccount when valid base64 provided', () => {
    const good = Buffer.from(
      JSON.stringify({
        project_id: 'demo',
        client_email: 'a@b.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      }),
      'utf8'
    ).toString('base64');
    const prev = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = good;
    const env = getServerEnv();
    expect(env.serviceAccount?.project_id).toBe('demo');
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = prev;
  });
});

