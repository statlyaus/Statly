import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type EnvModule = typeof import('./env');

let EnvTesting: EnvModule['__TESTING__'];
let getServerEnv: EnvModule['getServerEnv'];

beforeAll(async () => {
  const mod: EnvModule = await import('./env');
  EnvTesting = mod.__TESTING__;
  getServerEnv = mod.getServerEnv;
});

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
