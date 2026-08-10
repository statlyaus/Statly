import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

const root = process.cwd();
const schemaPath = join(root, 'prisma', 'afl-trade-outcomes', 'schema.prisma');
const migrationPath = join(
  root,
  'prisma',
  'afl-trade-outcomes',
  'migrations',
  '0001_factual_release_registry',
  'migration.sql'
);
const adapterPath = join(
  root,
  'src',
  'server',
  'aflTradeIntelligence',
  'outcomes',
  'postgresOutcomeReleaseRepository.ts'
);

describe('isolated AFL outcome PostgreSQL persistence architecture', () => {
  it('uses a separate PostgreSQL schema, URL, client output, and migration history', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('provider = "postgresql"');
    expect(schema).toContain('env("AFL_OUTCOMES_DATABASE_URL")');
    expect(schema).toContain('output        = "../../src/generated/aflTradeOutcomesPrisma"');
    expect(schema).not.toContain('env("DATABASE_URL")');
    expect(schema).not.toMatch(/model (?:User|League|LeagueMember|LeagueTrade|Roster)/);

    const fantasySchema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
    expect(fantasySchema).toContain('provider = "sqlite"');
    expect(fantasySchema).not.toContain('OutcomeRegistryHead');
  });

  it('keeps immutable history and a separately mutable CAS pointer/head', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('CREATE TABLE "outcome_registry_head"');
    expect(migration).toContain('CREATE TABLE "outcome_registry_event"');
    expect(migration).toContain('CREATE TABLE "outcome_record_state_commitment"');
    expect(migration).toContain('CREATE TABLE "outcome_active_release"');
    expect(migration).toContain('CREATE TABLE "outcome_projection_item"');
    expect(migration).toContain('reject_outcome_append_only_mutation');
    expect(migration).toContain('outcome_registry_event_append_only');
    expect(migration).toContain('outcome_record_state_commitment_append_only');
    expect(migration).toContain('FOREIGN KEY ("release_id", "projection_id")');
    expect(migration).toContain('outcome_registry_event_previous_event_id_fkey');
    expect(migration).toContain('outcome_registry_event_release_id_fkey');
    expect(migration).toContain('outcome_record_state_commitment_release_id_fkey');
    expect(migration).toContain('"item_key" TEXT NOT NULL');
    expect(migration).not.toContain('COALESCE("asset_id"');
    expect(migration).not.toMatch(/\b(?:user_id|league_id|member_id|roster_id)\b/i);
  });

  it('keeps versioned projection and projection-item identities aligned across Prisma and SQL', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const migration = readFileSync(migrationPath, 'utf8');
    const projectionModelStart = schema.indexOf('model OutcomeProjectionManifest');
    const projectionModel = schema.slice(
      projectionModelStart,
      schema.indexOf('model OutcomeRegistryEvent {', projectionModelStart)
    );

    expect(schema).toMatch(/projections\s+OutcomeProjectionManifest\[\]/);
    expect(projectionModel).not.toMatch(/releaseId\s+String\s+@unique\s+@map\("release_id"\)/);
    expect(schema).toMatch(/itemKey\s+String\s+@map\("item_key"\)/);
    expect(schema).toContain('@@unique([projectionId, itemKey], map:');
    expect(schema).toContain('@@index([metricCodes], type: Gin, map:');
    expect(schema).toContain('@@index([statusCodes], type: Gin, map:');
    expect(schema).toContain('@outcomes.Timestamptz(3)');
    expect(schema).toMatch(/metricCodes\s+String\[\]\s+@default\(\[\]\)/);
    expect(migration).not.toContain('outcome_projection_manifest_release_id_key');
    expect(migration).toContain('outcome_projection_item_projection_item_key');
    expect(migration).toContain('outcome_projection_item_release_player_ordinal_idx');
    expect(migration).toContain('outcome_projection_item_metric_codes_not_null_check');
    expect(migration).toContain('TIMESTAMPTZ(3)');
  });

  it('requires an injected SQL client and performs one locked expected-revision transaction', () => {
    const adapter = readFileSync(adapterPath, 'utf8');
    expect(adapter).toContain('FOR UPDATE');
    expect(adapter).toContain('WHERE singleton_id = 1 AND revision = $4');
    expect(adapter).toContain('this.client.transaction');
    expect(adapter).toContain('authenticateAflDraftTradeOutcomeReleaseRegistry');
    expect(adapter).not.toContain('process.env');
    expect(adapter).not.toContain('DATABASE_URL');
    expect(adapter).not.toContain("from '@prisma/client'");
    expect(adapter).not.toContain('prePublicationOutcomeReadService');
  });

  it('commits an injected pg transaction with row-lock-compatible isolation and always releases it', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => ({
      rows: [],
      rowCount: 1,
    }));
    const release = vi.fn();
    const pool = {
      query,
      connect: vi.fn(async () => ({ query, release })),
    };
    const client = createPgAflOutcomeSqlClient(pool);

    await expect(
      client.transaction(async (transaction) => {
        await transaction.query('INSERT INTO fixture(value) VALUES ($1)', ['fixture']);
        return 'committed';
      })
    ).resolves.toBe('committed');

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'INSERT INTO fixture(value) VALUES ($1)',
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases an injected pg transaction after a write failure', async () => {
    const failure = new Error('injected write failure');
    const query = vi.fn(async (sql: string, _parameters?: readonly unknown[]) => {
      if (sql.startsWith('INSERT')) throw failure;
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const pool = {
      query,
      connect: vi.fn(async () => ({ query, release })),
    };
    const client = createPgAflOutcomeSqlClient(pool);

    await expect(
      client.transaction(async (transaction) => {
        await transaction.query('INSERT INTO fixture(value) VALUES ($1)', ['fixture']);
      })
    ).rejects.toBe(failure);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'INSERT INTO fixture(value) VALUES ($1)',
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
