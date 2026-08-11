import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeExternalCaptureSchedule } from '@/server/aflTradeIntelligence/source/externalDraftTradeScheduling';
import { PostgresAflTradeExternalCaptureScheduleRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeScheduleRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_external_schedule_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

const digest = (character: string) => character.repeat(64);
let anchor = '';

function afterAnchor(seconds: number): string {
  return new Date(Date.parse(anchor) + seconds * 1_000).toISOString();
}

function schedule() {
  return createAflTradeExternalCaptureSchedule({
    schemaVersion: 'afl-trade-external-capture-schedule-definition/v1',
    requestTemplate: {
      environment: 'test_fixture',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      draftPathway: null,
      dataset: 'draftguru-trades',
      datasetVersion: '2025',
      accessMechanism: 'automated_web',
      capabilityId: 'draftguru-trade-detail',
      sourceUrl: 'https://www.draftguru.com.au/trades/2025-liam-reidy',
      effectiveAt: '2025-10-15T00:00:00.000Z',
      parserVersion: 'draftguru-trade-detail/v1',
      fieldManifestSha256: digest('a'),
      maximumBytes: 1_048_576,
    },
    gateRequestTemplate: {
      decisionKey: 'draftguru-trade-detail-test_fixture',
      environment: 'test_fixture',
      rightsArtifactId: `source-rights:${digest('b')}`,
      competition: 'AFLM',
      season: 2025,
      accessMechanism: 'automated_web',
      capabilityId: null,
      geography: 'Australia',
      commercialContext: 'public_archive',
      audience: 'public',
      operations: ['bounded_evaluation_capture', 'raw_evidence_retention'],
      fieldUses: [{ sourceField: 'trade_id', use: 'public_display' }],
      rawRetentionDays: 365,
      metadataRetentionDays: 2_555,
      cacheSeconds: 86_400,
    },
    cadence: { anchorAt: anchor, intervalSeconds: 3_600, maximumLatenessSeconds: 1_800 },
    execution: {
      maximumAttempts: 3,
      leaseSeconds: 900,
      retryBaseSeconds: 30,
      retryMaximumSeconds: 300,
      circuitFailureThreshold: 3,
      circuitResetSeconds: 900,
    },
    concurrencyPolicy: 'forbid_overlap',
    publicationEligible: false,
  });
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(),
  });
  const trustedTime = await outcomesPool.query<{ anchor: Date }>(
    `SELECT date_trunc('second',clock_timestamp() - interval '1 second') AS anchor`
  );
  anchor = trustedTime.rows[0]!.anchor.toISOString();
});

afterAll(async () => {
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('PostgreSQL external capture scheduling', () => {
  it('registers exactly, gives one concurrent worker the lease, retries, and completes immutably', async () => {
    const repository = new PostgresAflTradeExternalCaptureScheduleRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const definition = schedule();
    await expect(repository.register(definition, anchor)).resolves.toEqual({
      scheduleId: definition.scheduleId,
      idempotentReplay: false,
    });
    await expect(repository.register(definition, anchor)).resolves.toEqual({
      scheduleId: definition.scheduleId,
      idempotentReplay: true,
    });
    await expect(
      repository.listDue({ environment: 'test_fixture', observedAt: anchor, limit: 10 })
    ).resolves.toEqual([{ scheduleId: definition.scheduleId, dueAt: anchor }]);

    const dueAt = anchor;
    const [left, right] = await Promise.all([
      repository.claim({
        scheduleId: definition.scheduleId,
        dueAt,
        observedAt: afterAnchor(1),
        workerId: 'worker-a',
        leaseTokenSha256: digest('c'),
      }),
      repository.claim({
        scheduleId: definition.scheduleId,
        dueAt,
        observedAt: afterAnchor(1),
        workerId: 'worker-b',
        leaseTokenSha256: digest('d'),
      }),
    ]);
    const claimed = [left, right].find(({ action }) => action === 'claim');
    expect([left.action, right.action].sort()).toEqual(['claim', 'defer_lease']);
    expect(claimed?.proposedClaim).not.toBeNull();

    await repository.complete({
      claim: claimed!.proposedClaim!,
      completedAt: afterAnchor(2),
      outcome: { status: 'failed', failureCode: 'TRANSPORT_FAILURE' },
    });
    const retry = await outcomesPool.query<{ available_at: Date }>(
      `SELECT available_at FROM outcome_external_capture_occurrence`
    );
    await expect(
      repository.listDue({
        environment: 'test_fixture',
        observedAt: new Date(retry.rows[0]!.available_at.getTime() - 1).toISOString(),
        limit: 10,
      })
    ).resolves.toEqual([]);
    await expect(
      repository.listDue({
        environment: 'test_fixture',
        observedAt: retry.rows[0]!.available_at.toISOString(),
        limit: 10,
      })
    ).resolves.toEqual([{ scheduleId: definition.scheduleId, dueAt }]);
    const next = await repository.claim({
      scheduleId: definition.scheduleId,
      dueAt,
      observedAt: retry.rows[0]!.available_at.toISOString(),
      workerId: 'worker-c',
      leaseTokenSha256: digest('e'),
    });
    expect(next.action).toBe('claim');
    expect(next.proposedClaim?.attemptNumber).toBe(2);
    await repository.complete({
      claim: next.proposedClaim!,
      completedAt: new Date(Date.parse(next.proposedClaim!.claimedAt) + 1_000).toISOString(),
      outcome: { status: 'completed', resultId: `external-evidence-batch:${digest('f')}` },
    });

    const stored = await outcomesPool.query<{
      status: string;
      attempt_number: number;
      attempts: string;
      events: string;
    }>(`
      SELECT occurrence.status, occurrence.attempt_number,
             (SELECT COUNT(*)::text FROM outcome_external_capture_attempt) AS attempts,
             (SELECT COUNT(*)::text FROM outcome_external_capture_occurrence_event) AS events
        FROM outcome_external_capture_occurrence occurrence
    `);
    expect(stored.rows[0]).toMatchObject({
      status: 'completed',
      attempt_number: 2,
      attempts: '2',
      events: '4',
    });
    await expect(
      repository.listDue({
        environment: 'test_fixture',
        observedAt: afterAnchor(3_600),
        limit: 10,
      })
    ).resolves.toEqual([{ scheduleId: definition.scheduleId, dueAt: afterAnchor(3_600) }]);
    await expect(
      outcomesPool.query(`UPDATE outcome_external_capture_attempt SET worker_id='tampered'`)
    ).rejects.toThrow(/append-only/i);
  });

  it('records a first-seen late occurrence without fabricating a claim', async () => {
    const repository = new PostgresAflTradeExternalCaptureScheduleRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const definition = schedule();
    const decision = await repository.claim({
      scheduleId: definition.scheduleId,
      dueAt: afterAnchor(3_600),
      observedAt: afterAnchor(5_401),
      workerId: 'late-worker',
      leaseTokenSha256: digest('1'),
    });
    expect(decision.action).toBe('skip_late');
    const stored = await outcomesPool.query<{
      status: string;
      last_claim_id: string | null;
      attempt_number: number;
    }>(
      `SELECT status,last_claim_id,attempt_number
         FROM outcome_external_capture_occurrence WHERE dispatch_key=$1`,
      [decision.dispatchKey]
    );
    expect(stored.rows[0]).toEqual({
      status: 'skipped_late',
      last_claim_id: null,
      attempt_number: 0,
    });
  });
});
