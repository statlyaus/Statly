import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createLocalAflTradePrivateValuationQualificationRegistrar } from '@/server/aflTradeIntelligence/development/localPrivateValuationQualification';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradePrivateValuationModelOperation } from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';
import { createGovernedValuationModelQualificationPolicy } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';
import { PostgresGovernedValuationModelQualificationRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationModelQualificationRepository';
import { seedGovernedQualificationComponentRuns } from '../testUtils/governedQualificationComponentRunsFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Disposable AFL_OUTCOMES_TEST_DATABASE_URL required.');
const schemaName = `afl_local_qualification_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const artifactRoot = mkdtempSync(join(tmpdir(), 'statly-qualification-artifacts-'));
const artifacts = createLocalAflTradePrivateDerivedArtifactRepository({
  rootDirectory: artifactRoot,
  repositoryId: 'synthetic-qualification-test',
  maximumObjectBytes: 1024 * 1024,
});
const client = createPgAflOutcomeSqlClient(pool);
const retainedAt = '2026-08-21T08:00:00.000Z';

async function retain(document: unknown, createdAt = retainedAt) {
  const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
  await artifacts.putIfAbsent(
    reference,
    new TextEncoder().encode(canonicalizeAflTradeJson(document))
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody
    (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
     environment,created_at,verified_at,custody_json)
    VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$6,'{}')
    ON CONFLICT (artifact_id) DO NOTHING`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
    ]
  );
  return reference;
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
  rmSync(artifactRoot, { recursive: true, force: true });
});

function policy(minimumImprovement = 0.05) {
  return createGovernedValuationModelQualificationPolicy({
    player: {
      schemaVersion: 'governed-player-model-qualification-criteria/v1',
      minimumComparableObservations: 100,
      minimumRelativeMaeImprovement: minimumImprovement,
      minimumRelativeRmseImprovement: 0.05,
      requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds',
    },
    pick: {
      schemaVersion: 'governed-pick-model-qualification-criteria/v1',
      evaluatedScope: 'final_test',
      minimumObservations: 1,
      maximumMulticlassBrierScore: 0.7,
      maximumMulticlassLogLoss: 2,
      maximumRankedProbabilityScore: 0.35,
      maximumContributionCrps: 25,
      maximumMeanAbsoluteContributionError: 30,
      maximumRootMeanSquaredContributionError: 40,
      maximumMeanAbsoluteGamesError: 35,
      maximumRootMeanSquaredGamesError: 45,
      minimumEmpiricalP10P90Coverage: 0.7,
      maximumEmpiricalP10P90Coverage: 1,
      maximumMeanEmpiricalIntervalWidth: 80,
      maximumZeroProbabilityObservationCount: 0,
    },
  });
}

// Isolate upstream dispatch/admission setup; all qualification, native readback,
// automatic Gate 3 and model-operation claim binding remain real database behavior.
let retainedRuns: ReturnType<typeof seedGovernedQualificationComponentRuns> | undefined;
async function executionFixture(suffix = 'passing', minimumImprovement = 0.05, modelId?: string) {
  retainedRuns ??= seedGovernedQualificationComponentRuns({
    pool,
    artifacts,
    retain,
    retainedAt,
  });
  const runs = await retainedRuns;
  const selectedPolicy = policy(minimumImprovement);
  const policyArtifact = await retain(selectedPolicy);
  const operation = createAflTradePrivateValuationModelOperation({
    scopeKey: 'afl-men:2025-trades',
    factualValuesSha256: 'a'.repeat(64),
    hpnValuesSha256: 'b'.repeat(64),
    hpnMethodId: createAflTradeContentAddress('hpn-pav-method', 'local-qualification'),
    player: {
      modelId: modelId ?? runs.playerNativeExecution.content.modelId,
      modelVersion: runs.playerNativeExecution.content.modelVersion,
      protocolId: runs.player.content.protocolId,
      datasetId: runs.player.content.datasetId,
      datasetAdmissionId: runs.player.content.datasetAdmissionId,
    },
    pick: {
      protocolId: runs.pick.content.protocolId,
      datasetId: runs.pick.content.datasetId,
      datasetAdmissionId: runs.pick.content.datasetAdmissionId,
      policyId: runs.pickNativeExecution.content.policyId,
    },
    qualificationPolicyId: selectedPolicy.policyVersion,
  });
  const requestId = createAflTradeContentAddress(
    'private-valuation-dispatch',
    `local-qualification-${suffix}`
  );
  const claimId = createAflTradeContentAddress(
    'private-valuation-dispatch-claim',
    `local-qualification-${suffix}`
  );
  const leaseToken = 'c'.repeat(64);
  const leaseDigest = createHash('sha256').update(leaseToken).digest('hex');
  const factualOutputId = createAflTradeContentAddress(
    'private-valuation-factual-output',
    'local-qualification'
  );
  const hpnCalculationId = createAflTradeContentAddress('hpn-pav-season', 'local-qualification');
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL session_replication_role='replica'`);
    await seed.query(
      `INSERT INTO outcome_private_valuation_dispatch_request
      (request_id,scope_key,trigger_kind,scheduled_for,authority_key,status,available_at,
       claim_id,lease_token_sha256,lease_expires_at,claimed_at,request_json,claim_sequence)
      VALUES ($1,$2,'ad_hoc',now(),$1,'claimed',now(),$3,$4,
        now()+interval '10 minutes',now(),'{}',1)`,
      [requestId, operation.content.scopeKey, claimId, leaseDigest]
    );
    await seed.query(
      `INSERT INTO outcome_private_valuation_dispatch_attempt
      (claim_id,request_id,attempt_sequence,attempt_number,worker_id,lease_token_sha256,
       claimed_at,lease_expires_at,heartbeat_at)
      VALUES ($1,$2,1,1,'system:weekly-valuation-coordinator',$3,now(),now()+interval '10 minutes',now())`,
      [claimId, requestId, leaseDigest]
    );
    const c = operation.content;
    await seed.query(
      `INSERT INTO outcome_private_valuation_model_operation
      (operation_id,scope_key,factual_values_sha256,hpn_values_sha256,hpn_method_id,
       player_model_id,player_model_version,player_protocol_id,player_dataset_id,player_dataset_admission_id,
       pick_protocol_id,pick_dataset_id,pick_dataset_admission_id,pick_policy_id,qualification_policy_id,
       player_run_id,player_claim_id,player_attempt_number,player_accepted_at,
       pick_run_id,pick_claim_id,pick_attempt_number,pick_accepted_at,pair_accepted_at,
       operation_canonical_json,operation_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,now(),$18,$17,1,now(),now(),$19,$20::jsonb)`,
      [
        operation.operationId,
        c.scopeKey,
        c.factualValuesSha256,
        c.hpnValuesSha256,
        c.hpnMethodId,
        c.player.modelId,
        c.player.modelVersion,
        c.player.protocolId,
        c.player.datasetId,
        c.player.datasetAdmissionId,
        c.pick.protocolId,
        c.pick.datasetId,
        c.pick.datasetAdmissionId,
        c.pick.policyId,
        c.qualificationPolicyId,
        runs.player.runId,
        claimId,
        runs.pick.runId,
        canonicalizeAflTradeJson(c),
        canonicalizeAflTradeJson(operation),
      ]
    );
    await seed.query(
      `INSERT INTO outcome_private_valuation_model_request_binding
      (request_id,operation_id,factual_output_id,hpn_calculation_id,claim_id,attempt_number)
      VALUES ($1,$2,$3,$4,$5,1)`,
      [requestId, operation.operationId, factualOutputId, hpnCalculationId, claimId]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
  const { schemaVersion: _schemaVersion, scopeKey, ...substantive } = operation.content;
  return {
    policyArtifact,
    execution: {
      operation,
      playerRunId: runs.player.runId,
      pickRunId: runs.pick.runId,
      claim: { claimId, leaseToken },
      exactInput: { requestId, scopeKey, factualOutputId, hpnCalculationId, substantive },
    },
  };
}

describe('local retained qualification registrar', () => {
  it('derives a qualified pair from exact native reports and publishes only automated private gates', async () => {
    const fixture = await executionFixture();
    const registrar = createLocalAflTradePrivateValuationQualificationRegistrar({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
      policyArtifactId: fixture.policyArtifact.artifactId,
    });
    const result = await registrar.register(fixture.execution);
    expect(result).toMatchObject({ outcome: 'qualified' });
    const repository = new PostgresGovernedValuationModelQualificationRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });
    expect(await repository.loadCurrent('afl-men:2025-trades')).toMatchObject({
      playerRunId: fixture.execution.playerRunId,
      pickRunId: fixture.execution.pickRunId,
    });
    expect(await registrar.register(fixture.execution)).toEqual(result);
    const ledger = await createPostgresAflTradeGateDecisionLedgerRepository(client).load();
    expect(ledger.ledger.decisions).toHaveLength(2);
    for (const { content } of ledger.ledger.decisions) {
      expect(content).toMatchObject({
        authorityKind: 'automated_validation_record',
        reviewers: [],
        accountableOwner: 'system:weekly-valuation-coordinator',
        decidedBy: 'system:weekly-valuation-coordinator',
      });
    }
    const corruptReadback = createLocalAflTradePrivateValuationQualificationRegistrar({
      client,
      artifactRepository: {
        ...artifacts,
        async loadExact(reference, maximumBytes) {
          const loaded = await artifacts.loadExact(reference, maximumBytes);
          return loaded !== null && reference.artifactId === fixture.policyArtifact.artifactId
            ? { ...loaded, bytes: new TextEncoder().encode('{}') }
            : loaded;
        },
      },
      maximumArtifactBytes: 1024 * 1024,
      policyArtifactId: fixture.policyArtifact.artifactId,
    });
    expect(await corruptReadback.register(fixture.execution)).toMatchObject({
      state: 'deterministic_failure',
      reason: expect.stringContaining('immutable readback'),
    });
    const wrongPolicy = await retain(policy(0.1));
    const wrongRegistrar = createLocalAflTradePrivateValuationQualificationRegistrar({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
      policyArtifactId: wrongPolicy.artifactId,
    });
    expect(await wrongRegistrar.register(fixture.execution)).toMatchObject({
      state: 'deterministic_failure',
      reason: expect.stringContaining('policy does not match'),
    });
    expect(
      await registrar.register({
        ...fixture.execution,
        claim: {
          ...fixture.execution.claim,
          leaseToken: 'd'.repeat(64),
        },
      })
    ).toMatchObject({ state: 'stale_authority' });
    const previous = ledger.ledger.decisions[0]!;
    const previousProposal = ledger.ledger.proposals.find(
      ({ proposalId }) => proposalId === previous.content.proposalId
    )!;
    const changedAt = new Date().toISOString();
    const proposalContent = { ...previousProposal.content, version: 2, proposedAt: changedAt };
    const proposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const decisionContent = {
      ...previous.content,
      proposalId: proposal.proposalId,
      version: 2,
      authorityKind: 'external_human_record' as const,
      state: 'withdrawn' as const,
      withdrawalActions: ['Synthetic test withdrawal: stop model-pair replay.'],
      decidedAt: changedAt,
      effectiveAt: changedAt,
      supersedesDecisionId: previous.decisionId,
    };
    const decision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
      content: decisionContent,
    });
    await createPostgresAflTradeGateDecisionLedgerRepository(client).appendDecision({
      expectedRevision: ledger.revision,
      proposal,
      decision,
    });
    expect(await registrar.register(fixture.execution)).toMatchObject({
      state: 'stale_authority',
      reason: expect.stringContaining('Gate'),
    });
  });

  it('retains actual threshold failure without advancing the current pair', async () => {
    const fixture = await executionFixture('failing', 0.1);
    const repository = new PostgresGovernedValuationModelQualificationRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });
    const before = await repository.loadCurrent('afl-men:2025-trades');
    const registrar = createLocalAflTradePrivateValuationQualificationRegistrar({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
      policyArtifactId: fixture.policyArtifact.artifactId,
    });
    expect(await registrar.register(fixture.execution)).toMatchObject({ outcome: 'failed' });
    expect(await repository.loadCurrent('afl-men:2025-trades')).toEqual(before);
  });

  it('rejects retained reports for a different accepted model identity', async () => {
    const fixture = await executionFixture('wrong-model', 0.05, 'unrelated-player-model');
    const registrar = createLocalAflTradePrivateValuationQualificationRegistrar({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
      policyArtifactId: fixture.policyArtifact.artifactId,
    });
    expect(await registrar.register(fixture.execution)).toMatchObject({
      state: 'deterministic_failure',
      reason: expect.stringContaining('native model'),
    });
  });
});
