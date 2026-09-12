import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { seedPrivateValuationCohortBindingFixture } from '../testUtils/privateValuationCohortBindingFixture';
import { createHash } from 'node:crypto';
import { PostgresAflTradePrivateValuationCohortBinding } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCohortBinding';
import { PostgresAflTradePrivateValuationTradeEvidence } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationTradeEvidence';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_cohort_binding_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const restricted = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName} -c role=afl_trade_private_evaluation_coordinator`,
});
const hash = (marker: string) => marker.repeat(64);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  // Existing0108 current-authority mechanics have their own migrated regression.
  // Isolate only that upstream result here; the real live-claim loader still executes.
  await pool.query(
    'CREATE TABLE synthetic_cohort_hpn_authority(request_id TEXT PRIMARY KEY,binding_json JSONB)'
  );
  await pool.query(
    `GRANT SELECT ON synthetic_cohort_hpn_authority TO afl_trade_private_valuation_scheduler_owner`
  );
  await pool.query(`CREATE OR REPLACE FUNCTION load_outcome_private_valuation_hpn_factual_input(
    target_request_id TEXT,target_output_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $fn$
    DECLARE request RECORD; result JSONB; BEGIN
      SELECT * INTO request FROM outcome_private_valuation_dispatch_request WHERE request_id=target_request_id;
      PERFORM load_outcome_private_valuation_dispatch_request_for_claim(target_request_id,request.claim_id,request.lease_token_sha256);
      SELECT binding_json INTO result FROM synthetic_cohort_hpn_authority WHERE request_id=target_request_id;
      IF result->>'factualOutputId' IS DISTINCT FROM target_output_id THEN RAISE EXCEPTION 'Synthetic HPN authority mismatch'; END IF;
      RETURN result; END $fn$`);
});
afterAll(async () => {
  await restricted.end();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

describe.sequential('request-bound private cohort authority', () => {
  let fixture: Awaited<ReturnType<typeof seedPrivateValuationCohortBindingFixture>>;
  const adapter = new PostgresAflTradePrivateValuationCohortBinding(
    createPgAflOutcomeSqlClient(restricted)
  );
  async function rejectsMutation(sql: string, parameters: readonly unknown[], message: RegExp) {
    await createPgAflOutcomeSqlClient(pool).transaction(async (transaction) => {
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      const changed = await transaction.query(sql, parameters);
      expect(changed.rowCount, 'tamper must affect retained custody').toBeGreaterThan(0);
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await expect(
        transaction.query('SELECT load_outcome_private_valuation_cohort_input($1)', [
          fixture.requestId,
        ])
      ).rejects.toThrow(message);
    });
  }
  it('has no implicit cohort parent for an unbound request', async () => {
    const result = await restricted.query(
      'SELECT load_outcome_private_valuation_cohort_input($1) AS binding',
      [`private-valuation-dispatch:${hash('0')}`]
    );
    expect(result.rows).toEqual([{ binding: null }]);
  });
  it('binds an independent admitted 2025 cohort and exactly replays without public writes', async () => {
    fixture = await seedPrivateValuationCohortBindingFixture(createPgAflOutcomeSqlClient(pool), {
      includeTradeEvidence: true,
    });
    const input = {
      requestId: fixture.requestId,
      claim: { claimId: fixture.claim.claimId, leaseToken: fixture.claim.leaseToken },
      lineageAdmissionId: fixture.admissionId,
    };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => adapter.bind(input)));
    expect(concurrent).toEqual(Array.from({ length: 4 }, () => concurrent[0]));
    const args = [
      fixture.requestId,
      fixture.claim.claimId,
      createHash('sha256').update(fixture.claim.leaseToken).digest('hex'),
      fixture.admissionId,
    ];
    const result = await restricted.query(
      'SELECT bind_outcome_private_valuation_cohort_input($1,$2,$3,$4) AS binding',
      args
    );
    expect(result.rows[0]?.binding).toMatchObject({
      requestId: fixture.requestId,
      lineageAdmissionId: fixture.admissionId,
      cohortCandidateId: fixture.candidateId,
      cohortReleaseId: fixture.releaseId,
      cohortScopeKey: 'afl-men:2025-trades',
      cohortTradeIds: [fixture.eventVersionId],
      effectiveThrough: '2026-01-01T00:00:00.000Z',
    });
    const replay = await restricted.query(
      'SELECT bind_outcome_private_valuation_cohort_input($1,$2,$3,$4) AS binding',
      args
    );
    expect(replay.rows).toEqual(result.rows);
    const loaded = await restricted.query(
      'SELECT load_outcome_private_valuation_cohort_input($1) AS binding',
      [fixture.requestId]
    );
    expect(loaded.rows).toEqual(result.rows);
    await expect(adapter.load(input)).resolves.toEqual(result.rows[0].binding);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM outcome_active_release')).rows
    ).toEqual([{ count: 0 }]);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM outcome_registry_event')).rows
    ).toEqual([{ count: 0 }]);
  });

  it('reads all seven sealed member kinds through the restricted private boundary and replays exactly', async () => {
    const reader = new PostgresAflTradePrivateValuationTradeEvidence(
      createPgAflOutcomeSqlClient(restricted)
    );
    const input = {
      requestId: fixture.requestId,
      claim: { claimId: fixture.claim.claimId, leaseToken: fixture.claim.leaseToken },
    };
    const first = await reader.load(input);
    expect(first.trades).toEqual([
      { eventId: fixture.eventId, eventVersionId: fixture.eventVersionId },
    ]);
    expect(first.members.map(({ recordKind }) => recordKind)).toEqual([
      'draft_event',
      'draft_player_asset',
      'draft_selection',
      'pick_custody',
      'pick_realization',
      'transaction',
      'transfer',
    ]);
    expect(first.members.map(({ recordCanonicalJson }) => recordCanonicalJson)).toEqual(
      fixture.snapshots.map(({ recordCanonicalJson }) => recordCanonicalJson)
    );
    expect(await reader.load(input)).toEqual(first);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM outcome_active_release')).rows
    ).toEqual([{ count: 0 }]);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM outcome_registry_event')).rows
    ).toEqual([{ count: 0 }]);
  });

  it.each([
    [
      'missing snapshot',
      `DELETE FROM outcome_release_pick_custody WHERE release_id=$1`,
      /incomplete sealed membership/,
    ],
    [
      'changed bytes',
      `UPDATE outcome_release_event_asset SET record_canonical_json='{}' WHERE release_id=$1`,
      /mismatched sealed record/,
    ],
    [
      'substituted digest',
      `UPDATE outcome_release_pick_realization SET record_sha256=repeat('f',64) WHERE release_id=$1`,
      /mismatched sealed record/,
    ],
    [
      'withdrawn source',
      `UPDATE outcome_gate_decision SET state='withdrawn' WHERE decision_id=(SELECT membership_json->>'gateDecisionId' FROM outcome_release_source_capture WHERE release_id=$1 LIMIT 1)`,
      /Gate 0A/,
    ],
    [
      'expired claim',
      `UPDATE outcome_private_valuation_dispatch_request SET lease_expires_at=now()-interval '1 second'
       WHERE request_id=(SELECT request_id FROM outcome_private_valuation_cohort_binding
         WHERE binding_json->>'cohortReleaseId'=$1)`,
      /claim|dispatch/i,
    ],
  ] as const)(
    'rejects %s before returning private source evidence',
    async (_label, sql, message) => {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SET LOCAL session_replication_role='replica'");
        const changed = await connection.query(sql, [fixture.releaseId]);
        expect(changed.rowCount).toBeGreaterThan(0);
        await connection.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await expect(
          connection.query('SELECT load_outcome_private_valuation_trade_evidence($1,$2,$3)', [
            fixture.requestId,
            fixture.claim.claimId,
            createHash('sha256').update(fixture.claim.leaseToken).digest('hex'),
          ])
        ).rejects.toThrow(message);
      } finally {
        await connection.query('ROLLBACK');
        connection.release();
      }
    }
  );

  it('denies stale claim credentials and direct table access to the private reader', async () => {
    await expect(
      restricted.query('SELECT load_outcome_private_valuation_trade_evidence($1,$2,$3)', [
        fixture.requestId,
        fixture.claim.claimId,
        hash('0'),
      ])
    ).rejects.toThrow(/claim|dispatch/i);
    await expect(
      restricted.query('SELECT record_canonical_json FROM outcome_release_event_asset')
    ).rejects.toThrow(/permission denied/);
    const publicAccess = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM pg_proc fn
      JOIN pg_namespace ns ON ns.oid=fn.pronamespace,LATERAL aclexplode(fn.proacl) privilege
      WHERE ns.nspname=$1 AND fn.proname='load_outcome_private_valuation_trade_evidence'
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS allowed`,
      [schemaName]
    );
    expect(publicAccess.rows).toEqual([{ allowed: false }]);
  });

  it('rejects substituted admission and stale or wrong claim credentials', async () => {
    const input = {
      requestId: fixture.requestId,
      claim: { claimId: fixture.claim.claimId, leaseToken: fixture.claim.leaseToken },
      lineageAdmissionId: fixture.admissionId,
    };
    await expect(
      adapter.bind({
        ...input,
        lineageAdmissionId: `corpus-factual-lineage-admission:${hash('0')}`,
      })
    ).rejects.toThrow(/admission.*unavailable|mismatched/);
    await expect(
      adapter.bind({ ...input, claim: { ...input.claim, leaseToken: hash('0') } })
    ).rejects.toThrow(/claim|dispatch/i);
    await rejectsMutation(
      `UPDATE outcome_private_valuation_dispatch_request SET lease_expires_at=now()-interval '1 second'
      WHERE request_id=$1`,
      [fixture.requestId],
      /claim|dispatch/i
    );
  });

  it('rejects withdrawn release, Gate 2 admission, and source Gate 0A permission', async () => {
    await rejectsMutation(
      `INSERT INTO outcome_record_state_commitment(event_revision,release_id,record_state_id,record_state_json)
      VALUES (2,$1,$2,'{"state":"withdrawn"}'::jsonb)`,
      [fixture.releaseId, `outcome-release-record-state:${hash('b')}`],
      /release.*unavailable/
    );
    await rejectsMutation(
      `UPDATE outcome_gate_decision SET state='withdrawn' WHERE decision_id=$1`,
      [fixture.gate2Id],
      /Gate 2/
    );
    await rejectsMutation(
      `UPDATE outcome_gate_decision SET state='withdrawn' WHERE decision_id=$1`,
      [fixture.gate0Id],
      /Gate 0A/
    );
  });

  it('rejects special-right assets as historical valuation inputs even on dated trades', async () => {
    await rejectsMutation(
      `INSERT INTO outcome_event_asset(asset_version_id,event_version_id,asset_key,kind,source_import_row_id,
      raw_description,status,special_entitlement_id)
      SELECT 'fixture-special-asset',event_version_id,'fixture-special','list_right',source_import_row_id,
      'Fixture right','approved','fixture-special-right' FROM outcome_event_version WHERE kind='trade' LIMIT 1`,
      [],
      /requires exhaustive approved AFLM 2025 trades/
    );
  });
  it('rejects a year-only factual trade at the private valuation boundary', async () => {
    await rejectsMutation(
      `UPDATE outcome_event_version SET event_date=NULL WHERE kind='trade'`,
      [],
      /requires exhaustive approved AFLM 2025 trades/
    );
  });
  it('rejects foreign-year transactions and post-cutoff captures rather than filtering them away', async () => {
    await rejectsMutation(
      `UPDATE outcome_event SET season_year=2024 WHERE event_id=$1`,
      [fixture.eventId],
      /exhaustive.*2025 trades/
    );
    await rejectsMutation(
      `UPDATE outcome_source_capture SET captured_at='2026-02-01T00:00:00Z' WHERE capture_id=$1`,
      [fixture.captureId],
      /source capture authority/
    );
  });

  it('reauthenticates current factual revision and prevents direct coordinator mutation', async () => {
    await rejectsMutation(
      `UPDATE synthetic_cohort_hpn_authority SET binding_json=jsonb_set(binding_json,'{privateFactualRevision}','2')
      WHERE request_id=$1`,
      [fixture.requestId],
      /bound authority changed/
    );
    await expect(
      restricted.query(`DELETE FROM outcome_private_valuation_cohort_binding WHERE request_id=$1`, [
        fixture.requestId,
      ])
    ).rejects.toThrow(/permission denied/);
    const publicAccess = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM pg_proc fn
      JOIN pg_namespace ns ON ns.oid=fn.pronamespace,LATERAL aclexplode(fn.proacl) privilege
      WHERE ns.nspname=$1 AND fn.proname IN ('load_outcome_private_valuation_cohort_input',
        'bind_outcome_private_valuation_cohort_input','authenticate_outcome_private_valuation_cohort_input')
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS allowed`,
      [schemaName]
    );
    expect(publicAccess.rows).toEqual([{ allowed: false }]);
  });
});
