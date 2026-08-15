import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DraftTradeReadRepository } from '@/lib/draftTrades/read';
import type { AflDraftHistoryReadService } from '@/server/aflTradeIntelligence/outcomes/draftHistoryReadService';
import type { AflDraftTradeOutcomeReadService } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import type { AflTradeMethodologyReadService } from '@/server/aflTradeIntelligence/publication/methodologyReadService';
import type { AflTradeValueReadService } from '@/server/aflTradeIntelligence/publication/valueReadService';
import {
  createAflTradePublicReadRuntime,
  createAflTradePublicReadRuntimeLoader,
  createAflTradePublicReadPoolOptions,
  createAflTradePublicProjectionArtifactRepository,
  type AflTradePublicReadRuntime,
} from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import type { AflTradePublicReadConfig } from '@/server/aflTradeIntelligence/runtime/publicReadConfig';

const postgresConfig = {
  mode: 'postgres',
  environment: 'production',
  databaseUrl: 'postgresql://statly.invalid/outcomes',
  cursorSecret: new Uint8Array(32),
  artifactStorage: {
    kind: 's3',
    bucket: 'statly-afl-trade-public',
    keyPrefix: 'public/v1',
    kmsKeyId: 'fixture-kms',
    policyEvidenceId: `artifact:${'a'.repeat(64)}`,
    region: 'ap-southeast-2',
    repositoryId: 'fixture-public',
  },
} satisfies AflTradePublicReadConfig;

const localPostgresConfig = {
  mode: 'postgres',
  environment: 'test_fixture',
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:55432/postgres',
  cursorSecret: new Uint8Array(32),
  artifactStorage: {
    kind: 'local_filesystem',
    rootDirectory: '/tmp/statly-local-public-read-artifacts',
  },
} satisfies AflTradePublicReadConfig;

function fixtureRuntime(close = vi.fn(async () => undefined)): AflTradePublicReadRuntime {
  return {
    mode: 'postgres',
    outcomeReadService: {} as AflDraftTradeOutcomeReadService,
    valueReadService: {} as AflTradeValueReadService,
    methodologyReadService: {} as AflTradeMethodologyReadService,
    archiveReadRepository: {} as DraftTradeReadRepository,
    draftHistoryReadService: {} as AflDraftHistoryReadService,
    close,
  };
}

describe('AFL trade public read runtime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps disabled mode explicit and returns honest unavailable services', async () => {
    const createPostgres = vi.fn();
    const runtime = await createAflTradePublicReadRuntime({ mode: 'disabled' }, { createPostgres });

    expect(runtime.mode).toBe('disabled');
    expect(createPostgres).not.toHaveBeenCalled();
    await expect(
      runtime.outcomeReadService.list({
        scopeKey: 'public-afl-draft-trade-outcomes',
        year: null,
        club: '',
        q: '',
        metric: null,
        status: null,
        limit: 1,
        cursor: null,
      })
    ).resolves.toMatchObject({
      consistency: { freshness: 'unavailable' },
      items: [],
    });
    await expect(runtime.draftHistoryReadService.listYears()).resolves.toMatchObject({
      consistency: { selection: 'none' },
      years: [],
    });
    await runtime.close();
  });

  it('delegates PostgreSQL composition without changing or logging configuration', async () => {
    const expected = fixtureRuntime();
    const createPostgres = vi.fn(async () => expected);

    const runtime = await createAflTradePublicReadRuntime(postgresConfig, { createPostgres });

    expect(runtime).toBe(expected);
    expect(createPostgres).toHaveBeenCalledWith(postgresConfig);
  });

  it('serializes only the local test-fixture pool for single-engine PostgreSQL compatibility', () => {
    expect(
      createAflTradePublicReadPoolOptions({ ...postgresConfig, environment: 'test_fixture' })
    ).toEqual({ connectionString: postgresConfig.databaseUrl, max: 1 });
    expect(createAflTradePublicReadPoolOptions(postgresConfig)).toEqual({
      connectionString: postgresConfig.databaseUrl,
    });
  });

  it('composes fixture-only filesystem custody without weakening hosted storage', () => {
    const repository = createAflTradePublicProjectionArtifactRepository(localPostgresConfig);

    expect(repository).toMatchObject({
      assurance: 'fixture_filesystem',
      artifactClass: 'public_projection',
      custodyProfile: null,
    });
  });

  it('deduplicates concurrent startup and permits a clean restart after shutdown', async () => {
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    const createRuntime = vi
      .fn()
      .mockResolvedValueOnce(fixtureRuntime(firstClose))
      .mockResolvedValueOnce(fixtureRuntime(secondClose));
    const loader = createAflTradePublicReadRuntimeLoader({
      loadConfig: () => postgresConfig,
      createRuntime,
    });

    const [first, concurrent] = await Promise.all([loader.get(), loader.get()]);
    expect(concurrent).toBe(first);
    expect(createRuntime).toHaveBeenCalledTimes(1);

    await loader.shutdown();
    expect(firstClose).toHaveBeenCalledOnce();
    expect((await loader.get()).mode).toBe('postgres');
    expect(createRuntime).toHaveBeenCalledTimes(2);
  });

  it('does not retain a rejected startup promise', async () => {
    const createRuntime = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(fixtureRuntime());
    const loader = createAflTradePublicReadRuntimeLoader({
      loadConfig: () => postgresConfig,
      createRuntime,
    });

    await expect(loader.get()).rejects.toThrow('unavailable');
    await expect(loader.get()).resolves.toMatchObject({ mode: 'postgres' });
    expect(createRuntime).toHaveBeenCalledTimes(2);
  });
});
