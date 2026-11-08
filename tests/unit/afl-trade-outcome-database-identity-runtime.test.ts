import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const pg = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(async () => undefined),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: pg.query, end: pg.end, connect: vi.fn() };
  }),
}));

import { OUTCOME_DATABASE_IDENTITY } from '@/server/aflTradeIntelligence/outcomes/outcomeDatabaseIdentity';
import { createAflTradePublicReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import type { AflTradePublicReadConfig } from '@/server/aflTradeIntelligence/runtime/publicReadConfig';

const config = {
  mode: 'postgres',
  environment: 'production',
  databaseUrl: 'postgresql://statly.invalid/outcomes',
  cursorSecret: new Uint8Array(32),
  artifactStorage: {
    kind: 'local_filesystem',
    rootDirectory: '/tmp/statly-identity-test-artifacts',
  },
} as unknown as AflTradePublicReadConfig;

const identityRow = {
  application_id: OUTCOME_DATABASE_IDENTITY.applicationId,
  schema_format: OUTCOME_DATABASE_IDENTITY.schemaFormat,
};

describe('public read runtime checks the outcomes database identity before serving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts when the database declares this application and schema format', async () => {
    pg.query.mockResolvedValue({ rows: [identityRow], rowCount: 1 });

    const runtime = await createAflTradePublicReadRuntime(config);

    expect(runtime.mode).toBe('postgres');
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM outcome_database_identity/),
      undefined
    );
    await runtime.close();
  });

  it.each([
    ['another application', [{ ...identityRow, application_id: 'statly-fantasy' }]],
    ['another schema format', [{ ...identityRow, schema_format: 2 }]],
    ['no identity row', []],
  ])('refuses %s and closes the pool', async (_label, rows) => {
    pg.query.mockResolvedValue({ rows, rowCount: rows.length });

    await expect(createAflTradePublicReadRuntime(config)).rejects.toThrow(
      /does not declare statly-afl-trade-outcomes schema format 1/
    );
    expect(pg.end).toHaveBeenCalledOnce();
  });

  it('refuses a database without the identity table (for example the fantasy database)', async () => {
    pg.query.mockRejectedValue(
      Object.assign(new Error('relation "outcome_database_identity" does not exist'), {
        code: '42P01',
      })
    );

    await expect(createAflTradePublicReadRuntime(config)).rejects.toThrow(
      /no readable outcome_database_identity/
    );
    expect(pg.end).toHaveBeenCalledOnce();
  });
});
