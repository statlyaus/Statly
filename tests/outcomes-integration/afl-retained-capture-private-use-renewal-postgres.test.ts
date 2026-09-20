import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeContentAddress as address } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createRetainedFitzRoyPrivateUseRenewal } from '@/server/aflTradeIntelligence/source/retainedFitzRoyPrivateUseRenewal';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_retained_renewal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);
const options = { profile: 'completed_match_result' as const };
const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
const original = {
  sourceRights: fixture.command.capture.sourceRights,
  proposal: fixture.command.capture.ledger.proposals[0]!,
  decision: fixture.command.capture.ledger.decisions[0]!,
};
let captureId: string;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [original],
  });
  captureId = (await stageLocalAflTradeFitzRoyFixture(client, options)).staging.capture.captureId;
});

it.each([
  'another_capture',
  'training_upgrade',
  'field_identity_change',
  'missing_anchor',
  'overlong_window',
  'expired',
  'longer_chain',
  'dropped_limitation',
] as const)('refuses a %s renewal through the same private-use boundary', async (fault) => {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const scoped: AflOutcomeSqlClient = {
      query: async <Row>(sql: string, parameters?: readonly unknown[]) => {
        const result = await connection.query(sql, parameters as unknown[]);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      },
      transaction: (callback) => callback(scoped),
    };
    const now = (
      await scoped.query<{ at: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
      )
    ).rows[0]!.at;
    const renewedAt =
      fault === 'expired' ? new Date(Date.parse(now) - 86400000).toISOString() : now;
    const renewal = createRetainedFitzRoyPrivateUseRenewal({
      ...original,
      captureId: fault === 'another_capture' ? `source-capture:${'e'.repeat(64)}` : captureId,
      renewedAt,
      accountableOwner: 'synthetic-renewal-owner',
      authorityEvidenceId: `artifact:${'a'.repeat(64)}`,
      reviewer: {
        id: 'synthetic-agent-reviewer',
        role: 'source-control-review',
        evidenceId: `artifact:${'b'.repeat(64)}`,
      },
    });
    // Readdress adversarial documents through the normal append-only ledger. No guard is disabled.
    const rightsContent = structuredClone(renewal.sourceRights.content);
    if (fault === 'training_upgrade') rightsContent.operations.model_training = 'allowed';
    if (fault === 'field_identity_change') rightsContent.fields[0]!.notes += ' altered semantics';
    if (fault === 'overlong_window')
      rightsContent.termsExpireAt = new Date(Date.parse(now) + 31 * 86400000).toISOString();
    if (fault === 'expired')
      rightsContent.termsExpireAt = new Date(Date.parse(now) - 60000).toISOString();
    const sourceRights = {
      content: rightsContent,
      rightsArtifactId: address('source-rights', rightsContent),
    };
    const proposalContent = structuredClone(renewal.proposal.content);
    proposalContent.scope.dimensions = proposalContent.scope.dimensions
      .filter((d) => fault !== 'missing_anchor' || d.name !== 'original_gate_decision')
      .map((d) =>
        d.name === 'source_rights_artifact' ? { ...d, values: [sourceRights.rightsArtifactId] } : d
      );
    proposalContent.affectedArtifacts = [
      { kind: 'source_rights', artifactId: sourceRights.rightsArtifactId },
    ];
    const proposal = {
      content: proposalContent,
      proposalId: address('gate-proposal', proposalContent),
    };
    const decisionContent = {
      ...renewal.decision.content,
      proposalId: proposal.proposalId,
      scope: proposalContent.scope,
      affectedArtifacts: proposalContent.affectedArtifacts,
      revalidateAt: rightsContent.termsExpireAt,
    };
    if (fault === 'dropped_limitation') {
      expect(original.decision.content.limitations.length).toBeGreaterThan(0);
      decisionContent.limitations = renewal.decision.content.limitations.filter(
        (value) => !original.decision.content.limitations.includes(value)
      );
    }
    const decision = {
      content: decisionContent,
      decisionId: address('gate-decision', decisionContent),
    };
    const ledger = createPostgresAflTradeGateDecisionLedgerRepository(scoped);
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [{ sourceRights, proposal, decision }],
    });
    if (fault === 'longer_chain') {
      const laterProposalContent = { ...proposal.content, version: proposal.content.version + 1 };
      const laterProposal = {
        content: laterProposalContent,
        proposalId: address('gate-proposal', laterProposalContent),
      };
      const laterContent = {
        ...decision.content,
        version: decision.content.version + 1,
        supersedesDecisionId: decision.decisionId,
        proposalId: laterProposal.proposalId,
      };
      const laterDecision = {
        content: laterContent,
        decisionId: address('gate-decision', laterContent),
      };
      await ledger.appendBatch({
        expectedRevision: (await ledger.load()).revision,
        records: [{ sourceRights, proposal: laterProposal, decision: laterDecision }],
      });
    }
    await scoped.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    await expect(
      scoped.query('SELECT require_outcome_private_hpn_source_fields($1,$2::jsonb)', [
        captureId,
        JSON.stringify(['home_points', 'away_points']),
      ])
    ).rejects.toThrow('Source-first factual source rights are no longer current');
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
});

it('keeps the exact Cameron 2020 successor closed to other retained captures', async () => {
  const result = await client.query<{ permitted: boolean }>(
    `SELECT outcome_hpn_cameron_2020_retained_use_is_current(
       $1,$2::jsonb,clock_timestamp()) AS permitted`,
    [captureId, JSON.stringify(['home_points', 'away_points'])]
  );
  expect(result.rows).toEqual([{ permitted: false }]);
});

// Synthetic bytes/reviews only. Real ledger, source-capture and private-use guards remain enabled.
it('permits only the explicitly renewed retained capture without rewriting its original manifest', async () => {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const scoped: AflOutcomeSqlClient = {
      query: async <Row>(sql: string, parameters?: readonly unknown[]) => {
        const result = await connection.query(sql, parameters as unknown[]);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      },
      transaction: (callback) => callback(scoped),
    };
    const before = (
      await scoped.query('SELECT manifest_json FROM outcome_source_capture WHERE capture_id=$1', [
        captureId,
      ])
    ).rows[0];
    const renewedAt = (
      await scoped.query<{ at: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
      )
    ).rows[0]!.at;
    const renewal = createRetainedFitzRoyPrivateUseRenewal({
      ...original,
      captureId,
      renewedAt,
      accountableOwner: 'synthetic-renewal-owner',
      authorityEvidenceId: `artifact:${'a'.repeat(64)}`,
      reviewer: {
        id: 'synthetic-agent-reviewer',
        role: 'source-control-review',
        evidenceId: `artifact:${'b'.repeat(64)}`,
      },
    });
    const ledger = createPostgresAflTradeGateDecisionLedgerRepository(scoped);
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [renewal],
    });
    await scoped.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    await expect(
      scoped.query('SELECT require_outcome_private_hpn_source_fields($1,$2::jsonb)', [
        captureId,
        JSON.stringify(['home_points', 'away_points']),
      ])
    ).resolves.toBeDefined();
    await scoped.query('RESET ROLE');
    expect(
      (
        await scoped.query('SELECT manifest_json FROM outcome_source_capture WHERE capture_id=$1', [
          captureId,
        ])
      ).rows[0]
    ).toEqual(before);
    await scoped.query('SAVEPOINT unavailable_source');
    await expect(
      scoped.query('SELECT require_outcome_private_hpn_source_fields($1,$2::jsonb)', [
        `source-capture:${'f'.repeat(64)}`,
        JSON.stringify(['home_points']),
      ])
    ).rejects.toThrow();
    await scoped.query('ROLLBACK TO SAVEPOINT unavailable_source');
    await scoped.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    await expect(
      scoped.query('SELECT require_outcome_private_hpn_source_fields($1,$2::jsonb)', [
        captureId,
        JSON.stringify(['unreviewed_field']),
      ])
    ).rejects.toThrow('Source-first factual source rights are no longer current');
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
});
