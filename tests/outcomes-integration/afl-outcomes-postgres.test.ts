import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { AflDraftTradeOutcomeReleaseRepositoryError } from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseRepository';
import {
  createPostgresAflDraftTradeOutcomeReleaseRepository,
  type AflOutcomeSqlClient,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  aflDraftTradeOutcomeFixtureHash,
  createAflDraftTradeOutcomeReleaseFixture,
} from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

interface QueryResultLike<Row = Record<string, unknown>> {
  rows: readonly Row[];
  rowCount: number | null;
}

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'AFL_OUTCOMES_TEST_DATABASE_URL must identify an explicitly provisioned disposable PostgreSQL database.'
  );
}

const schemaName = `afl_outcomes_test_${process.pid}_${Date.now()}`;
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0001_factual_release_registry',
    'migration.sql'
  ),
  'utf8'
);
const prismaSchemaPath = join(process.cwd(), 'prisma', 'afl-trade-outcomes', 'schema.prisma');
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});

async function query<Row = Record<string, unknown>>(
  sql: string,
  parameters: readonly unknown[] = []
): Promise<QueryResultLike<Row>> {
  return (await outcomesPool.query(sql, [...parameters])) as QueryResultLike<Row>;
}

function createTwoPartyBarrier() {
  let arrivals = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await opened;
  };
}

function createBarrieredOutcomeSqlClient(
  client: AflOutcomeSqlClient,
  afterHeadLoad: () => Promise<void>,
  beforeHeadLock: () => Promise<void>
): AflOutcomeSqlClient {
  return {
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      const result = await client.query<Row>(sql, parameters);
      if (sql.includes('FROM outcome_registry_head') && !sql.includes('FOR UPDATE')) {
        await afterHeadLoad();
      }
      return result;
    },
    transaction(work) {
      return client.transaction((transaction) =>
        work({
          async query<Row>(sql: string, parameters?: readonly unknown[]) {
            if (sql.includes('FROM outcome_registry_head') && sql.includes('FOR UPDATE')) {
              await beforeHeadLock();
            }
            return transaction.query<Row>(sql, parameters);
          },
        })
      );
    },
  };
}

const releaseId = `outcome-release:${'a'.repeat(64)}`;
const projectionId = `outcome-projection:${'b'.repeat(64)}`;
const secondProjectionId = `outcome-projection:${'c'.repeat(64)}`;

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  await outcomesPool.query(migration);
});

afterAll(async () => {
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('isolated AFL outcomes PostgreSQL migration', () => {
  it('has no Prisma-detectable drift from the checked-in native migration', () => {
    const scopedDatabaseUrl = new URL(databaseUrl);
    scopedDatabaseUrl.searchParams.set('schema', schemaName);

    expect(() =>
      execFileSync(
        'npx',
        [
          '--no-install',
          'prisma',
          'migrate',
          'diff',
          '--from-schema-datasource',
          prismaSchemaPath,
          '--to-schema-datamodel',
          prismaSchemaPath,
          '--exit-code',
        ],
        {
          env: {
            ...process.env,
            AFL_OUTCOMES_DATABASE_URL: scopedDatabaseUrl.toString(),
          },
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });

  it('loads the authenticated initial registry through the real repository boundary', async () => {
    const sqlClient = createPgAflOutcomeSqlClient(outcomesPool);
    const repository = createPostgresAflDraftTradeOutcomeReleaseRepository(sqlClient);

    await expect(repository.loadRegistry()).resolves.toEqual({
      revision: 0,
      releases: {},
      activeByScope: {},
      events: [],
    });
  });

  it('accepts multiple immutable projection versions for one release', async () => {
    await query(
      `INSERT INTO outcome_release_manifest
        (release_id, scope_key, environment, created_at, effective_through, manifest_json)
       VALUES ($1, $2, 'test_fixture', $3, $4, '{}'::jsonb)`,
      [
        releaseId,
        'public-afl-draft-trade-outcomes',
        '2026-08-06T02:00:00.000Z',
        '2026-08-06T01:00:00.000Z',
      ]
    );
    for (const id of [projectionId, secondProjectionId]) {
      await query(
        `INSERT INTO outcome_projection_manifest
          (projection_id, release_id, created_at, manifest_json)
         VALUES ($1, $2, $3, '{}'::jsonb)`,
        [id, releaseId, '2026-08-06T03:00:00.000Z']
      );
    }

    await expect(
      query('UPDATE outcome_projection_manifest SET created_at = CURRENT_TIMESTAMP')
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      query('DELETE FROM outcome_projection_manifest WHERE projection_id = $1', [projectionId])
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('enforces release and self-referential event-chain foreign keys', async () => {
    await expect(
      query(
        `INSERT INTO outcome_registry_event
          (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
         VALUES (1, $1, NULL, $2, 'scope', 'register', CURRENT_TIMESTAMP, '{}'::jsonb)`,
        [`outcome-release-event:${'d'.repeat(64)}`, `outcome-release:${'e'.repeat(64)}`]
      )
    ).rejects.toMatchObject({ code: '23503' });

    await query(
      `INSERT INTO outcome_registry_event
        (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
       VALUES (1, $1, NULL, $2, 'public-afl-draft-trade-outcomes', 'register', CURRENT_TIMESTAMP, '{}'::jsonb)`,
      [`outcome-release-event:${'f'.repeat(64)}`, releaseId]
    );
    await expect(
      query(
        `INSERT INTO outcome_registry_event
          (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
         VALUES (2, $1, $2, $3, 'public-afl-draft-trade-outcomes', 'validate', CURRENT_TIMESTAMP, '{}'::jsonb)`,
        [
          `outcome-release-event:${'1'.repeat(64)}`,
          `outcome-release-event:${'2'.repeat(64)}`,
          releaseId,
        ]
      )
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('normalizes projection-item identity without nullable-key ambiguity', async () => {
    const insert = (ordinal: number) =>
      query(
        `INSERT INTO outcome_projection_item
          (release_id, projection_id, ordinal, item_key, event_id, year, afl_club_id,
           club_name, player_name, search_text, metric_codes, status_codes, item_json)
         VALUES ($1, $2, $3, 'event-without-asset', 'event-1', 2026, 'club-1',
                 'Fixture Club', 'Fixture Player', 'fixture player', ARRAY['games'], ARRAY[]::TEXT[], '{}'::jsonb)`,
        [releaseId, projectionId, ordinal]
      );

    await insert(0);
    await expect(insert(1)).rejects.toMatchObject({ code: '23505' });
    await expect(
      query(
        `INSERT INTO outcome_projection_item
          (release_id, projection_id, ordinal, item_key, event_id, year, afl_club_id,
           club_name, player_name, search_text, metric_codes, status_codes, item_json)
         VALUES ($1, $2, 2, 'null-array', 'event-2', 2026, 'club-1',
                 'Fixture Club', 'Fixture Player', 'fixture player', NULL, ARRAY[]::TEXT[], '{}'::jsonb)`,
        [releaseId, projectionId]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rolls back all writes after an injected transaction failure', async () => {
    const transactional = createPgAflOutcomeSqlClient(outcomesPool);
    const rolledBackReleaseId = `outcome-release:${'9'.repeat(64)}`;

    await expect(
      transactional.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO outcome_release_manifest
            (release_id, scope_key, environment, created_at, effective_through, manifest_json)
           VALUES ($1, 'rollback-scope', 'test_fixture', $2, $3, '{}'::jsonb)`,
          [rolledBackReleaseId, '2026-08-06T02:00:00.000Z', '2026-08-06T01:00:00.000Z']
        );
        throw new Error('injected integration failure');
      })
    ).rejects.toThrow('injected integration failure');

    const result = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM outcome_release_manifest WHERE release_id = $1',
      [rolledBackReleaseId]
    );
    expect(result.rows[0].count).toBe('0');
  });

  it('admits only one expected-revision winner', async () => {
    const update = () =>
      query(
        `UPDATE outcome_registry_head
         SET revision = 1, updated_at = CURRENT_TIMESTAMP
         WHERE singleton_id = 1 AND revision = 0`
      );
    const results = await Promise.all([update(), update()]);
    expect(results.map(({ rowCount }) => rowCount).sort()).toEqual([0, 1]);
  });

  it('admits one real repository registration and preserves exact head/event/manifest parity', async () => {
    const raceSchemaName = `${schemaName}_repository_race`;
    await adminPool.query(`CREATE SCHEMA "${raceSchemaName}"`);
    const racePool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${raceSchemaName}`,
    });
    try {
      await racePool.query(migration);
      const afterHeadLoad = createTwoPartyBarrier();
      const beforeHeadLock = createTwoPartyBarrier();
      const firstRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(
        createBarrieredOutcomeSqlClient(
          createPgAflOutcomeSqlClient(racePool),
          afterHeadLoad,
          beforeHeadLock
        )
      );
      const secondRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(
        createBarrieredOutcomeSqlClient(
          createPgAflOutcomeSqlClient(racePool),
          afterHeadLoad,
          beforeHeadLock
        )
      );
      const first = createAflDraftTradeOutcomeReleaseFixture('3');
      const second = createAflDraftTradeOutcomeReleaseFixture('4');
      const outcomes = await Promise.allSettled([
        firstRepository.register({
          expectedRevision: 0,
          manifest: first.release,
          actor: 'fixture-importer-a',
          evidenceId: `artifact:${aflDraftTradeOutcomeFixtureHash('5')}`,
        }),
        secondRepository.register({
          expectedRevision: 0,
          manifest: second.release,
          actor: 'fixture-importer-b',
          evidenceId: `artifact:${aflDraftTradeOutcomeFixtureHash('6')}`,
        }),
      ]);

      const fulfilled = outcomes.filter(
        (
          outcome
        ): outcome is PromiseFulfilledResult<
          Awaited<ReturnType<typeof firstRepository.register>>
        > => outcome.status === 'fulfilled'
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(AflDraftTradeOutcomeReleaseRepositoryError);
      expect(rejected[0].reason).toMatchObject({ code: 'STALE_REVISION' });

      const winner = fulfilled[0].value;
      const winnerRelease = Object.values(winner.releases)[0];
      const head = await racePool.query<{
        revision: number;
        last_event_id: string;
        registry_json: unknown;
      }>(
        `SELECT revision, last_event_id, registry_json
         FROM outcome_registry_head WHERE singleton_id = 1`
      );
      expect(head.rows[0]).toEqual({
        revision: winner.revision,
        last_event_id: winner.events[0].eventId,
        registry_json: winner,
      });

      const events = await racePool.query<{
        revision: number;
        event_id: string;
        event_json: unknown;
      }>('SELECT revision, event_id, event_json FROM outcome_registry_event ORDER BY revision');
      expect(events.rows).toEqual([
        {
          revision: winner.revision,
          event_id: winner.events[0].eventId,
          event_json: winner.events[0],
        },
      ]);

      const manifests = await racePool.query<{
        release_id: string;
        manifest_json: unknown;
      }>('SELECT release_id, manifest_json FROM outcome_release_manifest');
      expect(manifests.rows).toEqual([
        {
          release_id: winnerRelease.releaseId,
          manifest_json: winnerRelease.releaseManifest,
        },
      ]);
    } finally {
      await racePool.end();
      await adminPool.query(`DROP SCHEMA "${raceSchemaName}" CASCADE`);
    }
  });
});
