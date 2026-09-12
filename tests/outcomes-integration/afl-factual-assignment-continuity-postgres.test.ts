import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { runLocalAflTradeFitzRoyFactualRehearsal } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import {
  aflTradeSourceFactBatchSchema,
  createAflTradeSourceFact,
  createAflTradeSourceFactBatch,
  type AflTradeSourceFactBatch,
} from '@/server/aflTradeIntelligence/outcomes/factualObservationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeFactualObservationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualObservationRepository';
import {
  createAflTradeFactualReconciliationPolicy,
  type AflTradeFactualReconciliationPolicy,
} from '@/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import { reconcileAflTradeFactualFacts } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationService';
import { PostgresAflTradeFactualReconciliationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualReconciliationRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradeProviderResolutionRepository } from '@/server/aflTradeIntelligence/source/postgresProviderResolutionRepository';
import {
  aflTradeProviderResolutionDecisionSchema,
  createAflTradeProviderResolutionDecision,
  createAflTradeProviderResolutionProposal,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const readerRole = `factual_reader_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 4 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const facts = new PostgresAflTradeFactualObservationRepository(client);
const resolutions = new PostgresAflTradeProviderResolutionRepository(client);
const execution = { environment: 'non_production' as const };

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scoped.toString(),
  });
  await pool.query(`CREATE ROLE "${readerRole}" NOLOGIN`);
  await pool.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${readerRole}"`);
  await pool.query(`GRANT SELECT ON outcome_provider_identity_candidate,
    outcome_provider_player_resolution_head,outcome_provider_player_resolution,
    outcome_provider_identity_assignment_head,outcome_review_decision TO "${readerRole}"`);
});

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

async function retainedBatch(batchId: string) {
  const stored = await pool.query<{
    receipt_json: unknown;
    receipt_canonical_json: string | null;
    receipt_canonical_sha256: string | null;
  }>(
    'SELECT receipt_json,receipt_canonical_json,receipt_canonical_sha256 FROM outcome_provider_fact_batch WHERE fact_batch_id=$1',
    [batchId]
  );
  expect(stored.rows).toHaveLength(1);
  const row = stored.rows[0]!;
  if (row.receipt_canonical_json !== null) {
    expect(row.receipt_json).toBeNull();
    expect(createHash('sha256').update(row.receipt_canonical_json, 'utf8').digest('hex')).toBe(
      row.receipt_canonical_sha256
    );
    return aflTradeSourceFactBatchSchema.parse(JSON.parse(row.receipt_canonical_json));
  }
  expect(row.receipt_json).not.toBeNull();
  expect(row.receipt_canonical_sha256).toBeNull();
  return aflTradeSourceFactBatchSchema.parse(row.receipt_json);
}

async function retainSyntheticOccurrencePolicy(identityCandidateId: string) {
  const payload = {
    evidenceKind: 'provider_resolution_policy',
    environment: execution.environment,
    policyVersion: 'synthetic-exact-player-occurrence/v1',
    identityCandidateId,
    boundary: 'This synthetic review grants no reusable provider identity.',
  };
  const id = createAflTradeContentAddress('provider-resolution-policy', payload);
  const sha256 = sha256AflTradeCanonicalJson(payload);
  const canonical = canonicalizeAflTradeJson(payload);
  const artifact = createAflTradeContentAddress('governed-evidence-artifact', { id });
  const approval = createAflTradeContentAddress('governed-evidence-approval-decision', { id });
  await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer');
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
       (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
       VALUES($1,$2,$3,'application/json',$4,'derived_private','non_production','2026-08-12T00:02:05Z','2026-08-12T00:02:06Z','{}'::jsonb)`,
      [artifact, sha256, `artifact://sha256/${sha256}`, Buffer.byteLength(canonical)]
    );
    await transaction.query(
      `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic exact occurrence policy, not reusable identity',
         jsonb_build_object('referenceSha256',$3::text),'synthetic-occurrence-policy-reviewer','2026-08-12T00:02:07Z')`,
      [approval, id, sha256]
    );
    await transaction.query(
      `INSERT INTO outcome_governed_evidence_reference
       (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES($1,$2,'provider_resolution_policy',$3,'non_production','approved',$4,'2026-08-12T00:02:07Z',$5::text,$5::jsonb)`,
      [id, sha256, artifact, approval, canonical]
    );
  });
  return { id, sha256 };
}

function laterBatch(batch: AflTradeSourceFactBatch, minute: number) {
  // This fixture contains season metrics, not metrics linked to an appearance fact ID.
  if (batch.content.facts.some((fact) => fact.content.factKind === 'player_match_metric')) {
    throw new Error('This synthetic readdressing fixture requires season-grain metrics.');
  }
  const recordedAt = `2026-08-12T01:${String(minute).padStart(2, '0')}:00.000Z`;
  const nextFacts = batch.content.facts
    .map((fact) => createAflTradeSourceFact({ ...fact.content, recordedAt }))
    .sort((left, right) => left.factId.localeCompare(right.factId));
  return createAflTradeSourceFactBatch({
    ...batch.content,
    createdAt: recordedAt,
    facts: nextFacts,
    rowAccounting: batch.content.rowAccounting.map((row) => ({
      ...row,
      factIds: nextFacts
        .filter((fact) => fact.content.source.providerDecodedRowId === row.providerDecodedRowId)
        .map((fact) => fact.factId),
    })),
  });
}

// Public fact persistence and resolution owners run against real PostgreSQL. The two
// source generations are explicitly synthetic; no validator or authority is replaced.
describe.sequential('factual occurrence authority across assignment confirmations', () => {
  let original: AflTradeSourceFactBatch;
  let replacement: AflTradeSourceFactBatch;

  beforeAll(async () => {
    const first = await runLocalAflTradeFitzRoyFactualRehearsal(client, { generation: 'baseline' });
    original = await retainedBatch(first.factBatchId);
    const second = await runLocalAflTradeFitzRoyFactualRehearsal(client, {
      generation: 'replacement',
    });
    replacement = await retainedBatch(second.factBatchId);
  }, 120_000);

  it('promotes an earlier exact occurrence after a later same-target confirmation and replays it', async () => {
    const batch = laterBatch(original, 1);
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
      batchId: batch.batchId,
      factCount: 3,
      idempotentReplay: false,
      publicationEligible: false,
    });
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
      batchId: batch.batchId,
      idempotentReplay: true,
    });
    const stored = await pool.query(
      'SELECT receipt_json,receipt_canonical_json,receipt_canonical_sha256 FROM outcome_provider_fact_batch WHERE fact_batch_id=$1',
      [batch.batchId]
    );
    const text = canonicalizeAflTradeJson(batch);
    expect(stored.rows).toEqual([
      {
        receipt_json: null,
        receipt_canonical_json: text,
        receipt_canonical_sha256: createHash('sha256').update(text).digest('hex'),
      },
    ]);
    expect(await retainedBatch(batch.batchId)).toEqual(batch);
  });

  it('persists, reconciles, and replays a match metric through its exact represented-club appearance', async () => {
    let batch: AflTradeSourceFactBatch | undefined;
    for (let minute = 20; minute < 40 && !batch; minute++) {
      const source = laterBatch(replacement, minute);
      const appearance = source.content.facts.find(
        (fact) => fact.content.factKind === 'player_appearance'
      );
      const seasonMetric = source.content.facts.find(
        (fact) => fact.content.factKind === 'player_season_metric'
      );
      if (
        appearance?.content.factKind !== 'player_appearance' ||
        seasonMetric?.content.factKind !== 'player_season_metric'
      ) {
        throw new Error('The staged synthetic row requires its appearance and measured goals.');
      }
      const { seasonClubScope: _seasonClubScope, ...metricContent } = seasonMetric.content;
      const metric = createAflTradeSourceFact({
        ...metricContent,
        factKind: 'player_match_metric',
        source: {
          ...metricContent.source,
          candidateDigests: {
            ...metricContent.source.candidateDigests,
            match: appearance.content.source.candidateDigests.match,
          },
        },
        player: appearance.content.player,
        match: appearance.content.match,
        representedClub: appearance.content.representedClub,
        appearanceFactId: appearance.factId,
      });
      if (metric.factId >= appearance.factId) continue;
      const orderedFacts = source.content.facts
        .filter((fact) => fact.factId !== seasonMetric.factId)
        .concat(metric)
        .sort((left, right) => left.factId.localeCompare(right.factId));
      batch = createAflTradeSourceFactBatch({
        ...source.content,
        facts: orderedFacts,
        counts: { ...source.content.counts, playerSeasonMetrics: 0, playerMatchMetrics: 1 },
        rowAccounting: source.content.rowAccounting.map((row) => ({
          ...row,
          factIds: orderedFacts
            .filter((fact) => fact.content.source.providerDecodedRowId === row.providerDecodedRowId)
            .map((fact) => fact.factId),
        })),
      });
      expect(orderedFacts.indexOf(metric)).toBeLessThan(orderedFacts.indexOf(appearance));
    }
    if (!batch) throw new Error('No deterministic metric-before-appearance fixture was selected.');
    const matchMetric = batch.content.facts.find(
      (fact) => fact.content.factKind === 'player_match_metric'
    )!;
    if (matchMetric.content.factKind !== 'player_match_metric')
      throw new Error('Missing match metric');
    const transplantedAppearance = original.content.facts.find(
      (fact) => fact.content.factKind === 'player_appearance'
    )!;
    for (const appearanceFactId of [
      createAflTradeContentAddress('source-fact', { fixture: 'missing-appearance' }),
      transplantedAppearance.factId,
    ]) {
      expect(appearanceFactId).not.toBe(matchMetric.content.appearanceFactId);
      const invalidMetric = createAflTradeSourceFact({ ...matchMetric.content, appearanceFactId });
      const invalidFacts = batch.content.facts
        .map((fact) => (fact.factId === matchMetric.factId ? invalidMetric : fact))
        .sort((left, right) => left.factId.localeCompare(right.factId));
      // Recompute content addresses and row accounting so rejection identifies ancestry,
      // rather than a stale digest or a missing accounting member.
      expect(() =>
        createAflTradeSourceFactBatch({
          ...batch!.content,
          facts: invalidFacts,
          rowAccounting: batch!.content.rowAccounting.map((row) => ({
            ...row,
            factIds: invalidFacts
              .filter(
                (fact) => fact.content.source.providerDecodedRowId === row.providerDecodedRowId
              )
              .map((fact) => fact.factId),
          })),
        })
      ).toThrow(
        'A match-grain metric must reference the exact appearance fact for the same row, player, match, and represented club.'
      );
    }
    const immutableBytes = canonicalizeAflTradeJson(batch);
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
      batchId: batch.batchId,
      factCount: 3,
      idempotentReplay: false,
    });
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
      batchId: batch.batchId,
      factCount: 3,
      idempotentReplay: true,
    });
    expect(canonicalizeAflTradeJson(batch)).toBe(immutableBytes);
    expect(await retainedBatch(batch.batchId)).toEqual(batch);

    const storedPolicy = await pool.query<{
      policy_json: AflTradeFactualReconciliationPolicy['content'];
    }>('SELECT policy_json FROM outcome_factual_reconciliation_policy ORDER BY policy_id LIMIT 1');
    const approvalId = createAflTradeContentAddress('factual-reconciliation-policy-approval', {
      fixture: 'match-metric-represented-club-regression',
    });
    const policy = createAflTradeFactualReconciliationPolicy({
      ...storedPolicy.rows[0]!.policy_json,
      policyVersion: 'match-metric-represented-club-regression/v1',
      approval: { id: approvalId, sha256: approvalId.split(':')[1]! },
      sourceMetricRules: storedPolicy.rows[0]!.policy_json.sourceMetricRules.map((rule) => ({
        ...rule,
        grain: 'match' as const,
      })),
      createdAt: '2026-08-12T01:45:00.000Z',
    });
    await client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_nonproduction_factual_policy_reviewer');
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'factual_reconciliation_policy',$2,'approved',
          'Synthetic regression policy: resolve match goals through exact appearance ancestry',
          '{"environment":"non_production"}'::jsonb,'synthetic-regression-reviewer',
          '2026-08-12T01:44:00Z')`,
        [approvalId, policy.policyId]
      );
    });
    const reconciliation = new PostgresAflTradeFactualReconciliationRepository(client);
    await reconciliation.persistPolicy(policy, execution);
    const heads = await pool.query<{ subjectKey: string; revision: number }>(
      'SELECT subject_key AS "subjectKey",revision FROM outcome_reconciled_factual_metric_head'
    );
    const run = reconcileAflTradeFactualFacts({
      policy,
      sourceMemberships: batch.content.facts.map((fact) => ({
        factBatchId: batch.batchId,
        factBatchSha256: batch.batchSha256,
        fact,
      })),
      currentHeadRevisions: heads.rows,
      startedAt: '2026-08-12T01:46:00.000Z',
      completedAt: '2026-08-12T01:47:00.000Z',
    });
    const metric = batch.content.facts.find(
      (fact) => fact.content.factKind === 'player_match_metric'
    )!;
    const storedSource = await pool.query(
      `SELECT m.club_scope_kind,m.club_id,m.appearance_fact_id,a.represented_club_id
       FROM outcome_provider_numeric_metric_fact m
       JOIN outcome_provider_player_appearance_fact a USING(appearance_fact_id)
       WHERE m.metric_fact_id=$1`,
      [metric.factId]
    );
    expect(storedSource.rows[0]).toMatchObject({
      club_scope_kind: 'appearance_fact',
      club_id: null,
    });
    const goals = run.content.results.find((result) => result.content.metricCode === 'goals')!;
    expect(goals.content.clubScope).toEqual({
      kind: 'resolved_single_club',
      clubId: storedSource.rows[0]!.represented_club_id,
    });
    for (const mismatch of ['player', 'match', 'club'] as const) {
      let changedResults = 0;
      let attemptedMembers = 0;
      const invalidTransport: AflOutcomeSqlClient = {
        query: client.query.bind(client),
        transaction: (work) =>
          client.transaction(async (transaction) => {
            await transaction.query(`INSERT INTO outcome_player (player_id,display_name,status)
            VALUES ('afl-player:wrong-match-metric','Wrong metric player','approved')`);
            return work({
              query: (query, parameters) => {
                if (query.includes('INSERT INTO outcome_reconciled_factual_metric_member')) {
                  attemptedMembers++;
                }
                if (
                  !query.includes('INSERT INTO outcome_reconciled_factual_metric\n') ||
                  parameters?.[2] !== 'source_metric'
                )
                  return transaction.query(query, parameters);
                changedResults++;
                const changed = [...parameters];
                const content = JSON.parse(String(changed[21]));
                if (mismatch === 'player') {
                  changed[3] = content.playerId = 'afl-player:wrong-match-metric';
                } else if (mismatch === 'match') {
                  changed[7] = content.matchId = 'afl-match:wrong-match-metric';
                } else {
                  changed[5] = content.clubScope.clubId = 'afl-club:local-rehearsal-away';
                  expect(changed[5]).not.toBe(goals.content.clubScope.clubId);
                }
                // Alter only the fixture transport before insert; ordinary membership guards
                // must reject these otherwise consistent result projections and roll back.
                changed[21] = canonicalizeAflTradeJson(content);
                changed[20] = sha256AflTradeCanonicalJson(content);
                return transaction.query(query, changed);
              },
            });
          }),
      };
      await expect(
        new PostgresAflTradeFactualReconciliationRepository(invalidTransport).persistRun(
          run,
          execution
        )
      ).rejects.toThrow('Reconciled metric membership must reference an exact typed run input');
      expect(changedResults).toBe(1);
      expect(attemptedMembers).toBe(1);
      expect(
        (
          await pool.query(
            'SELECT 1 FROM outcome_factual_reconciliation_run WHERE factual_run_id=$1',
            [run.factualRunId]
          )
        ).rowCount
      ).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT subject_key AS "subjectKey",revision FROM outcome_reconciled_factual_metric_head'
          )
        ).rows
      ).toEqual(heads.rows);
    }
    await expect(reconciliation.persistRun(run, execution)).resolves.toMatchObject({
      factualRunId: run.factualRunId,
      idempotentReplay: false,
    });
    await expect(reconciliation.persistRun(run, execution)).resolves.toMatchObject({
      factualRunId: run.factualRunId,
      idempotentReplay: true,
    });
    const finalized = await pool.query(
      `SELECT status,finalized_at,source_fact_count,reconciled_fact_count,conflict_count
       FROM outcome_factual_reconciliation_run WHERE factual_run_id=$1`,
      [run.factualRunId]
    );
    expect(finalized.rows).toEqual([
      {
        status: 'approved',
        finalized_at: new Date(run.content.completedAt),
        source_fact_count: 3,
        reconciled_fact_count: 2,
        conflict_count: 0,
      },
    ]);
    expect(await retainedBatch(batch.batchId)).toEqual(batch);
  });

  it('replays a fully finalized legacy JSONB receipt through the current public owner', async () => {
    const batch = laterBatch(original, 7);
    let legacyInsertCount = 0;
    const legacyTransport: AflOutcomeSqlClient = {
      query: client.query.bind(client),
      transaction: (work) =>
        client.transaction(async (transaction) =>
          work({
            query: (query, parameters) => {
              if (!query.includes('INSERT INTO outcome_provider_fact_batch')) {
                return transaction.query(query, parameters);
              }
              // Fixture-only historical representation. No child write, currentness check,
              // finalization guard or replay path is replaced.
              const current = '$25,NULL,NULL,NULL,$26::text,$27';
              expect(query.split(current)).toHaveLength(2);
              expect(parameters).toHaveLength(27);
              legacyInsertCount++;
              return transaction.query(
                query.replace(current, '$25,NULL,NULL,$26::jsonb,NULL,NULL'),
                parameters!.slice(0, 26)
              );
            },
          })
        ),
    };
    await expect(
      new PostgresAflTradeFactualObservationRepository(legacyTransport).persistBatch(
        batch,
        execution
      )
    ).resolves.toMatchObject({ factCount: 3, idempotentReplay: false });
    expect(legacyInsertCount).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT receipt_json,receipt_canonical_json,receipt_canonical_sha256 FROM outcome_provider_fact_batch WHERE fact_batch_id=$1',
          [batch.batchId]
        )
      ).rows
    ).toEqual([
      { receipt_json: batch, receipt_canonical_json: null, receipt_canonical_sha256: null },
    ]);
    expect(await retainedBatch(batch.batchId)).toEqual(batch);
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
      batchId: batch.batchId,
      idempotentReplay: true,
    });
  });

  it('protects immutable batch fields while allowing only complete atomic finalization', async () => {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO outcome_provider_fact_batch
         SELECT (jsonb_populate_record(NULL::outcome_provider_fact_batch,
           to_jsonb(b) || jsonb_build_object('fact_batch_id','synthetic-open-guard',
             'extractor_version','synthetic-open-guard','status','staged',
             'completed_at',NULL,'finalized_at',NULL,'receipt_json','{}'::jsonb,
             'receipt_canonical_json',NULL,'receipt_canonical_sha256',NULL))).*
         FROM outcome_provider_fact_batch b WHERE fact_batch_id=$1`,
        [original.batchId]
      );
      await connection.query(
        `UPDATE outcome_provider_fact_batch SET status='needs_review',receipt_json='{"open":true}'
         WHERE fact_batch_id='synthetic-open-guard'`
      );
      await connection.query('SAVEPOINT before_rejected_mutation');
      await expect(
        connection.query(
          `UPDATE outcome_provider_fact_batch SET extractor_version='changed'
           WHERE fact_batch_id='synthetic-open-guard'`
        )
      ).rejects.toThrow('Only fact-batch finalization fields may change');
      await connection.query('ROLLBACK TO SAVEPOINT before_rejected_mutation');
      await expect(
        connection.query(
          `UPDATE outcome_provider_fact_batch SET status='approved',completed_at=started_at,
             finalized_at=started_at WHERE fact_batch_id='synthetic-open-guard'`
        )
      ).rejects.toThrow('Fact batch child counts do not match its receipt');
      await connection.query('ROLLBACK TO SAVEPOINT before_rejected_mutation');
      await expect(
        connection.query(
          'UPDATE outcome_provider_fact_batch SET receipt_json=$2::jsonb WHERE fact_batch_id=$1',
          [original.batchId, '{}']
        )
      ).rejects.toThrow('Finalized fact batches are append-only');
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
    await expect(facts.persistBatch(original, execution)).resolves.toMatchObject({
      batchId: original.batchId,
      idempotentReplay: true,
    });
  });

  it('rejects ambiguous or unauthenticated receipt representations before insertion', async () => {
    const connection = await pool.connect();
    const text = canonicalizeAflTradeJson(original);
    const hash = createHash('sha256').update(text).digest('hex');
    try {
      await connection.query('BEGIN');
      for (const [label, legacy, canonical, checksum] of [
        ['both', original, text, hash],
        ['neither', null, null, null],
        ['wrong_digest', null, text, '0'.repeat(64)],
      ] as const) {
        await connection.query('SAVEPOINT receipt_insert');
        await expect(
          connection.query(
            `INSERT INTO outcome_provider_fact_batch
           SELECT (jsonb_populate_record(NULL::outcome_provider_fact_batch,
             to_jsonb(b)||jsonb_build_object('fact_batch_id',$2::text,
               'extractor_version',$2::text,'status','staged','completed_at',NULL,'finalized_at',NULL,
               'receipt_json',$3::jsonb,'receipt_canonical_json',$4::text,
               'receipt_canonical_sha256',$5::text))).*
           FROM outcome_provider_fact_batch b WHERE fact_batch_id=$1`,
            [
              original.batchId,
              `synthetic-receipt-${label}`,
              legacy === null ? null : JSON.stringify(legacy),
              canonical,
              checksum,
            ]
          )
        ).rejects.toThrow();
        await connection.query('ROLLBACK TO SAVEPOINT receipt_insert');
      }
      expect(
        (
          await connection.query(
            "SELECT count(*)::integer AS count FROM outcome_provider_fact_batch WHERE fact_batch_id LIKE 'synthetic-receipt-%'"
          )
        ).rows
      ).toEqual([{ count: 0 }]);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it('keeps canonical receipt bytes and representation immutable before and after finalization', async () => {
    const connection = await pool.connect();
    const text = canonicalizeAflTradeJson(original);
    const hash = createHash('sha256').update(text).digest('hex');
    // Whitespace changes the exact stored bytes, not the parsed batch identity.
    const changedText = `${text}\n`;
    const changedHash = createHash('sha256').update(changedText).digest('hex');
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO outcome_provider_fact_batch
         SELECT (jsonb_populate_record(NULL::outcome_provider_fact_batch,
           to_jsonb(b)||jsonb_build_object('fact_batch_id','synthetic-open-text',
             'extractor_version','synthetic-open-text','status','staged','completed_at',NULL,
             'finalized_at',NULL,'receipt_json',NULL,'receipt_canonical_json',$2::text,
             'receipt_canonical_sha256',$3::text))).*
         FROM outcome_provider_fact_batch b WHERE fact_batch_id=$1`,
        [original.batchId, text, hash]
      );
      await connection.query(
        "UPDATE outcome_provider_fact_batch SET status='needs_review' WHERE fact_batch_id='synthetic-open-text'"
      );
      for (const batchId of ['synthetic-open-text', original.batchId]) {
        for (const [clause, parameters] of [
          ['receipt_canonical_json=$2,receipt_canonical_sha256=$3', [changedText, changedHash]],
          ['receipt_canonical_sha256=$2', ['0'.repeat(64)]],
          [
            'receipt_json=$2::jsonb,receipt_canonical_json=NULL,receipt_canonical_sha256=NULL',
            [text],
          ],
        ] as const) {
          await connection.query('SAVEPOINT receipt_mutation');
          await expect(
            connection.query(
              `UPDATE outcome_provider_fact_batch SET ${clause} WHERE fact_batch_id=$1`,
              [batchId, ...parameters]
            )
          ).rejects.toThrow();
          await connection.query('ROLLBACK TO SAVEPOINT receipt_mutation');
        }
      }
      await connection.query('SAVEPOINT text_finalization');
      await expect(
        connection.query(
          `UPDATE outcome_provider_fact_batch SET status='approved',completed_at=started_at,
           finalized_at=started_at WHERE fact_batch_id='synthetic-open-text'`
        )
      ).rejects.toThrow('Fact batch child counts do not match its receipt');
      await connection.query('ROLLBACK TO SAVEPOINT text_finalization');
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
    expect(await retainedBatch(original.batchId)).toEqual(original);
    await expect(facts.persistBatch(original, execution)).resolves.toMatchObject({
      idempotentReplay: true,
    });
  });

  it('refuses a contended assignment review without partially publishing, then permits retry', async () => {
    const appearance = replacement.content.facts.find(
      (fact) => fact.content.factKind === 'player_appearance'
    );
    if (appearance?.content.factKind !== 'player_appearance') throw new Error('Missing appearance');
    const contender = await pool.connect();
    const batch = laterBatch(original, 2);
    try {
      await contender.query('BEGIN');
      await contender.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_resolution_case:'||$1::text,0))",
        [appearance.content.player.resolutionCaseId]
      );
      await expect(facts.persistBatch(batch, execution)).rejects.toThrow(/current|resolution/i);
      await contender.query('ROLLBACK');
      await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
        idempotentReplay: false,
        factCount: 3,
        publicationEligible: false,
      });
    } finally {
      await contender.query('ROLLBACK');
      contender.release();
    }
  });

  it('persists an occurrence-only player with no reusable identity and refuses its withdrawal', async () => {
    const appearance = replacement.content.facts.find(
      (fact) => fact.content.factKind === 'player_appearance'
    );
    if (appearance?.content.factKind !== 'player_appearance') throw new Error('Missing appearance');
    const retained = await pool.query<{ decision_json: unknown }>(
      'SELECT decision_json FROM outcome_provider_player_resolution WHERE decision_id=$1',
      [appearance.content.player.decision.id]
    );
    const previous = aflTradeProviderResolutionDecisionSchema.parse(
      retained.rows[0]?.decision_json
    );
    const context = { ...execution, principalRef: previous.content.reviewerAuthority.principalRef };
    const withdrawal = createAflTradeProviderResolutionDecision({
      ...previous.content,
      expectedRevision: previous.content.expectedRevision + 1,
      supersedesDecisionId: previous.decisionId,
      assignmentRevision: {
        ...previous.content.assignmentRevision!,
        expectedRevision: previous.content.assignmentRevision!.expectedRevision + 1,
        supersedesDecisionId: previous.decisionId,
        nextStatus: 'inactive',
      },
      outcome: 'rejected',
      rationale: 'Synthetic administrative withdrawal before an occurrence-only mapping.',
    });
    await resolutions.persistDecision(withdrawal, context);
    const policy = await retainSyntheticOccurrencePolicy(
      appearance.content.player.identityCandidateId
    );
    const proposalContent = previous.content.proposal.content;
    if (proposalContent.subjectType !== 'provider_player_candidate')
      throw new Error('Not a player');
    const occurrence = createAflTradeProviderResolutionDecision({
      ...previous.content,
      proposal: createAflTradeProviderResolutionProposal({
        ...proposalContent,
        staging: { ...proposalContent.staging, nativeIdNamespace: null },
        proposedTarget: {
          scope: 'candidate_only',
          playerId: appearance.content.player.playerId,
          evidencePolicy: policy,
        },
      }),
      expectedRevision: withdrawal.content.expectedRevision + 1,
      supersedesDecisionId: withdrawal.decisionId,
      assignmentRevision: null,
    });
    await resolutions.persistDecision(occurrence, context);
    const player = {
      ...appearance.content.player,
      mappingScope: 'candidate_only' as const,
      revision: occurrence.content.expectedRevision + 1,
      decision: { id: occurrence.decisionId, sha256: occurrence.decisionSha256 },
      playerIdentityId: null,
      assignment: null,
    };
    const changed = {
      ...replacement,
      content: {
        ...replacement.content,
        facts: replacement.content.facts.map((fact) =>
          'player' in fact.content ? createAflTradeSourceFact({ ...fact.content, player }) : fact
        ),
      },
    };
    const batch = laterBatch(changed, 3);
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({ factCount: 3 });
    await expect(facts.persistBatch(batch, execution)).resolves.toMatchObject({
      idempotentReplay: true,
    });
    const contendedBatch = laterBatch(changed, 4);
    const hpnCurrent = async () => {
      const result = await pool.query<{ current: boolean }>(
        'SELECT outcome_hpn_pav_player_resolution_current($1,$2::jsonb) AS current',
        [
          appearance.content.source.providerDecodedRowId,
          canonicalizeAflTradeJson({
            entityKind: 'player',
            canonicalId: player.playerId,
            revision: player.revision,
            status: 'current_approved',
            resolutionScope: 'candidate_only',
            resolutionDecision: player.decision,
            assignmentDecision: null,
          }),
        ]
      );
      return result.rows[0]?.current;
    };
    expect(await hpnCurrent()).toBe(true);
    await client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE "${readerRole}"`);
      const result = await transaction.query<{ current: boolean; can_update: boolean }>(
        `SELECT outcome_provider_candidate_only_player_resolution_current($1) AS current,
          has_table_privilege(current_user,'outcome_provider_player_resolution_head','UPDATE') AS can_update`,
        [occurrence.decisionId]
      );
      expect(result.rows).toEqual([{ current: true, can_update: false }]);
    });
    const contender = await pool.connect();
    try {
      await contender.query('BEGIN');
      await contender.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_resolution_case:'||$1::text,0))",
        [player.resolutionCaseId]
      );
      await expect(facts.persistBatch(contendedBatch, execution)).rejects.toThrow(
        /current|resolution/i
      );
      expect(await hpnCurrent()).toBe(false);
      await contender.query('ROLLBACK');
      await expect(facts.persistBatch(contendedBatch, execution)).resolves.toMatchObject({
        idempotentReplay: false,
      });
      expect(await hpnCurrent()).toBe(true);
    } finally {
      await contender.query('ROLLBACK');
      contender.release();
    }
    await resolutions.persistDecision(
      createAflTradeProviderResolutionDecision({
        ...occurrence.content,
        expectedRevision: occurrence.content.expectedRevision + 1,
        supersedesDecisionId: occurrence.decisionId,
        outcome: 'rejected',
        rationale: 'Synthetic withdrawal must prevent new factual promotion of this occurrence.',
      }),
      context
    );
    await expect(facts.persistBatch(laterBatch(changed, 5), execution)).rejects.toThrow(
      /current|resolution/i
    );
    await expect(facts.persistBatch(laterBatch(original, 6), execution)).rejects.toThrow(
      /current|resolution/i
    );
  });
});
