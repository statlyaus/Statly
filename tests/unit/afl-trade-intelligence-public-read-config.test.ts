import { describe, expect, it } from 'vitest';

import { parseAflTradePublicReadConfig } from '@/server/aflTradeIntelligence/runtime/publicReadConfig';

const validSecret = Buffer.alloc(32, 7).toString('base64');

function postgresEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    AFL_TRADE_PUBLIC_READ_MODE: 'postgres',
    AFL_TRADE_PUBLIC_READ_ENVIRONMENT: 'production',
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://statly.invalid/outcomes?sslmode=require',
    AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64: validSecret,
    AFL_TRADE_OBJECT_BUCKET: 'statly-afl-trade-public',
    AFL_TRADE_OBJECT_PREFIX: 'public-read/v1',
    AFL_TRADE_OBJECT_KMS_KEY_ID: 'alias/statly-afl-trade-public',
    AFL_TRADE_OBJECT_REPOSITORY_ID: 'afl-trade-public-primary',
    AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID: `artifact:${'a'.repeat(64)}`,
    AWS_REGION: 'ap-southeast-2',
  };
}

function localPostgresEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    AFL_TRADE_PUBLIC_READ_MODE: 'postgres',
    AFL_TRADE_PUBLIC_READ_ENVIRONMENT: 'test_fixture',
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55432/postgres',
    AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64: validSecret,
    AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/tmp/statly-local-artifacts',
  };
}

describe('AFL trade public read runtime configuration', () => {
  it('keeps disabled mode explicit and dependency free', () => {
    expect(parseAflTradePublicReadConfig({ AFL_TRADE_PUBLIC_READ_MODE: 'disabled' })).toEqual({
      mode: 'disabled',
    });
    expect(parseAflTradePublicReadConfig({})).toEqual({ mode: 'disabled' });
  });

  it('parses a complete PostgreSQL and durable-object configuration', () => {
    const config = parseAflTradePublicReadConfig(postgresEnvironment());

    expect(config).toMatchObject({
      mode: 'postgres',
      environment: 'production',
      artifactStorage: {
        kind: 's3',
        bucket: 'statly-afl-trade-public',
        keyPrefix: 'public-read/v1',
        region: 'ap-southeast-2',
        repositoryId: 'afl-trade-public-primary',
      },
    });
    if (config.mode !== 'postgres') throw new Error('Expected PostgreSQL mode.');
    expect(config.cursorSecret).toEqual(new Uint8Array(Buffer.from(validSecret, 'base64')));
  });

  it('parses test-fixture PostgreSQL with local artifact storage and no AWS configuration', () => {
    expect(parseAflTradePublicReadConfig(localPostgresEnvironment())).toMatchObject({
      mode: 'postgres',
      environment: 'test_fixture',
      artifactStorage: {
        kind: 'local_filesystem',
        rootDirectory: '/tmp/statly-local-artifacts',
      },
    });
  });

  it.each([
    ['AFL_OUTCOMES_DATABASE_URL', undefined],
    ['AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64', Buffer.alloc(31, 1).toString('base64')],
    ['AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID', 'artifact:not-a-digest'],
    ['AFL_TRADE_PUBLIC_READ_ENVIRONMENT', 'test'],
  ])('fails closed when %s is missing or invalid', (key, value) => {
    expect(() => parseAflTradePublicReadConfig({ ...postgresEnvironment(), [key]: value })).toThrow(
      /public read configuration/i
    );
  });

  it('requires the storage configuration selected by the exact environment', () => {
    expect(() =>
      parseAflTradePublicReadConfig({
        ...localPostgresEnvironment(),
        AFL_TRADE_LOCAL_ARTIFACT_ROOT: undefined,
      })
    ).toThrow(/AFL_TRADE_LOCAL_ARTIFACT_ROOT/);
    expect(() =>
      parseAflTradePublicReadConfig({
        ...postgresEnvironment(),
        AFL_TRADE_OBJECT_BUCKET: undefined,
        AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/tmp/not-a-production-fallback',
      })
    ).toThrow(/AFL_TRADE_OBJECT_BUCKET/);
  });

  it('never treats an unknown mode as disabled', () => {
    expect(() =>
      parseAflTradePublicReadConfig({ AFL_TRADE_PUBLIC_READ_MODE: 'firestore' })
    ).toThrow(/public read configuration/i);
  });
});
