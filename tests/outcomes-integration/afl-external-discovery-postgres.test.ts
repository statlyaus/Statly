import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeExternalHistoricalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalCaptureScheduleRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeScheduleRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_external_discovery_${process.pid}_${Date.now()}`;
const prismaSchemaPath = join(process.cwd(), 'prisma', 'afl-trade-outcomes', 'schema.prisma');
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});

const sha = (character: string) => character.repeat(64);
const sourceSha256 = sha('c');
const artifactId = `artifact:${sourceSha256}`;
const captureId = `source-capture:${sha('a')}`;
const capturedAt = new Date(Date.now() - 120_000).toISOString();
const plannedAt = new Date(Date.parse(capturedAt) + 30_000).toISOString();

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function evidenceBatch() {
  const capture = {
    captureId,
    artifactId,
    contentSha256: sourceSha256,
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/trades',
    capturedAt,
    effectiveAt: capturedAt,
    parserVersion: 'draftguru-trade-index/v1',
    fieldManifestSha256: sha('f'),
  } as const;
  const evidence = [
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: 'afl-trade-external-evidence/v1',
      provider: 'draftguru',
      capture,
      sourceRow: { ordinal: 1, sourceKey: '2024-alpha-trade' },
      claim: {
        kind: 'trade_detail_link',
        nativeEventId: '2024-alpha-trade',
        anchorSeasonYear: 2024,
        sourceUrl: 'https://www.draftguru.com.au/trades/2024-alpha-trade',
      },
      publicationEligible: false,
    }),
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: 'afl-trade-external-evidence/v1',
      provider: 'draftguru',
      capture,
      sourceRow: { ordinal: 2, sourceKey: '2025-beta-trade' },
      claim: {
        kind: 'trade_detail_link',
        nativeEventId: '2025-beta-trade',
        anchorSeasonYear: 2025,
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-beta-trade',
      },
      publicationEligible: false,
    }),
  ];
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: 'afl-trade-external-evidence-batch/v1',
    provider: 'draftguru',
    captureId,
    evidence,
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

async function seedIndexBatch() {
  const batch = evidenceBatch();
  await outcomesPool.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFLM',2024),('AFLM',2025) ON CONFLICT DO NOTHING`
  );
  await outcomesPool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'text/html',1,'raw_source','test_fixture',$4,$4,'{}'::jsonb)`,
    [artifactId, sourceSha256, `artifact://sha256/${sourceSha256}`, capturedAt]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ('attempt-discovery','test_fixture','draftguru','trade-index',
             'draftguru-trade-index','captured',$1,$1,'{}'::jsonb)`,
    [capturedAt]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_source_capture
      (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
       dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
       captured_at,status,manifest_json)
     VALUES ($1,'attempt-discovery','snapshot-discovery',$2,'test_fixture','draftguru',
             'trade-index','2026-08-10','automated_web','draftguru-trade-index','AFLM',2025,
             $3,$3,'approved',$4::jsonb)`,
    [
      captureId,
      artifactId,
      capturedAt,
      canonicalizeAflTradeJson({
        sourceUrl: 'https://www.draftguru.com.au/trades',
        executionReceipt: {
          content: { request: { discoveryFromSeasonYear: 2024 } },
        },
      }),
    ]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_external_evidence_batch
      (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
       status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',$3,0,$4,$5,'open',NULL,$6::jsonb)`,
    [
      batch.batchId,
      captureId,
      batch.content.rowCount,
      batch.content.rowSetSha256,
      sha256AflTradeCanonicalJson([]),
      canonicalizeAflTradeJson(batch),
    ]
  );
  for (const evidence of batch.content.evidence) {
    await outcomesPool.query(
      `INSERT INTO outcome_external_evidence_row
        (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
       VALUES ($1,$2,$3,$4,'trade_detail_link',$5::jsonb)`,
      [
        evidence.evidenceId,
        batch.batchId,
        evidence.content.sourceRow.ordinal,
        evidence.content.sourceRow.sourceKey,
        canonicalizeAflTradeJson(evidence),
      ]
    );
  }
  await outcomesPool.query(
    `UPDATE outcome_external_evidence_batch
        SET status='finalized', finalized_at=$2
      WHERE batch_id=$1`,
    [batch.batchId, capturedAt]
  );
  return batch;
}

async function seedTargetBatch(
  target: ReturnType<
    typeof createAflTradeExternalHistoricalCapturePlan
  >['content']['targets'][number],
  index: number
) {
  const request = target.content.schedule.definition.requestTemplate;
  const contentSha256 = digest(`historical-completion-content-${index}`);
  const targetArtifactId = `artifact:${contentSha256}`;
  const targetCaptureId = `source-capture:${digest(`historical-completion-capture-${index}`)}`;
  const attemptId = `attempt-historical-completion-${index}`;
  const evidenceCapture = {
    captureId: targetCaptureId,
    artifactId: targetArtifactId,
    contentSha256,
    mediaType: 'text/html' as const,
    sourceUrl: request.sourceUrl,
    capturedAt,
    effectiveAt: capturedAt,
    parserVersion: request.parserVersion,
    fieldManifestSha256: request.fieldManifestSha256,
  };
  const evidence = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: 'afl-trade-external-evidence/v1',
    provider: 'draftguru',
    capture: evidenceCapture,
    sourceRow: { ordinal: 1, sourceKey: `completion-${index}` },
    claim:
      request.capabilityId === 'draftguru-trade-detail'
        ? {
            kind: 'transaction' as const,
            nativeEventId: new URL(request.sourceUrl).pathname.slice('/trades/'.length),
            seasonYear: request.anchorSeasonYear,
            occurredOn: null,
            transactionType: 'trade' as const,
            title: null,
          }
        : {
            kind: 'draft_selection' as const,
            draftYear: request.anchorSeasonYear,
            draftType: 'national' as const,
            selectionNumber: index + 1,
            roundNumber: 1,
            player: { nativeId: `player-${index}`, recordedName: `Player ${index}` },
            selectedByClub: { nativeId: `club-${index}`, recordedName: `Club ${index}` },
          },
    publicationEligible: false,
  });
  const batch = createAflTradeExternalEvidenceBatch({
    schemaVersion: 'afl-trade-external-evidence-batch/v1',
    provider: 'draftguru',
    captureId: targetCaptureId,
    evidence: [evidence],
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
  await outcomesPool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'text/html',1,'raw_source','test_fixture',$4,$4,'{}'::jsonb)`,
    [targetArtifactId, contentSha256, `artifact://sha256/${contentSha256}`, capturedAt]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ($1,'test_fixture','draftguru',$2,$3,'captured',$4,$4,'{}'::jsonb)`,
    [attemptId, request.dataset, request.capabilityId, capturedAt]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_source_capture
      (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
       dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
       captured_at,status,manifest_json)
     VALUES ($1,$2,$3,$4,'test_fixture','draftguru',$5,$6,'automated_web',$7,'AFLM',$8,
             $9,$9,'approved',$10::jsonb)`,
    [
      targetCaptureId,
      attemptId,
      `snapshot-historical-completion-${index}`,
      targetArtifactId,
      request.dataset,
      request.datasetVersion,
      request.capabilityId,
      request.anchorSeasonYear,
      capturedAt,
      canonicalizeAflTradeJson({ sourceUrl: request.sourceUrl }),
    ]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_external_evidence_batch
      (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
       status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,$5::jsonb)`,
    [
      batch.batchId,
      targetCaptureId,
      batch.content.rowSetSha256,
      sha256AflTradeCanonicalJson([]),
      canonicalizeAflTradeJson(batch),
    ]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_external_evidence_row
      (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
     VALUES ($1,$2,1,$3,$4,$5::jsonb)`,
    [
      evidence.evidenceId,
      batch.batchId,
      evidence.content.sourceRow.sourceKey,
      evidence.content.claim.kind,
      canonicalizeAflTradeJson(evidence),
    ]
  );
  await outcomesPool.query(
    `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at=$2
      WHERE batch_id=$1`,
    [batch.batchId, capturedAt]
  );
  return { batch, targetCaptureId, targetArtifactId };
}

async function seedExternalIdentityReviewerAuthority(input: {
  principalRef: string;
  provider: string;
  validFromSeason: number;
  validThroughSeason: number;
}) {
  const payload = {
    evidenceKind: 'reviewer_authority_evidence',
    environment: 'test_fixture',
    principalRef: input.principalRef,
    role: 'afl_trade_external_identity_reviewer',
    scopeKey: 'public-afl-draft-trade-outcomes',
    provider: input.provider,
    capabilityId: 'external_identity_resolution',
    competition: 'AFLM',
    validFromSeason: input.validFromSeason,
    validThroughSeason: input.validThroughSeason,
  } as const;
  const referenceId = createAflTradeContentAddress('reviewer-authority-evidence', payload);
  const referenceSha256 = referenceId.split(':')[1]!;
  const evidenceCanonicalJson = canonicalizeAflTradeJson(payload);
  const evidenceArtifactId = createAflTradeContentAddress('governed-evidence-artifact', {
    referenceId,
  });
  const evidenceApprovalDecisionId = createAflTradeContentAddress(
    'governed-evidence-approval-decision',
    { referenceId }
  );
  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'application/json',$4,'derived_private','test_fixture',$5,$5,'{}'::jsonb)`,
      [
        evidenceArtifactId,
        referenceSha256,
        `artifact://sha256/${referenceSha256}`,
        Buffer.byteLength(evidenceCanonicalJson),
        capturedAt,
      ]
    );
    await connection.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'governed_evidence_reference',$2,'approved','Fixture reviewer authority',
               jsonb_build_object('referenceSha256',$3::text),'fixture-governance-reviewer',$4)`,
      [evidenceApprovalDecisionId, referenceId, referenceSha256, capturedAt]
    );
    await connection.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6::TEXT,$6::jsonb)`,
      [
        referenceId,
        referenceSha256,
        evidenceArtifactId,
        evidenceApprovalDecisionId,
        capturedAt,
        evidenceCanonicalJson,
      ]
    );
    await connection.query(
      `INSERT INTO outcome_operational_principal_authority
        (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,
         competition,valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES ($1,$2,'afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes',
               $3,'external_identity_resolution','AFLM',$4,$5,$6,NULL)`,
      [
        referenceId,
        input.principalRef,
        input.provider,
        input.validFromSeason,
        input.validThroughSeason,
        capturedAt,
      ]
    );
    await connection.query('COMMIT');
  } finally {
    await connection.query('ROLLBACK').catch(() => undefined);
    connection.release();
  }
  return referenceId;
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(
    'npx',
    ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', prismaSchemaPath],
    {
      env: { ...process.env, AFL_OUTCOMES_DATABASE_URL: scopedDatabaseUrl() },
      stdio: 'pipe',
    }
  );
});

afterAll(async () => {
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('PostgreSQL external trade discovery', () => {
  it('seals an exact inventory and schedule-complete plan and rejects late members', async () => {
    const batch = await seedIndexBatch();
    const repository = new PostgresAflTradeExternalDiscoveryRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const inventory = await repository.loadInventoryFromBatch({
      batchId: batch.batchId,
      fromYear: 2024,
      throughYear: 2025,
    });
    await expect(repository.persistInventory(inventory)).resolves.toMatchObject({
      idempotentReplay: false,
      linkCount: 2,
    });
    const plan = createAflTradeExternalHistoricalCapturePlan({
      inventory,
      plannedAt,
      parserVersions: { tradeDetail: 'detail/v1', yearPage: 'year/v1' },
      datasetVersions: { tradeDetail: 'detail-v1', yearPage: 'year-v1' },
      fieldManifestSha256: { tradeDetail: sha('d'), yearPage: sha('e') },
      authorities: {
        tradeDetail: {
          rightsArtifactId: `source-rights:${sha('1')}`,
          fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
          cacheSeconds: 86_400,
          rawRetentionDays: 365,
        },
        yearPage: {
          rightsArtifactId: `source-rights:${sha('2')}`,
          fieldUses: [{ sourceField: 'selection_number', use: 'archive_fact' }],
          cacheSeconds: 86_400,
          rawRetentionDays: 365,
        },
      },
      execution: {
        maximumAttempts: 5,
        leaseSeconds: 300,
        retryBaseSeconds: 30,
        retryMaximumSeconds: 3_600,
        maximumLatenessSeconds: 2_592_000,
        circuitFailureThreshold: 5,
        circuitResetSeconds: 900,
      },
      maximumBytes: 2_000_000,
    });
    await expect(repository.persistPlan(plan)).resolves.toMatchObject({
      idempotentReplay: false,
      targetCount: 4,
    });
    await expect(repository.persistPlan(plan)).resolves.toMatchObject({ idempotentReplay: true });
    await expect(
      repository.loadFinalizedPlanPage({
        planId: plan.planId,
        afterOrdinal: 1,
        maximumTargets: 2,
      })
    ).resolves.toMatchObject({
      targetCount: 4,
      afterOrdinal: 1,
      nextAfterOrdinal: 3,
      targets: [{ content: { ordinal: 2 } }, { content: { ordinal: 3 } }],
    });
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_external_historical_capture_target
          (plan_id,ordinal,target_id,schedule_id,discovery_evidence_id,capability_id,
           anchor_season_year,source_url,target_json)
         VALUES ($1,99,$2,$3,NULL,'draftguru-year-page',2025,
                 'https://www.draftguru.com.au/years/2025','{}'::jsonb)`,
        [
          plan.planId,
          `external-capture-target:${sha('9')}`,
          plan.content.targets[0]!.content.schedule.scheduleId,
        ]
      )
    ).rejects.toThrow(/open plan/i);

    const scheduleRepository = new PostgresAflTradeExternalCaptureScheduleRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    for (const [index, target] of plan.content.targets.entries()) {
      const seeded = await seedTargetBatch(target, index);
      const observedAt = new Date().toISOString();
      const decision = await scheduleRepository.claim({
        scheduleId: target.content.schedule.scheduleId,
        dueAt: target.content.schedule.definition.cadence.anchorAt,
        observedAt,
        workerId: 'integration-historical-completion',
        leaseTokenSha256: digest(`historical-completion-lease-${index}`),
      });
      expect(decision.action).toBe('claim');
      const claim = decision.proposedClaim;
      if (claim === null) throw new TypeError('Expected the historical target to be claimable.');
      if (index === 1) {
        const notModifiedAttemptId = `source-capture-attempt:${digest('historical-completion-304')}`;
        await outcomesPool.query(
          `INSERT INTO outcome_source_capture_attempt
            (attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
             started_at,completed_at,attempt_json)
           VALUES ($1,'test_fixture','draftguru',$2,$3,$4,'not_modified',$5,$5,$6::jsonb)`,
          [
            notModifiedAttemptId,
            target.content.schedule.definition.requestTemplate.dataset,
            target.content.schedule.definition.requestTemplate.capabilityId,
            seeded.targetArtifactId,
            observedAt,
            canonicalizeAflTradeJson({ priorCaptureId: seeded.targetCaptureId }),
          ]
        );
        await scheduleRepository.complete({
          claim,
          completedAt: new Date().toISOString(),
          outcome: { status: 'not_modified', resultId: notModifiedAttemptId },
        });
      } else {
        await scheduleRepository.complete({
          claim,
          completedAt: new Date().toISOString(),
          outcome: { status: 'completed', resultId: seeded.batch.batchId },
        });
      }
    }
    const completionRepository = new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const completion = await completionRepository.completePlan(plan.planId);
    expect(completion).toMatchObject({
      planId: plan.planId,
      targetCount: 4,
      sourceBatchCount: 4,
      idempotentReplay: false,
      publicationEligible: false,
    });
    await expect(completionRepository.completePlan(plan.planId)).resolves.toMatchObject({
      completionId: completion.completionId,
      idempotentReplay: true,
    });
    const outcomeClient = createPgAflOutcomeSqlClient(outcomesPool);
    const historicalSource = new PostgresAflTradeExternalHistoricalReconciliationSource(
      outcomeClient
    );
    const loadedSource = await historicalSource.load(completion.completionId);
    const identityReviewPackage = buildAflTradeExternalIdentityReviewPackage(loadedSource);
    const playerItem = identityReviewPackage.content.items.find(
      ({ workItem }) => workItem.content.subject.content.entityKind === 'player'
    )?.workItem;
    if (!playerItem) throw new TypeError('Expected one reviewable player identity.');
    const canonicalPlayerId = 'afl-player:external-identity-review';
    await outcomesPool.query(
      `INSERT INTO outcome_player (player_id,display_name,status)
       VALUES ($1,'External Identity Review Player','approved')`,
      [canonicalPlayerId]
    );
    const principalRef = 'operator:external-identity-review-integration';
    const authorityEvidenceId = await seedExternalIdentityReviewerAuthority({
      principalRef,
      provider: playerItem.content.subject.content.provider,
      validFromSeason: playerItem.content.validFromSeason,
      validThroughSeason: playerItem.content.validThroughSeason,
    });
    const identityDecision = createAflTradeExternalIdentityReviewDecision({
      subject: playerItem.content.subject,
      reviewPackageId: identityReviewPackage.packageId,
      reviewPackageSha256: identityReviewPackage.packageId.split(':')[1]!,
      workItemId: playerItem.workItemId,
      workItemSha256: playerItem.workItemId.split(':')[1]!,
      workItem: playerItem,
      revision: 1,
      supersedesDecisionId: null,
      decision: 'approved',
      canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
        entityKind: 'player',
        canonicalId: canonicalPlayerId,
        recordedLabel: 'External Identity Review Player',
      }),
      rationale: 'Disposable PostgreSQL external identity review.',
      authorityEvidenceId,
      decidedBy: principalRef,
      decidedAt: new Date().toISOString(),
    });
    const identityRepository = new PostgresAflTradeExternalIdentityReviewRepository(outcomeClient);
    await expect(
      identityRepository.persistDecision({
        reviewPackage: identityReviewPackage,
        decision: identityDecision,
      })
    ).resolves.toMatchObject({ revision: 1, status: 'approved', idempotentReplay: false });
    await expect(
      identityRepository.persistDecision({
        reviewPackage: identityReviewPackage,
        decision: identityDecision,
      })
    ).resolves.toMatchObject({ decisionId: identityDecision.decisionId, idempotentReplay: true });
    await expect(identityRepository.loadCurrentResolutions(identityReviewPackage)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.objectContaining({
            canonicalId: canonicalPlayerId,
            reviewDecisionId: identityDecision.decisionId,
          }),
        }),
      ])
    );
    const prepared = await prepareAflTradeHistoricalReconciliation(
      { completionId: completion.completionId },
      {
        source: historicalSource,
        identityReviewRepository: identityRepository,
        candidateRepository: new PostgresAflTradeExternalReconciliationRepository(outcomeClient),
      }
    );
    expect(prepared).toMatchObject({
      completionId: completion.completionId,
      status: 'finalized',
      requiresReview: true,
      promotionEligible: false,
      publicationEligible: false,
    });
    await expect(
      prepareAflTradeHistoricalReconciliation(
        { completionId: completion.completionId },
        {
          source: new PostgresAflTradeExternalHistoricalReconciliationSource(outcomeClient),
          identityReviewRepository: new PostgresAflTradeExternalIdentityReviewRepository(
            outcomeClient
          ),
          candidateRepository: new PostgresAflTradeExternalReconciliationRepository(outcomeClient),
        }
      )
    ).resolves.toMatchObject({ candidateId: prepared.candidateId, idempotentReplay: true });
    const authority = await outcomesPool.query(
      `SELECT source_authority_kind,historical_completion_id
         FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
      [prepared.candidateId]
    );
    expect(authority.rows).toEqual([
      {
        source_authority_kind: 'historical_plan_completion',
        historical_completion_id: completion.completionId,
      },
    ]);
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_external_historical_capture_completion_result
          (completion_id,ordinal,plan_id,target_id,schedule_id,dispatch_key,occurrence_event_id,
           occurrence_revision,capture_mode,result_id,capture_id,evidence_batch_id,evidence_count,
           finalized_at,result_json)
         SELECT completion_id,99,plan_id,'external-capture-target:late',schedule_id,dispatch_key,
                occurrence_event_id,occurrence_revision,capture_mode,result_id,capture_id,
                evidence_batch_id,evidence_count,finalized_at,result_json
           FROM outcome_external_historical_capture_completion_result
          WHERE completion_id=$1 AND ordinal=1`,
        [completion.completionId]
      )
    ).rejects.toThrow(/exact open parent/i);
  });
});
