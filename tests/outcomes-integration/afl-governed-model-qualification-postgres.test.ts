import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createGovernedValuationModelQualification,
  createGovernedValuationModelQualificationGateRecords,
  createGovernedValuationModelQualificationPolicy,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';
import {
  GovernedValuationModelQualificationRepositoryError,
  PostgresGovernedValuationModelQualificationRepository,
} from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationModelQualificationRepository';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_governed_model_qualification_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
const retainedAt = '2026-08-21T08:00:00.000Z';
const evaluatedAt = '2026-08-21T09:00:00.000Z';
const authorityAt = '2026-08-21T09:05:00.000Z';

function scopedDatabaseUrl(targetSchema: string) {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', targetSchema);
  return scoped.toString();
}

async function retain(document: unknown, createdAt = retainedAt) {
  const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(document));
  await artifacts.putIfAbsent(reference, bytes);
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,$7::jsonb)
     ON CONFLICT (artifact_id) DO NOTHING`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
      canonicalizeAflTradeJson({ assurance: 'disposable_model_qualification_test' }),
    ]
  );
  return reference;
}

async function retainWithMetadata(
  document: unknown,
  overrides: Partial<Pick<Awaited<ReturnType<typeof retain>>, 'mediaType' | 'createdAt'>>
) {
  const canonicalReference = createAflTradeCanonicalJsonArtifactRef(
    document,
    overrides.createdAt ?? retainedAt
  );
  const reference = { ...canonicalReference, ...overrides };
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,$7::jsonb)`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
      canonicalizeAflTradeJson({ assurance: 'disposable_metadata_mismatch_test' }),
    ]
  );
  return reference;
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(schemaName),
  });
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

async function componentRuns() {
  const repository = new PostgresGovernedValuationComponentRunRepository({
    client: createPgAflOutcomeSqlClient(pool),
    artifactRepository: artifacts,
    maximumArtifactBytes: 1024 * 1024,
  });
  const common = async (label: string) => ({
    environment: 'non_production' as const,
    protocolId: `model-protocol:${label.repeat(64)}`,
    protocolArtifact: await retain({ kind: 'protocol', label }),
    datasetId: `dataset:${label.repeat(64)}`,
    datasetArtifact: await retain({ kind: 'dataset', label }),
    datasetAdmissionId: `dataset-admission:${label.repeat(64)}`,
    datasetAdmissionArtifact: await retain({ kind: 'admission', label }),
    datasetAdmissionGateLedgerRevision: 1,
    registeredAt: retainedAt,
  });
  const player = createGovernedValuationComponentRunManifest({
    ...(await common('a')),
    role: 'player_contribution_and_availability',
    nativeExecution: {
      kind: 'admitted_player_model_run',
      executionId: `model-run:${'c'.repeat(64)}`,
      artifact: await retain({ kind: 'native-player-run' }),
    },
  });
  const pick = createGovernedValuationComponentRunManifest({
    ...(await common('b')),
    role: 'draft_pick_and_future_pick_distribution',
    nativeExecution: {
      kind: 'governed_pick_pav_model_execution',
      executionId: `pick-pav-model-execution:${'d'.repeat(64)}`,
      artifact: await retain({ kind: 'native-pick-run' }),
    },
  });
  const playerArtifact = await retain(player);
  const pickArtifact = await retain(pick);
  await repository.register({ manifest: player, artifact: playerArtifact });
  await repository.register({ manifest: pick, artifact: pickArtifact });
  return { player, playerArtifact, pick, pickArtifact };
}

async function qualificationFixture(
  runs: Awaited<ReturnType<typeof componentRuns>>,
  suffix: string,
  passing: boolean
) {
  const policy = createGovernedValuationModelQualificationPolicy({
    player: {
      schemaVersion: 'governed-player-model-qualification-criteria/v1' as const,
      minimumComparableObservations: 100,
      minimumRelativeMaeImprovement: 0.05,
      minimumRelativeRmseImprovement: 0.05,
      requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    },
    pick: {
      schemaVersion: 'governed-pick-model-qualification-criteria/v1' as const,
      evaluatedScope: 'final_test' as const,
      minimumObservations: 30,
      maximumMulticlassBrierScore: 0.7,
      maximumMulticlassLogLoss: 2,
      maximumRankedProbabilityScore: 0.35,
      maximumContributionCrps: 25,
      maximumMeanAbsoluteContributionError: 30,
      maximumRootMeanSquaredContributionError: 40,
      maximumMeanAbsoluteGamesError: 35,
      maximumRootMeanSquaredGamesError: 45,
      minimumEmpiricalP10P90Coverage: 0.7,
      maximumEmpiricalP10P90Coverage: 0.9,
      maximumMeanEmpiricalIntervalWidth: 80,
      maximumZeroProbabilityObservationCount: 0,
    },
  });
  const playerEvidence = {
    schemaVersion: 'governed-player-model-qualification-evidence/v1' as const,
    validationReportId: createAflTradeContentAddress(
      'player-validation-report',
      `player-${suffix}`
    ),
    comparableObservationCount: 120,
    acceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    relativeMaeImprovement: passing ? 0.08 : 0.01,
    relativeRmseImprovement: 0.07,
  };
  const pickEvidence = {
    schemaVersion: 'governed-pick-model-qualification-evidence/v1' as const,
    validationReportId: createAflTradeContentAddress(
      'pick-pav-validation-report',
      `pick-${suffix}`
    ),
    evaluationStatus: 'scored_not_approved' as const,
    scope: 'final_test' as const,
    observationCount: 40,
    metrics: {
      multiclassBrierScore: 0.4,
      multiclassLogLoss: 1.2,
      rankedProbabilityScore: 0.2,
      contributionCrps: 18,
      meanAbsoluteContributionError: 22,
      rootMeanSquaredContributionError: 31,
      meanAbsoluteGamesError: 24,
      rootMeanSquaredGamesError: 34,
      empiricalP10P90Coverage: 0.8,
      meanEmpiricalIntervalWidth: 60,
      zeroProbabilityObservationCount: 0,
    },
  };
  const qualification = createGovernedValuationModelQualification({
    environment: 'non_production',
    scopeKey: 'afl-men:2026-trades',
    evaluatedAt,
    policy,
    policyArtifact: await retain(policy, evaluatedAt),
    components: {
      player: {
        role: runs.player.content.role,
        runId: runs.player.runId,
        runArtifact: runs.playerArtifact,
        protocolId: runs.player.content.protocolId,
        protocolArtifact: runs.player.content.protocolArtifact,
        criteriaArtifact: await retain(policy.player, evaluatedAt),
        validationEvidence: playerEvidence,
        validationEvidenceArtifact: await retain(playerEvidence, evaluatedAt),
      },
      pick: {
        role: runs.pick.content.role,
        runId: runs.pick.runId,
        runArtifact: runs.pickArtifact,
        protocolId: runs.pick.content.protocolId,
        protocolArtifact: runs.pick.content.protocolArtifact,
        criteriaArtifact: await retain(policy.pick, evaluatedAt),
        validationEvidence: pickEvidence,
        validationEvidenceArtifact: await retain(pickEvidence, evaluatedAt),
      },
    },
  });
  const qualificationArtifact = await retain(qualification, evaluatedAt);
  return { qualification, qualificationArtifact };
}

async function insertQualificationDirectly(
  qualification: Awaited<ReturnType<typeof qualificationFixture>>['qualification'],
  artifactId: string
) {
  const content = qualification.content;
  return pool.query(
    `INSERT INTO outcome_governed_valuation_model_qualification
      (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
       policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
       player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,content_sha256,
       content_canonical_json,qualification_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      qualification.qualificationId,
      content.scopeKey,
      content.outcome,
      artifactId,
      content.player.runId,
      content.pick.runId,
      content.policyArtifact.artifactId,
      content.player.criteriaArtifact.artifactId,
      content.pick.criteriaArtifact.artifactId,
      content.player.validationEvidenceArtifact.artifactId,
      content.pick.validationEvidenceArtifact.artifactId,
      content.evaluatedAt,
      qualification.qualificationId.slice('model-qualification:'.length),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(qualification),
    ]
  );
}

describe('governed model qualification PostgreSQL registry', () => {
  it('advances one passing pair atomically, replays it, and isolates failed or stale candidates', async () => {
    const runs = await componentRuns();
    const repository = new PostgresGovernedValuationModelQualificationRepository({
      client: createPgAflOutcomeSqlClient(pool),
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });
    const passing = await qualificationFixture(runs, 'v1', true);
    const forgedEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      relativeMaeImprovement: 0,
    };
    const forgedContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: forgedEvidence,
        validationEvidenceArtifact: await retain(forgedEvidence, evaluatedAt),
      },
    };
    const forgedQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', forgedContent),
      content: forgedContent,
    };
    const forgedArtifact = await retain(forgedQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(forgedQualification, forgedArtifact.artifactId)
    ).rejects.toThrow(/ancestry|mismatch/i);
    const {
      multiclassBrierScore: _omittedBrierScore,
      ...incompletePickMetrics
    } = passing.qualification.content.pick.validationEvidence.metrics!;
    const incompletePickEvidence = {
      ...passing.qualification.content.pick.validationEvidence,
      metrics: incompletePickMetrics,
    };
    const incompletePickContent = {
      ...passing.qualification.content,
      pick: {
        ...passing.qualification.content.pick,
        validationEvidence: incompletePickEvidence,
        validationEvidenceArtifact: await retain(incompletePickEvidence, evaluatedAt),
      },
    };
    const incompletePickQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        incompletePickContent
      ),
      content: incompletePickContent,
    } as unknown as typeof passing.qualification;
    const incompletePickArtifact = await retain(incompletePickQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(
        incompletePickQualification,
        incompletePickArtifact.artifactId
      )
    ).rejects.toThrow(/ancestry|mismatch/i);
    const wrongRoleContent = {
      ...passing.qualification.content,
      pick: {
        ...passing.qualification.content.pick,
        role: 'player_contribution_and_availability',
      },
    };
    const wrongRoleQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', wrongRoleContent),
      content: wrongRoleContent,
    } as unknown as typeof passing.qualification;
    const wrongRoleArtifact = await retain(wrongRoleQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(wrongRoleQualification, wrongRoleArtifact.artifactId)
    ).rejects.toThrow(/contract|mismatch/i);
    const stringBooleanContent = {
      ...passing.qualification.content,
      publicationEligible: 'false',
      player: { ...passing.qualification.content.player, passed: 'true' },
    };
    const stringBooleanQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        stringBooleanContent
      ),
      content: stringBooleanContent,
    } as unknown as typeof passing.qualification;
    const stringBooleanArtifact = await retain(stringBooleanQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(
        stringBooleanQualification,
        stringBooleanArtifact.artifactId
      )
    ).rejects.toThrow(/contract|mismatch/i);
    const invalidScopeContent = {
      ...passing.qualification.content,
      scopeKey: 'invalid scope',
    };
    const invalidScopeQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        invalidScopeContent
      ),
      content: invalidScopeContent,
    } as unknown as typeof passing.qualification;
    const invalidScopeArtifact = await retain(invalidScopeQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(invalidScopeQualification, invalidScopeArtifact.artifactId)
    ).rejects.toThrow(/contract|mismatch/i);
    const invalidReportEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      validationReportId: 'not a report id',
    };
    const invalidReportContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: invalidReportEvidence,
        validationEvidenceArtifact: await retain(invalidReportEvidence, evaluatedAt),
      },
    };
    const invalidReportQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        invalidReportContent
      ),
      content: invalidReportContent,
    } as unknown as typeof passing.qualification;
    const invalidReportArtifact = await retain(invalidReportQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(
        invalidReportQualification,
        invalidReportArtifact.artifactId
      )
    ).rejects.toThrow(/contract|mismatch/i);
    const custodyMismatchContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidenceArtifact: {
          ...passing.qualification.content.player.validationEvidenceArtifact,
          createdAt: '2026-08-20T00:00:00.000Z',
        },
      },
    };
    const custodyMismatchQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        custodyMismatchContent
      ),
      content: custodyMismatchContent,
    } as unknown as typeof passing.qualification;
    const custodyMismatchArtifact = await retain(custodyMismatchQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(
        custodyMismatchQualification,
        custodyMismatchArtifact.artifactId
      )
    ).rejects.toThrow(/custody|mismatch/i);
    const wrongMediaEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      comparableObservationCount: 121,
    };
    const wrongMediaContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: wrongMediaEvidence,
        validationEvidenceArtifact: await retainWithMetadata(wrongMediaEvidence, {
          mediaType: 'text/plain',
          createdAt: evaluatedAt,
        }),
      },
    };
    const wrongMediaQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        wrongMediaContent
      ),
      content: wrongMediaContent,
    } as unknown as typeof passing.qualification;
    const wrongMediaArtifact = await retain(wrongMediaQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(wrongMediaQualification, wrongMediaArtifact.artifactId)
    ).rejects.toThrow(/lineage|mismatch/i);
    const outerCustodyContent = {
      ...passing.qualification.content,
      scopeKey: 'afl-men:2026-outer-custody',
    };
    const outerCustodyQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        outerCustodyContent
      ),
      content: outerCustodyContent,
    } as unknown as typeof passing.qualification;
    const outerCustodyArtifact = await retainWithMetadata(outerCustodyQualification, {
      mediaType: 'text/plain',
      createdAt: evaluatedAt,
    });
    await expect(
      insertQualificationDirectly(
        outerCustodyQualification,
        outerCustodyArtifact.artifactId
      )
    ).rejects.toThrow(/ancestry|mismatch/i);
    const conflictingPolicy = {
      ...passing.qualification.content.policy,
      player: {
        ...passing.qualification.content.policy.player,
        minimumComparableObservations: 101,
      },
    };
    const conflictingPolicyContent = {
      ...passing.qualification.content,
      policy: conflictingPolicy,
      policyArtifact: await retain(conflictingPolicy, evaluatedAt),
      player: {
        ...passing.qualification.content.player,
        criteriaArtifact: await retain(conflictingPolicy.player, evaluatedAt),
      },
    };
    const conflictingPolicyQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        conflictingPolicyContent
      ),
      content: conflictingPolicyContent,
    };
    const conflictingPolicyArtifact = await retain(
      conflictingPolicyQualification,
      evaluatedAt
    );
    await expect(
      insertQualificationDirectly(
        conflictingPolicyQualification,
        conflictingPolicyArtifact.artifactId
      )
    ).rejects.toThrow(/ancestry|mismatch/i);
    const gates = createGovernedValuationModelQualificationGateRecords({
      ...passing,
      decidedAt: authorityAt,
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 1, pick: 1 },
      supersedes: { player: null, pick: null },
    });
    const bypassClient = await pool.connect();
    try {
      await bypassClient.query('BEGIN');
      await bypassClient.query(
        `INSERT INTO outcome_gate_proposal
          (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          gates[0].proposal.proposalId,
          gates[0].proposal.content.gate,
          gates[0].proposal.content.decisionKey,
          gates[0].proposal.content.version,
          gates[0].proposal.content.environment,
          gates[0].proposal.content.scope.scopeKey,
          gates[0].proposal.content.proposedAt,
          canonicalizeAflTradeJson(gates[0].proposal),
        ]
      );
      await expect(
        bypassClient.query(
          `INSERT INTO outcome_gate_decision
            (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
             effective_at,revalidate_at,supersedes_decision_id,decision_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            gates[0].decision.decisionId,
            gates[0].decision.content.proposalId,
            gates[0].decision.content.gate,
            gates[0].decision.content.decisionKey,
            gates[0].decision.content.version,
            gates[0].decision.content.environment,
            gates[0].decision.content.state,
            gates[0].decision.content.decidedAt,
            gates[0].decision.content.effectiveAt,
            gates[0].decision.content.revalidateAt,
            gates[0].decision.content.supersedesDecisionId,
            canonicalizeAflTradeJson(gates[0].decision),
          ]
        )
      ).rejects.toThrow(/qualification|no rows/i);
    } finally {
      await bypassClient.query('ROLLBACK');
      bypassClient.release();
    }

    const advanced = await repository.register({
      ...passing,
      expectedGateLedgerRevision: 0,
      expectedCurrentRevision: 0,
      gateRecords: gates,
    });
    expect(advanced).toMatchObject({
      status: 'advanced',
      idempotentReplay: false,
      current: { revision: 1, qualificationId: passing.qualification.qualificationId },
      work: {
        content: {
          status: 'pending',
          cause: 'current_qualified_model_pair_advanced',
          availableAt: authorityAt,
        },
      },
    });
    const unpairedGates = createGovernedValuationModelQualificationGateRecords({
      ...passing,
      decidedAt: '2026-08-21T09:06:00.000Z',
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 2, pick: 2 },
      supersedes: {
        player: gates[0].decision.decisionId,
        pick: gates[1].decision.decisionId,
      },
    });
    const unpairedClient = await pool.connect();
    try {
      await unpairedClient.query('BEGIN');
      await unpairedClient.query(
        `INSERT INTO outcome_gate_proposal
          (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          unpairedGates[0].proposal.proposalId,
          unpairedGates[0].proposal.content.gate,
          unpairedGates[0].proposal.content.decisionKey,
          unpairedGates[0].proposal.content.version,
          unpairedGates[0].proposal.content.environment,
          unpairedGates[0].proposal.content.scope.scopeKey,
          unpairedGates[0].proposal.content.proposedAt,
          canonicalizeAflTradeJson(unpairedGates[0].proposal),
        ]
      );
      await expect(
        (async () => {
          await unpairedClient.query(
            `INSERT INTO outcome_gate_decision
              (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
               effective_at,revalidate_at,supersedes_decision_id,decision_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
            [
              unpairedGates[0].decision.decisionId,
              unpairedGates[0].decision.content.proposalId,
              unpairedGates[0].decision.content.gate,
              unpairedGates[0].decision.content.decisionKey,
              unpairedGates[0].decision.content.version,
              unpairedGates[0].decision.content.environment,
              unpairedGates[0].decision.content.state,
              unpairedGates[0].decision.content.decidedAt,
              unpairedGates[0].decision.content.effectiveAt,
              unpairedGates[0].decision.content.revalidateAt,
              unpairedGates[0].decision.content.supersedesDecisionId,
              canonicalizeAflTradeJson(unpairedGates[0].decision),
            ]
          );
          await unpairedClient.query('COMMIT');
        })()
      ).rejects.toThrow(/atomic|pair|unique|duplicate/i);
    } finally {
      await unpairedClient.query('ROLLBACK');
      unpairedClient.release();
    }
    await expect(
      repository.register({
        ...passing,
        expectedGateLedgerRevision: 0,
        expectedCurrentRevision: 0,
        gateRecords: gates,
      })
    ).resolves.toMatchObject({ status: 'advanced', idempotentReplay: true });
    await expect(
      pool.query(
        `UPDATE outcome_governed_model_qualification_work
            SET work_json=jsonb_set(work_json,'{content,cause}','"forged"'::jsonb)
          WHERE work_id=$1`,
        [advanced.work!.workId]
      )
    ).rejects.toThrow(/immutable/i);

    const failed = await qualificationFixture(runs, 'failed', false);
    await expect(
      repository.register({
        ...failed,
        expectedGateLedgerRevision: 2,
        expectedCurrentRevision: 1,
      })
    ).resolves.toMatchObject({
      status: 'failed_retained',
      current: { qualificationId: passing.qualification.qualificationId, revision: 1 },
    });

    const stale = await qualificationFixture(runs, 'v2', true);
    const staleGates = createGovernedValuationModelQualificationGateRecords({
      ...stale,
      decidedAt: '2026-08-21T09:10:00.000Z',
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 2, pick: 2 },
      supersedes: {
        player: gates[0].decision.decisionId,
        pick: gates[1].decision.decisionId,
      },
    });
    const crossScopeProposalContent = {
      ...staleGates[0].proposal.content,
      scope: { ...staleGates[0].proposal.content.scope, scopeKey: 'afl-men:2025-trades' },
    };
    const crossScopeProposal = {
      proposalId: createAflTradeContentAddress('gate-proposal', crossScopeProposalContent),
      content: crossScopeProposalContent,
    };
    const crossScopeDecisionContent = {
      ...staleGates[0].decision.content,
      proposalId: crossScopeProposal.proposalId,
      scope: crossScopeProposalContent.scope,
    };
    const crossScopeGates = [
      {
        proposal: crossScopeProposal,
        decision: {
          decisionId: createAflTradeContentAddress('gate-decision', crossScopeDecisionContent),
          content: crossScopeDecisionContent,
        },
      },
      staleGates[1],
    ] as const;
    await expect(
      repository.register({
        ...stale,
        expectedGateLedgerRevision: 2,
        expectedCurrentRevision: 1,
        gateRecords: crossScopeGates,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GovernedValuationModelQualificationRepositoryError>>({
        code: 'INTEGRITY_MISMATCH',
      })
    );
    await expect(
      repository.register({
        ...stale,
        expectedGateLedgerRevision: 2,
        expectedCurrentRevision: 0,
        gateRecords: staleGates,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GovernedValuationModelQualificationRepositoryError>>({
        code: 'STALE_CURRENT_PAIR',
      })
    );
    expect(await repository.loadCurrent('afl-men:2026-trades')).toMatchObject({
      revision: 1,
      qualificationId: passing.qualification.qualificationId,
    });
    const rolledBack = await pool.query(
      `SELECT 1 FROM outcome_governed_valuation_model_qualification WHERE qualification_id=$1`,
      [stale.qualification.qualificationId]
    );
    expect(rolledBack.rowCount).toBe(0);
  }, 120_000);
});
