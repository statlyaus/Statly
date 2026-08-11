import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { PostgresAflTradePromotionBackedCorpusRepository } from '@/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradePromotionBackedGate2AffectedArtifacts } from '@/server/aflTradeIntelligence/outcomes/promotionBackedGate2AdmissionContracts';
import {
  parseAflTradePromotionBackedFactualLineage,
  type AflTradePromotionBackedFactualLineage,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualLineageContracts';
import { aflTradePromotionBackedFactualReleaseSchema } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePromotionBackedGate2Repository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedGate2Repository';
import { PostgresAflTradePromotionBackedFactualReleaseRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedFactualReleaseRepository';
import { PostgresAflTradePromotionBackedPublicArchiveRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveRepository';
import { createPostgresAflDraftTradeOutcomeReleaseRepository } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
  createAflTradeExternalCanonicalPromotionProposal,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_external_promotion_${process.pid}_${Date.now()}`;
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
const evidenceId = `external-evidence:${digest('e')}`;
const batchId = `external-evidence-batch:${digest('b')}`;
const captureId = 'external-promotion-capture';
const transactionId = createAflTradeContentAddress('external-transaction', {
  provider: 'draftguru',
  nativeEventId: 'promotion-fixture',
});
const transferId = createAflTradeContentAddress('external-transfer', {
  transactionId,
  nativeTransferId: 'pick-14',
});
const pickId = createAflTradeContentAddress('draft-pick', {
  draftYear: 2025,
  draftType: 'national',
  nominalRound: 1,
  nominalPick: 14,
});
const custodyId = createAflTradeContentAddress('external-pick-custody', { evidenceId });

const executionReceipt = createAflTradeExternalCaptureExecutionReceipt({
  schemaVersion: 'afl-trade-external-capture-execution/v1',
  rightsArtifactId: `source-rights:${digest('2')}`,
  gateDecisionId: `gate-decision:${digest('3')}`,
  gateDecisionKey: 'fixture:draftguru-trade-detail',
  ledgerRevision: 1,
  evaluatedAt: '2025-11-01T00:00:00.000Z',
  provider: 'draftguru',
  capabilityId: 'draftguru-trade-detail',
  parserVersion: 'draftguru/v1',
  fieldManifestSha256: digest('4'),
  upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
  cacheSeconds: 86_400,
  rawRetentionDays: 365,
  egressPolicyEvidenceId: `artifact:${digest('5')}`,
});

function candidateFixture() {
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: 'promotion-fixture',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: 'Fixture pick exchange',
        parties: ['club-gws', 'club-western-bulldogs'],
        transferIds: [transferId],
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    transfers: [
      {
        transferId,
        transactionId,
        fromClubId: 'club-gws',
        toClubId: 'club-western-bulldogs',
        asset: {
          kind: 'pick_entitlement',
          pickId,
          draftYear: 2025,
          draftType: 'national',
          nominalRound: 1,
          nominalPick: 14,
          originalClubId: 'club-gws',
          recordedLabel: 'Pick 14',
        },
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    draftSelections: [],
    pickCustody: [
      {
        custodyId,
        pickId,
        observedAt: '2025-11-01T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClubId: 'club-gws',
        currentClubId: 'club-western-bulldogs',
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    pickLineage: [],
    issues: [],
    reconciledAt: '2026-08-09T11:00:00.000Z',
    publicationEligible: false,
  });
}

async function seedCaptureAndEvidence(): Promise<void> {
  await outcomesPool.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFLM',2025)`
  );
  await outcomesPool.query(
    `INSERT INTO outcome_club (club_id,current_name,status) VALUES
       ('club-gws','GWS','approved'),
       ('club-western-bulldogs','Western Bulldogs','approved')`
  );
  await outcomesPool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ('artifact-promotion-source',$1,$2,'text/html',1,'raw_source','test_fixture',
             '2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`,
    [digest('1'), `artifact://sha256/${digest('1')}`]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ('attempt-promotion','test_fixture','draftguru','trades','draftguru-trade-detail',
             'captured','2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`
  );
  await outcomesPool.query(
    `INSERT INTO outcome_source_capture
      (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
       dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
       captured_at,status,manifest_json)
     VALUES ($1,'attempt-promotion',$2,'artifact-promotion-source','test_fixture',
             'draftguru','trades','2025','automated_web','draftguru-trade-detail','AFLM',2025,
             '2025-10-15T00:00:00.000Z','2025-11-01T00:00:01.000Z','approved',$3::jsonb)`,
    [
      captureId,
      `source-snapshot:${digest('2')}`,
      canonicalizeAflTradeJson({
        sourceUrl: 'https://www.draftguru.com.au/trades/promotion-fixture',
        executionReceipt,
      }),
    ]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_external_evidence_batch
      (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
       status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,'{}'::jsonb)`,
    [batchId, captureId, sha256AflTradeCanonicalJson([evidenceId]), digest('0')]
  );
  await outcomesPool.query(
    `INSERT INTO outcome_external_evidence_row
      (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
     VALUES ($1,$2,1,'fixture-trade','transaction','{}'::jsonb)`,
    [evidenceId, batchId]
  );
  await outcomesPool.query(
    `UPDATE outcome_external_evidence_batch
        SET status='finalized',finalized_at='2025-11-01T00:00:02.000Z'
      WHERE batch_id=$1`,
    [batchId]
  );
}

async function seedPromotionAuthority(
  candidateId: string,
  proposal: ReturnType<typeof createAflTradeExternalCanonicalPromotionProposal>
): Promise<string> {
  const principalRef = 'operator:external-canonical-promotion';
  const authorityPayload = {
    evidenceKind: 'reviewer_authority_evidence',
    environment: 'test_fixture',
    principalRef,
    role: 'afl_trade_canonical_promoter',
    scopeKey: 'public-afl-draft-trade-outcomes',
    provider: 'multi_source',
    capabilityId: 'external_candidate_promotion',
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2025,
  };
  const authorityId = createAflTradeContentAddress('reviewer-authority-evidence', authorityPayload);
  const authoritySha = authorityId.split(':')[1] ?? '';
  const authorityApprovalId = createAflTradeContentAddress('governed-evidence-approval-decision', {
    authorityId,
  });
  const authorityCanonical = canonicalizeAflTradeJson(authorityPayload);
  await outcomesPool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ('artifact-promotion-authority',$1,$2,'application/json',$3,'derived_private',
             'test_fixture','2026-08-09T11:01:00.000Z','2026-08-09T11:01:01.000Z','{}'::jsonb)`,
    [authoritySha, `artifact://sha256/${authoritySha}`, Buffer.byteLength(authorityCanonical)]
  );
  const authorityClient = await outcomesPool.connect();
  try {
    await authorityClient.query('BEGIN');
    await authorityClient.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'governed_evidence_reference',$2,'approved','Fixture authority approval',
               jsonb_build_object('referenceSha256',$3::text),'fixture-governance-reviewer',
               '2026-08-09T11:02:00.000Z')`,
      [authorityApprovalId, authorityId, authoritySha]
    );
    await authorityClient.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,'reviewer_authority_evidence','artifact-promotion-authority','test_fixture',
               'approved',$3,'2026-08-09T11:02:00.000Z',$4,$5::jsonb)`,
      [authorityId, authoritySha, authorityApprovalId, authorityCanonical, authorityCanonical]
    );
    await authorityClient.query('COMMIT');
  } catch (error) {
    await authorityClient.query('ROLLBACK');
    throw error;
  } finally {
    authorityClient.release();
  }
  await outcomesPool.query(
    `INSERT INTO outcome_operational_principal_authority
      (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,
       valid_from_season,valid_through_season,valid_from,valid_through)
     VALUES ($1,$2,'afl_trade_canonical_promoter','public-afl-draft-trade-outcomes','multi_source',
             'external_candidate_promotion','AFLM',2025,2025,
             '2026-01-01T00:00:00.000Z',NULL)`,
    [authorityId, principalRef]
  );
  const repository = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
    createPgAflOutcomeSqlClient(outcomesPool)
  );
  const candidate = await repository.loadCandidate(candidateId);
  const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
    candidateId,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalId.split(':')[1]!,
    proposal,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    rationale: 'Promote exact fixture candidate',
    authorityEvidenceId: authorityId,
    decidedBy: principalRef,
    decidedAt: '2026-08-09T11:04:00.000Z',
  });
  await repository.persistDecision({ candidate, proposal, decision });
  return decision.decisionId;
}

async function seedGate2Authority(lineage: AflTradePromotionBackedFactualLineage): Promise<void> {
  const affectedArtifacts = createAflTradePromotionBackedGate2AffectedArtifacts(lineage);
  const scope = {
    scopeKey: lineage.content.scopeKey,
    description: 'Approve the exact promotion-backed fixture lineage.',
    dimensions: [
      { name: 'competition', values: [lineage.content.competition] },
      { name: 'valid_from_season', values: [String(lineage.content.validFromSeason)] },
      { name: 'valid_through_season', values: [String(lineage.content.validThroughSeason)] },
    ],
    exclusions: ['Valuation, grading, publication and activation'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_2_corpus_lineage' as const,
    decisionKey: `gate2:${lineage.lineageId}`,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Approve the exact fixture corpus lineage.',
    alternativesConsidered: ['Keep the factual candidate private.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [`artifact:${digest('6')}`],
    affectedArtifacts,
    proposedAt: '2026-08-10T00:00:05.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: proposal.content.environment,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${digest('7')}`],
    conditionResults: [],
    rationale: 'Fixture Gate 2 approval.',
    limitations: ['No public or valuation authority.'],
    decidedAt: '2026-08-10T00:00:06.000Z',
    effectiveAt: '2026-08-10T00:00:06.000Z',
    revalidateAt: '2027-08-10T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      `INSERT INTO outcome_gate_proposal
        (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        proposal.proposalId,
        proposal.content.gate,
        proposal.content.decisionKey,
        proposal.content.version,
        proposal.content.environment,
        proposal.content.scope.scopeKey,
        proposal.content.proposedAt,
        canonicalizeAflTradeJson(proposal),
      ]
    );
    await connection.query(
      `INSERT INTO outcome_gate_decision
        (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
         effective_at,revalidate_at,supersedes_decision_id,decision_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        decision.decisionId,
        decision.content.proposalId,
        decision.content.gate,
        decision.content.decisionKey,
        decision.content.version,
        decision.content.environment,
        decision.content.state,
        decision.content.decidedAt,
        decision.content.effectiveAt,
        decision.content.revalidateAt,
        decision.content.supersedesDecisionId,
        canonicalizeAflTradeJson(decision),
      ]
    );
    await connection.query(
      `UPDATE outcome_gate_ledger_head
          SET revision=1,updated_at=$1
        WHERE singleton_id=1 AND revision=0`,
      [decision.content.decidedAt]
    );
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(),
  });
  await seedCaptureAndEvidence();
});

afterAll(async () => {
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('PostgreSQL external candidate canonical promotion', () => {
  it('atomically promotes once and returns one exact concurrent replay without publishing', async () => {
    const candidate = candidateFixture();
    const reconciliation = new PostgresAflTradeExternalReconciliationRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    await reconciliation.persistCandidate({ candidate, identityResolutions: [] });
    const proposal = createAflTradeExternalCanonicalPromotionProposal({
      schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
      candidateId: candidate.candidateId,
      candidateSha256: candidate.candidateId.split(':')[1] ?? '',
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      draftEventCoverage: [],
      transactionDateCoverage: [{ transactionId, seasonYear: 2025, occurredOn: '2025-10-15' }],
      proposedAt: '2026-08-09T11:03:00.000Z',
      publicationEligible: false,
    });
    const approvalDecisionId = await seedPromotionAuthority(candidate.candidateId, proposal);
    const repository = new PostgresAflTradeExternalCanonicalPromotionRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );

    const [left, right] = await Promise.all([
      repository.promote({ candidateId: candidate.candidateId, approvalDecisionId }),
      repository.promote({ candidateId: candidate.candidateId, approvalDecisionId }),
    ]);

    expect([left.idempotentReplay, right.idempotentReplay].sort()).toEqual([false, true]);
    await expect(
      outcomesPool.query<{ event_date: string }>(
        `SELECT event_date::TEXT AS event_date FROM outcome_event_version WHERE event_id=$1`,
        [transactionId]
      )
    ).resolves.toMatchObject({ rows: [{ event_date: '2025-10-15' }] });
    const corpusRepository = new PostgresAflTradePromotionBackedCorpusRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const corpusRequest = {
      environment: 'test_fixture' as const,
      competition: 'AFLM',
      knowledgeCutoffAt: '2026-08-09T11:04:00.000Z',
      createdAt: '2026-08-09T11:05:00.000Z',
    };
    const corpus = await corpusRepository.build(corpusRequest);
    expect(corpus).toMatchObject({
      status: 'finalized',
      idempotentReplay: false,
      promotionCount: 1,
      memberCount: 3,
    });
    await expect(corpusRepository.build(corpusRequest)).resolves.toEqual({
      ...corpus,
      idempotentReplay: true,
    });
    const releaseRepository = new PostgresAflTradePromotionBackedFactualReleaseRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const releaseRequest = {
      corpusId: corpus.corpusId,
      scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025',
      createdAt: '2026-08-09T11:06:00.000Z',
    };
    const release = await releaseRepository.build(releaseRequest);
    expect(release).toMatchObject({
      corpusId: corpus.corpusId,
      status: 'finalized',
      idempotentReplay: false,
      canonicalMemberCount: 3,
    });
    await expect(releaseRepository.build(releaseRequest)).resolves.toEqual({
      ...release,
      idempotentReplay: true,
    });
    const archiveRepository = new PostgresAflTradePromotionBackedPublicArchiveRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const archiveRequest = {
      releaseId: release.releaseId,
      createdAt: '2026-08-09T11:07:00.000Z',
    };
    const publicArchive = await archiveRepository.build(archiveRequest);
    expect(publicArchive).toMatchObject({
      idempotentReplay: false,
      archive: {
        content: {
          releaseId: release.releaseId,
          factualCandidateId: release.candidateId,
          recordCount: 3,
          recordCounts: { transaction: 1, transfer: 1, pick_custody: 1 },
        },
      },
      projection: {
        content: {
          publicRecordCount: 3,
          publicArchiveId: publicArchive.archive.archiveId,
        },
      },
    });
    await expect(archiveRepository.build(archiveRequest)).resolves.toEqual({
      ...publicArchive,
      idempotentReplay: true,
    });
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_public_factual_archive_record
          (archive_id,ordinal,record_kind,record_id,canonical_record_sha256,record_sha256,
           club_ids,player_ids,search_text,record_canonical_json,record_digest_canonical_json,
           record_json)
         VALUES ($1,99,'transaction','late-record',$2,$3,'{}','{}','{}','{}','{}','{}')`,
        [publicArchive.archive.archiveId, digest('a'), digest('b')]
      )
    ).rejects.toThrow(/only be inserted while staged/i);
    const gate2Repository = new PostgresAflTradePromotionBackedGate2Repository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const stagedLineage = await gate2Repository.stage({
      factualCandidateId: release.candidateId,
      createdAt: '2026-08-10T00:00:04.000Z',
    });
    const candidateRow = await outcomesPool.query<{ manifest_json: unknown }>(
      `SELECT release.manifest_json
         FROM outcome_factual_release_candidate candidate
         JOIN outcome_release_manifest release ON release.release_id=candidate.target_release_id
        WHERE candidate.candidate_id=$1`,
      [release.candidateId]
    );
    const releaseManifest = aflTradePromotionBackedFactualReleaseSchema.parse(
      candidateRow.rows[0]?.manifest_json
    );
    const registryRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    await expect(
      registryRepository.register({
        expectedRevision: 0,
        manifest: releaseManifest,
        actor: 'fixture-release-registrar',
        evidenceId: `artifact:${digest('8')}`,
        occurredAt: '2026-08-10T00:00:08.000Z',
      })
    ).rejects.toThrow(/could not be persisted/i);
    expect(
      (
        await outcomesPool.query<{ revision: number }>(
          'SELECT revision FROM outcome_registry_head WHERE singleton_id=1'
        )
      ).rows[0]?.revision
    ).toBe(0);

    const lineage = parseAflTradePromotionBackedFactualLineage(
      (
        await outcomesPool.query<{ lineage_json: unknown }>(
          'SELECT lineage_json FROM outcome_corpus_factual_lineage WHERE lineage_id=$1',
          [stagedLineage.lineageId]
        )
      ).rows[0]?.lineage_json
    );
    await seedGate2Authority(lineage);
    const admission = await gate2Repository.admit({
      lineageId: lineage.lineageId,
      evaluatedAt: '2026-08-10T00:00:07.000Z',
    });
    expect(admission).toMatchObject({ status: 'admitted', idempotentReplay: false });
    await expect(
      gate2Repository.admit({
        lineageId: lineage.lineageId,
        evaluatedAt: '2026-08-10T00:00:07.500Z',
      })
    ).resolves.toEqual({ ...admission, idempotentReplay: true });
    const registered = await registryRepository.register({
      expectedRevision: 0,
      manifest: releaseManifest,
      actor: 'fixture-release-registrar',
      evidenceId: `artifact:${digest('8')}`,
      occurredAt: '2026-08-10T00:00:08.000Z',
    });
    expect(registered.revision).toBe(1);
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_promotion_backed_corpus_member
          (corpus_id,ordinal,promotion_id,record_kind,source_record_id,canonical_record_id,
           record_sha256)
         VALUES ($1,4,$2,'transfer','late-source-record','late-canonical-record',$3)`,
        [corpus.corpusId, left.promotionId, digest('f')]
      )
    ).rejects.toThrow(/open corpus/);
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_release_event_asset
          (release_id,ordinal,asset_version_id,record_sha256,record_canonical_json,membership_json)
         VALUES ($1,99,'late-event-asset',$2,'{}','{}')`,
        [release.releaseId, digest('f')]
      )
    ).rejects.toThrow(/finalized (?:release|promotion-backed) candidate|registered release/i);
    const counts = await outcomesPool.query<{
      promotions: string;
      corpora: string;
      event_versions: string;
      assets: string;
      custody: string;
      releases: string;
      release_candidates: string;
      release_members: string;
      factual_lineages: string;
      gate2_admissions: string;
      registry_events: string;
      public_archives: string;
      public_archive_records: string;
      valuations: string;
    }>(
      `SELECT
         (SELECT count(*) FROM outcome_external_canonical_promotion)::text AS promotions,
         (SELECT count(*) FROM outcome_promotion_backed_corpus)::text AS corpora,
         (SELECT count(*) FROM outcome_event_version)::text AS event_versions,
         (SELECT count(*) FROM outcome_event_asset)::text AS assets,
         (SELECT count(*) FROM outcome_pick_custody_observation)::text AS custody,
         (SELECT count(*) FROM outcome_release_manifest)::text AS releases,
         (SELECT count(*) FROM outcome_factual_release_candidate)::text AS release_candidates,
         ((SELECT count(*) FROM outcome_release_event_version) +
          (SELECT count(*) FROM outcome_release_event_asset) +
          (SELECT count(*) FROM outcome_release_pick_custody))::text AS release_members,
         (SELECT count(*) FROM outcome_corpus_factual_lineage)::text AS factual_lineages,
         (SELECT count(*) FROM outcome_corpus_factual_lineage_admission)::text AS gate2_admissions,
         (SELECT count(*) FROM outcome_registry_event)::text AS registry_events,
         (SELECT count(*) FROM outcome_public_factual_archive)::text AS public_archives,
         (SELECT count(*) FROM outcome_public_factual_archive_record)::text AS public_archive_records,
         (SELECT count(*) FROM outcome_valuation_publication_manifest)::text AS valuations`
    );
    expect(counts.rows[0]).toEqual({
      promotions: '1',
      corpora: '1',
      event_versions: '1',
      assets: '1',
      custody: '1',
      releases: '1',
      release_candidates: '1',
      release_members: '3',
      factual_lineages: '1',
      gate2_admissions: '1',
      registry_events: '1',
      public_archives: '1',
      public_archive_records: '3',
      valuations: '0',
    });
  });
});
