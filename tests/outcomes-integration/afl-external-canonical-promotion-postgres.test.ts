import { createSpecialEntitlementIdentityReplacement } from '@/server/aflTradeIntelligence/source/specialEntitlementIdentityReplacementContracts';
import { aflTradePromotionBackedArchiveSelectionSchema } from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import { createPostgresAflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';
import { createSpecialEntitlementRevision } from '@/server/aflTradeIntelligence/source/specialEntitlementRevisionContracts';
import { resolveSpecialEntitlementCustody } from '@/server/aflTradeIntelligence/source/resolveSpecialEntitlementCustody';
import { deriveAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createSpecialEntitlementAward, specialEntitlementAwardSchema } from '@/server/aflTradeIntelligence/source/specialEntitlementAwardContracts';
import { parseSpecialDraftEntitlement } from '@/server/aflTradeIntelligence/source/specialDraftEntitlement';
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
  createAflTradeExternalCanonicalPromotionRequest,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION, AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION, createAflTradeExternalIdentityResolution } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

describe.each(['day', 'year'] as const)('factual occurrence precision: %s', (precision) => {
  const reviewedDate = precision === 'day' ? '2025-10-15' : null;
  const databaseUrl =
    process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
    (() => {
      throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
    })();
  const schemaName = `afl_external_promotion_${precision}_${process.pid}_${Date.now()}`;
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
  const captureId = `source-capture:${digest('c')}`;
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
     VALUES ('AFLM',2010),('AFLM',2011),('AFLM',2012),('AFLM',2019),('AFLM',2020),('AFLM',2025)`
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
      `INSERT INTO outcome_source_capture_season(capture_id,competition,season_year)
        VALUES ($1,'AFLM',2010),($1,'AFLM',2011),($1,'AFLM',2019)`,
      [captureId]
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
      validFromSeason: 2010,
      validThroughSeason: 2025,
    };
    const authorityId = createAflTradeContentAddress(
      'reviewer-authority-evidence',
      authorityPayload
    );
    const authoritySha = authorityId.split(':')[1] ?? '';
    const authorityApprovalId = createAflTradeContentAddress(
      'governed-evidence-approval-decision',
      {
        authorityId,
      }
    );
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
             'external_candidate_promotion','AFLM',2010,2025,
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
          SET revision=revision+1,updated_at=$1
        WHERE singleton_id=1`,
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
        candidateId: candidate.candidateId,
        candidateSha256: candidate.candidateId.split(':')[1] ?? '',
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        draftEventCoverage: [],
        ...(precision === 'day'
          ? {
              schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
              transactionDateCoverage: [
                { transactionId, seasonYear: 2025, occurredOn: '2025-10-15' },
              ],
            }
          : {
              schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v4' as const,
              transactionDateCoverage: [{ transactionId, seasonYear: 2025, occurredOn: null }],
            }),
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
        outcomesPool.query<{ event_date: string | null; season_year: number }>(
          `SELECT version.event_date::TEXT AS event_date,event.season_year FROM outcome_event_version version JOIN outcome_event event USING(event_id) WHERE event_id=$1`,
          [transactionId]
        )
      ).resolves.toMatchObject({ rows: [{ event_date: reviewedDate, season_year: 2025 }] });
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
    it('registers reviewed awards independently of exercise, replays, and rejects invalid authority and provenance', async () => {
      const authority = (
        await outcomesPool.query<{
          authority_evidence_id: string;
          principal_ref: string;
        }>(`SELECT authority_evidence_id,principal_ref FROM outcome_operational_principal_authority
        WHERE role='afl_trade_canonical_promoter'`)
      ).rows[0]!;
      const repository = new PostgresAflTradeExternalCanonicalPromotionRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      );
      async function approve(
        award: ReturnType<typeof createSpecialEntitlementAward>,
        authorityId = authority.authority_evidence_id
      ) {
        const evidence = {
          schemaVersion: 'afl-trade-special-entitlement-award-approval/v1',
          authorityEvidenceId: authorityId,
          award,
        };
        const decisionId = createAflTradeContentAddress('review-decision', evidence);
        await outcomesPool.query(
          `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
          VALUES ($1,'special_draft_entitlement_award',$2,'approved','Reviewed fixture award',$3::jsonb,$4,'2026-08-09T12:00:00Z')`,
          [
            decisionId,
            award.entitlementId,
            canonicalizeAflTradeJson(evidence),
            authority.principal_ref,
          ]
        );
        return decisionId;
      }
      const withdrawals: (() => Promise<void>)[] = [];
      const exerciseChecks: (() => Promise<void>)[] = [];
      const revisionChecks: (() => Promise<void>)[] = [];
      const revisionWithdrawalChecks: (() => Promise<void>)[] = [];
      const committedIdentityChecks: (() => Promise<void>)[] = [];
      async function approveCustody(resolved: ReturnType<typeof resolveSpecialEntitlementCustody>) {
        await new PostgresAflTradeExternalReconciliationRepository(
          createPgAflOutcomeSqlClient(outcomesPool)
        ).persistCandidate({ candidate: resolved, identityResolutions: [] });
        const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
          candidate: resolved,
          proposedAt: '2026-08-09T12:04:00Z',
          draftEvents: [],
          transactionDates: resolved.content.transactions.map((record) => ({
            transactionId: record.transactionId,
            occurredOn: record.occurredOn,
          })),
        });
        const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
          candidateId: resolved.candidateId,
          proposalId: proposal.proposalId,
          proposalSha256: proposal.proposalId.split(':')[1]!,
          proposal,
          revision: 1,
          supersedesDecisionId: null,
          decision: 'approved',
          rationale: 'Reviewed fixture custody',
          authorityEvidenceId: authority.authority_evidence_id,
          decidedBy: authority.principal_ref,
          decidedAt: '2026-08-09T12:05:00Z',
        });
        await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
          createPgAflOutcomeSqlClient(outcomesPool)
        ).persistDecision({ candidate: resolved, proposal, decision });
        return { proposal, decision };
      }
      await outcomesPool.query(
        `INSERT INTO outcome_club(club_id,current_name,status) VALUES ('club-correction','Correction fixture club','approved')`
      );
      for (const [label, year] of [
        ['M1', 2011],
        ['CMP3 (Campbell Brown)', 2010],
        ['2020MIDR1 (Gold Coast concession)', 2019],
      ] as const) {
        const rightCaptureId = createAflTradeContentAddress('source-capture', {
          fixtureYear: year,
        });
        const rightBatchId = createAflTradeContentAddress('external-evidence-batch', {
          fixtureYear: year,
        });
        const rightEvidenceId = createAflTradeContentAddress('external-evidence', {
          fixtureYear: year,
        });
        await outcomesPool.query(
          `INSERT INTO outcome_source_capture_attempt
          (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
          SELECT $1,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json
          FROM outcome_source_capture_attempt WHERE attempt_id='attempt-promotion'`,
          [`attempt:${rightCaptureId}`]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
          access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
          SELECT $1,$2,$3,source_artifact_id,environment,provider,dataset,dataset_version,access_mechanism,capability_id,
          competition,$4,effective_at,captured_at,status,manifest_json FROM outcome_source_capture WHERE capture_id=$5`,
          [
            rightCaptureId,
            `attempt:${rightCaptureId}`,
            createAflTradeContentAddress('source-snapshot', { fixtureYear: year }),
            year,
            captureId,
          ]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_source_capture_season(capture_id,competition,season_year)
           VALUES ($1,'AFLM',$2),($1,'AFLM',$3) ON CONFLICT DO NOTHING`,
          [rightCaptureId, year, year + 1]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_external_evidence_batch
          (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
          VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,'{}')`,
          [
            rightBatchId,
            rightCaptureId,
            sha256AflTradeCanonicalJson([rightEvidenceId]),
            digest('0'),
          ]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_external_evidence_row(evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
          VALUES ($1,$2,1,'fixture-right','transaction','{}')`,
          [rightEvidenceId, rightBatchId]
        );
        await outcomesPool.query(
          `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2026-08-09T11:00:00Z' WHERE batch_id=$1`,
          [rightBatchId]
        );
        const award = createSpecialEntitlementAward({
          schemaVersion: 'afl-trade-special-entitlement-award/v1',
          environment: 'test_fixture',
          competition: 'AFLM',
          issuingAwardId: `fixture-award:${label}`,
          component: label,
          asset: parseSpecialDraftEntitlement(label, year)!,
          holderClubId: 'club-gws',
          awardYear: year,
          awardedOn: null,
          evidence: [
            {
              captureId: rightCaptureId,
              contentSha256: digest('1'),
              sourceUrl: 'https://www.draftguru.com.au/trades/promotion-fixture',
            },
          ],
        });
        const approvalDecisionId = await approve(award);
        const input = { award, approvalDecisionId };
        const results = await Promise.all([
          repository.registerSpecialEntitlementAward(input),
          repository.registerSpecialEntitlementAward(input),
        ]);
        expect(results.map((value) => value.idempotentReplay).sort()).toEqual([false, true]);
        expect(results[0]).toMatchObject({
          award,
          custodyPromoted: false,
          exerciseRegistered: false,
        });
        if (award.content.asset.entitlementType === 'expansion_compensation') {
          expect(results[0]!.award.content.asset.draftYear).toBeNull();
        }
        const tradeIds = [0, 1].map((index) =>
          createAflTradeContentAddress('external-transaction', {
            award: award.entitlementId,
            index,
          })
        );
        const transferIds = tradeIds.map((id) =>
          createAflTradeContentAddress('external-transfer', { transactionId: id })
        );
        const sourceCandidate = createAflTradeExternalReconciliationCandidate({
          ...candidateFixture().content,
          anchorSeasonYear: year,
          sourceBatchIds: [rightBatchId],
          transactions: tradeIds
            .map((id, index) => ({
              transactionId: id,
              providerEventId: `fixture:${label}:${index}`,
              seasonYear: year,
              occurredOn: precision === 'day' ? `${year}-10-${index + 10}` : null,
              transactionType: 'trade' as const,
              title: `Fixture ${label} custody ${index}`,
              parties: ['club-gws', 'club-western-bulldogs'],
              transferIds: [transferIds[index]!],
              status: 'single_source' as const,
              evidenceIds: [rightEvidenceId],
            }))
            .sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
          transfers: transferIds
            .map((id, index) => ({
              transferId: id,
              transactionId: tradeIds[index]!,
              fromClubId: index === 0 ? 'club-gws' : 'club-western-bulldogs',
              toClubId: index === 0 ? 'club-western-bulldogs' : 'club-gws',
              asset:
                index === 1 && award.content.asset.entitlementType === 'expansion_compensation'
                  ? {
                      kind: 'pick_entitlement' as const,
                      pickId: createAflTradeContentAddress('draft-pick', {
                        fixtureRight: award.entitlementId,
                      }),
                      draftYear: year + 1,
                      draftType: 'national',
                      nominalRound: 1,
                      nominalPick: 27,
                      originalClubId: 'club-gws',
                      recordedLabel: 'Pick 27',
                    }
                  : award.content.asset,
              status: 'unresolved' as const,
              evidenceIds: [rightEvidenceId],
            }))
            .sort((a, b) => a.transferId.localeCompare(b.transferId)),
          draftSelections: [],
          pickCustody: [],
          pickLineage: [],
          issues: transferIds.map((transferId, index) => ({
            code: 'lineage_unresolved' as const,
            severity: 'blocking' as const,
            subjectKey: `lineage:${transferId}`,
            detail: index === 1 && award.content.asset.entitlementType === 'expansion_compensation'
              ? 'The transferred pick entitlement is not uniquely resolved to stable custody.'
              : 'Special entitlement requires independently resolved award, activation and custody evidence.',
            evidenceIds: [rightEvidenceId],
          })).sort((a, b) => a.subjectKey.localeCompare(b.subjectKey)),
          reconciledAt: '2026-08-09T12:02:00Z',
        });
        const reconciliation = new PostgresAflTradeExternalReconciliationRepository(
          createPgAflOutcomeSqlClient(outcomesPool)
        );
        await reconciliation.persistCandidate({
          candidate: sourceCandidate,
          identityResolutions: [],
        });
        const resolved = resolveSpecialEntitlementCustody({
          candidate: sourceCandidate,
          reconciledAt: '2026-08-09T12:03:00Z',
          bindings: transferIds.map((id, index) => ({
            transferId: id,
            award,
            awardApprovalDecisionId: approvalDecisionId,
            predecessorTransferId: index === 0 ? null : transferIds[0]!,
          })),
        });
        for (const failure of ['wrong_holder', 'branch', 'chronology'] as const) {
          const badSource = createAflTradeExternalReconciliationCandidate({
            ...sourceCandidate.content,
            transfers: sourceCandidate.content.transfers.map((record) =>
              failure === 'branch'
                ? { ...record, fromClubId: 'club-gws', toClubId: 'club-western-bulldogs' }
                : record
            ),
            transactions: sourceCandidate.content.transactions.map((record) =>
              failure === 'chronology'
                ? {
                    ...record,
                    occurredOn:
                      record.transactionId === tradeIds[0] ? `${year}-12-01` : `${year}-01-01`,
                  }
                : record
            ),
          });
          await reconciliation.persistCandidate({ candidate: badSource, identityResolutions: [] });
          const bad = resolveSpecialEntitlementCustody({
            candidate: badSource,
            reconciledAt: '2026-08-09T12:03:00Z',
            bindings: transferIds.map((id, index) => ({
              transferId: id,
              award,
              awardApprovalDecisionId: approvalDecisionId,
              predecessorTransferId:
                failure === 'branch'
                  ? null
                  : failure === 'wrong_holder'
                    ? index === 1
                      ? null
                      : transferIds[1]!
                    : index === 0
                      ? null
                      : transferIds[0]!,
            })),
          });
          const { decision: badDecision } = await approveCustody(bad);
          await expect(
            repository.promote({
              candidateId: bad.candidateId,
              approvalDecisionId: badDecision.decisionId,
            })
          ).rejects.toThrow(
            failure === 'chronology'
              ? /chronology is impossible/
              : failure === 'branch'
                ? /one_root/
                : /awarded holder/
          );
          expect(
            (
              await outcomesPool.query(
                'SELECT promotion_id FROM outcome_external_canonical_promotion WHERE candidate_id=$1',
                [bad.candidateId]
              )
            ).rows
          ).toEqual([]);
          expect(
            (
              await outcomesPool.query(
                'SELECT transfer_id FROM outcome_special_entitlement_custody WHERE entitlement_id=$1',
                [award.entitlementId]
              )
            ).rows
          ).toEqual([]);
        }
        const { decision } = await approveCustody(resolved);
        const promoted = await repository.promote({
          candidateId: resolved.candidateId,
          approvalDecisionId: decision.decisionId,
        });
        expect(promoted).toMatchObject({
          status: 'finalized',
          transactionCount: 2,
          transferCount: 2,
        });
        const baselineAsset = (await outcomesPool.query<{ asset_version_id: string }>(
          'SELECT asset_version_id FROM outcome_special_entitlement_custody WHERE entitlement_id=$1 ORDER BY transfer_id LIMIT 1',
          [award.entitlementId]
        )).rows[0]!.asset_version_id;
        await expect.soft(outcomesPool.query(
          'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
          [award.entitlementId, baselineAsset, '2026-08-09T11:59:59.999Z', [rightCaptureId]]
        )).rejects.toThrow(/cutoff/);
        expect((await outcomesPool.query<{ fact: unknown }>(
          'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
          [award.entitlementId, baselineAsset, '2026-08-09T12:00:00Z', [rightCaptureId]]
        )).rows[0]!.fact).toMatchObject({ award });

        await expect(
          repository.promote({
            candidateId: resolved.candidateId,
            approvalDecisionId: decision.decisionId,
          })
        ).resolves.toMatchObject({ idempotentReplay: true });
        const custody = await outcomesPool.query(
          `SELECT chain.transfer_id,chain.predecessor_transfer_id,asset.kind,asset.pick_id,
          asset.special_entitlement_id,version.event_date::TEXT AS event_date,event.season_year
          FROM outcome_special_entitlement_custody chain JOIN outcome_event_asset asset USING(asset_version_id)
          JOIN outcome_event_version version USING(event_version_id) JOIN outcome_event event USING(event_id)
          WHERE chain.entitlement_id=$1 ORDER BY chain.predecessor_transfer_id NULLS FIRST`,
          [award.entitlementId]
        );
        expect(custody.rows).toEqual(
          transferIds.map((id, index) => ({
            transfer_id: id,
            predecessor_transfer_id: index === 0 ? null : transferIds[0],
            kind: 'list_right',
            pick_id: null,
            special_entitlement_id: award.entitlementId,
            event_date: precision === 'day' ? `${year}-10-${index + 10}` : null,
            season_year: year,
          }))
        );
        exerciseChecks.push(async () => {
          // Seed identity/source parents only; canonical draft records use the promotion owner.
          const playerId = `fixture-player:${award.entitlementId}`;
          const selectionYear = award.content.asset.draftYear ?? year + 1;
          const mini = award.content.asset.entitlementType === 'mini_draft';
          const identityId = createAflTradeContentAddress('review-decision', { playerId });
          await outcomesPool.query(
            `INSERT INTO outcome_player(player_id,display_name,status) VALUES ($1,'Lifecycle fixture player','approved')`,
            [playerId]
          );
          await outcomesPool.query(
            `INSERT INTO outcome_review_decision
            (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,canonical_record_type,canonical_record_id)
            VALUES ($1,'external_provider_identity_fixture',$2,'approved','Fixture identity parent','{}',$3,'2026-08-09T12:05:00Z','player',$2)`,
            [identityId, playerId, authority.principal_ref]
          );
          const resolution = createAflTradeExternalIdentityResolution({
            schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
            provider: 'draftguru', entityKind: 'player',
            sourceIdentity: { nativeId: playerId, recordedName: 'Lifecycle fixture player' },
            canonicalId: playerId, reviewDecisionId: identityId,
            reviewDecisionSha256: identityId.split(':')[1]!,
            decidedAt: '2026-08-09T12:05:00.000Z', status: 'current_approved',
          });
          const selectionCaptureId = createAflTradeContentAddress('source-capture', { playerId });
          const selectionBatchId = createAflTradeContentAddress('external-evidence-batch', { playerId });
          const selectionEvidenceId = createAflTradeContentAddress('external-evidence', { playerId });
          await outcomesPool.query(
            `INSERT INTO outcome_source_capture_attempt
             (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
             SELECT $1,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json
             FROM outcome_source_capture_attempt WHERE attempt_id='attempt-promotion'`,
            [`attempt:${selectionCaptureId}`]
          );
          await outcomesPool.query(
            `INSERT INTO outcome_source_capture
            (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
             access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
             SELECT $1,$5,$2,source_artifact_id,environment,provider,dataset,dataset_version,
             access_mechanism,capability_id,competition,$3,effective_at,captured_at,status,manifest_json
             FROM outcome_source_capture WHERE capture_id=$4`,
            [selectionCaptureId, createAflTradeContentAddress('source-snapshot', { playerId }), selectionYear, rightCaptureId, `attempt:${selectionCaptureId}`]
          );
          await outcomesPool.query(
            `INSERT INTO outcome_external_evidence_batch
            (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
            VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,'{}')`,
            [selectionBatchId, selectionCaptureId, sha256AflTradeCanonicalJson([selectionEvidenceId]), digest('0')]
          );
          await outcomesPool.query(
            `INSERT INTO outcome_external_evidence_row(evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
             VALUES ($1,$2,1,'fixture-selection','draft_selection','{}')`, [selectionEvidenceId, selectionBatchId]
          );
          await outcomesPool.query(
            `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2026-08-09T11:00:00Z' WHERE batch_id=$1`,
            [selectionBatchId]
          );
          const sourceSelectionId = createAflTradeContentAddress('external-draft-selection', { playerId });
          const draftType = mini ? 'mini_draft' : 'national';
          const selectionCandidate = createAflTradeExternalReconciliationCandidate({
            ...sourceCandidate.content,
            anchorSeasonYear: selectionYear,
            sourceBatchIds: [selectionBatchId],
            reconciledAt: '2026-08-09T12:05:00.000Z',
            identityResolutionIds: [resolution.resolutionId],
            transactions: [], transfers: [], pickCustody: [], pickLineage: [], issues: [],
            draftSelections: [{
              selectionId: sourceSelectionId, draftYear: selectionYear, draftType,
              selectionNumber: 1, roundNumber: 1,
              pickId: createAflTradeContentAddress('draft-pick', { sourceSelectionId }),
              playerId, clubId: 'club-gws', status: 'single_source',
              supportingProviders: ['draftguru'], evidenceIds: [selectionEvidenceId],
            }],
          });
          await reconciliation.persistCandidate({ candidate: selectionCandidate, identityResolutions: [resolution] });
          const selectionProposal = deriveAflTradeExternalCanonicalPromotionProposal({
            candidate: selectionCandidate, proposedAt: '2026-08-09T12:05:00Z',
            draftEvents: [{ draftYear: selectionYear, draftType,
              eventDate: `${selectionYear}-11-20`, officialName: 'Reviewed lifecycle fixture selection' }],
          });
          const selectionDecision = createAflTradeExternalCanonicalPromotionReviewDecision({
            candidateId: selectionCandidate.candidateId, proposalId: selectionProposal.proposalId,
            proposalSha256: selectionProposal.proposalId.split(':')[1]!, proposal: selectionProposal,
            revision: 1, supersedesDecisionId: null, decision: 'approved',
            rationale: 'Reviewed fixture selection promotion', authorityEvidenceId: authority.authority_evidence_id,
            decidedBy: authority.principal_ref, decidedAt: '2026-08-09T12:05:00Z',
          });
          await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
            createPgAflOutcomeSqlClient(outcomesPool)
          ).persistDecision({ candidate: selectionCandidate, proposal: selectionProposal, decision: selectionDecision });
          const selectionPromotion = await repository.promote({
            candidateId: selectionCandidate.candidateId, approvalDecisionId: selectionDecision.decisionId,
          });
          const selectionId = (await outcomesPool.query<{ canonical_record_id: string }>(
            `SELECT canonical_record_id FROM outcome_external_canonical_promotion_record
             WHERE promotion_id=$1 AND record_kind='draft_selection' AND source_record_id=$2`,
            [selectionPromotion.promotionId, sourceSelectionId]
          )).rows[0]!.canonical_record_id;
          async function reviewed<T extends Record<string, unknown>>(
            record: T,
            authorityId = authority.authority_evidence_id
          ) {
            const evidence = {
              schemaVersion: 'afl-trade-special-entitlement-lifecycle-approval/v1',
              authorityEvidenceId: authorityId,
              record,
            };
            const approvalDecisionId = createAflTradeContentAddress('review-decision', evidence);
            await outcomesPool.query(
              `INSERT INTO outcome_review_decision
              (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
              VALUES ($1,$2,$3,'approved','Reviewed lifecycle fixture',$4::jsonb,$5,'2026-08-09T12:05:30Z') ON CONFLICT DO NOTHING`,
              [
                approvalDecisionId,
                `special_draft_entitlement_${record.kind}`,
                record.entitlementId,
                canonicalizeAflTradeJson(evidence),
                authority.principal_ref,
              ]
            );
            return { record, approvalDecisionId };
          }
          const base = {
            schemaVersion: 'afl-trade-special-entitlement-lifecycle/v1',
            entitlementId: award.entitlementId,
            evidence: award.content.evidence,
          };
          const exercise = {
            ...base,
            kind: 'exercise',
            selectionId,
            terminalTransferId: transferIds[1],
          };
          const exerciseInput = await reviewed(exercise);
          const activation = {
            ...base,
            kind: 'activation',
            useYear: selectionYear,
            noticeYear: precision === 'year' ? null : selectionYear,
            noticedOn: null,
            rule: 'deferred_nomination',
            expiresAfterYear: year + 5,
          };
          const activationInput = await reviewed(activation);
          if (award.content.asset.entitlementType === 'expansion_compensation') {
            await expect(
              repository.registerSpecialEntitlementLifecycle(exerciseInput)
            ).rejects.toThrow(/reviewed activation/);
            const registered =
              await repository.registerSpecialEntitlementLifecycle(activationInput);
            expect(registered.record).toMatchObject({ noticedOn: null, useYear: selectionYear });
            await expect(
              repository.registerSpecialEntitlementLifecycle(activationInput)
            ).resolves.toMatchObject({ idempotentReplay: true });
          } else {
            await expect(
              repository.registerSpecialEntitlementLifecycle(activationInput)
            ).rejects.toThrow(/only to reviewed compensation/);
          }
          await expect(
            repository.registerSpecialEntitlementLifecycle(
              await reviewed({ ...exercise, terminalTransferId: transferIds[0] })
            )
          ).rejects.toThrow(/terminal custody holder/);
          await expect(
            repository.registerSpecialEntitlementLifecycle(
              await reviewed(exercise, 'missing-authority')
            )
          ).rejects.toThrow(/scoped authority/);
          await expect(
            repository.registerSpecialEntitlementLifecycle(
              await reviewed({
                ...exercise,
                evidence: [{ ...base.evidence[0], contentSha256: digest('9') }],
              })
            )
          ).rejects.toThrow(/capture, digest/);
          await expect(
            createPgAflOutcomeSqlClient(outcomesPool).transaction(async (tx) => {
              await tx.query(
                'SELECT * FROM register_outcome_special_entitlement_lifecycle($1::jsonb,$2)',
                [canonicalizeAflTradeJson(exercise), exerciseInput.approvalDecisionId]
              );
              // A canonical correction cannot enter while this uncommitted exercise owns the event.
              await expect(outcomesPool.query(
                'SELECT lock_outcome_special_dependency_event(v.event_id) FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id) WHERE s.selection_id=$1',
                [exercise.selectionId]
              )).rejects.toMatchObject({ code: '40001' });
              throw new Error('Fixture downstream failure');
            })
          ).rejects.toThrow('Fixture downstream failure');
          expect(
            (
              await outcomesPool.query(
                `SELECT count(*)::integer AS count FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=$1 AND kind='exercise'`,
                [award.entitlementId]
              )
            ).rows[0].count
          ).toBe(0);
          const eventWriter = await outcomesPool.connect();
          try {
            await eventWriter.query('BEGIN');
            await eventWriter.query(
              "SELECT pg_advisory_xact_lock(hashtextextended('outcome-event:'||v.event_id,0)) FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id) WHERE s.selection_id=$1",
              [exercise.selectionId]);
            await expect(repository.registerSpecialEntitlementLifecycle(exerciseInput))
              .rejects.toMatchObject({ code: '40001' });
          } finally {
            await eventWriter.query('ROLLBACK');
            eventWriter.release();
          }
          const registered = await Promise.all([
            repository.registerSpecialEntitlementLifecycle(exerciseInput),
            repository.registerSpecialEntitlementLifecycle(exerciseInput),
          ]);
          expect(registered.map((item) => item.idempotentReplay).sort()).toEqual([false, true]);
          expect(registered[0]).toMatchObject({
            historicalFeatureEligible: false,
            record: exercise,
          });
          await expect(
            outcomesPool.query(
              `INSERT INTO outcome_special_entitlement_custody
            (transfer_id,entitlement_id,asset_version_id,predecessor_transfer_id)
            SELECT 'forbidden-successor',entitlement_id,asset_version_id,transfer_id FROM outcome_special_entitlement_custody WHERE transfer_id=$1`,
              [transferIds[1]]
            )
          ).rejects.toThrow(/Exercised right/);
          const competingAward = createSpecialEntitlementAward({
            ...award.content,
            issuingAwardId: `competing:${award.content.issuingAwardId}`,
          });
          const competingApproval = await approve(competingAward);
          await expect(
            createPgAflOutcomeSqlClient(outcomesPool).transaction(async (tx) => {
              await tx.query(
                'SELECT * FROM register_outcome_special_entitlement_award($1::jsonb,$2)',
                [canonicalizeAflTradeJson(competingAward), competingApproval]
              );
              await tx.query(
                'SELECT * FROM register_outcome_special_entitlement_lifecycle($1::jsonb,$2)',
                [
                  canonicalizeAflTradeJson({
                    ...exercise,
                    entitlementId: competingAward.entitlementId,
                  }),
                  exerciseInput.approvalDecisionId,
                ]
              );
            })
          ).rejects.toThrow(/already exercises another right/);
          const read = await outcomesPool.query<{ facts: Record<string, unknown> }>(
            `SELECT read_outcome_special_entitlement_lifecycle($1,$2) AS facts`,
            [award.entitlementId, '2026-08-09T12:06:00Z']
          );
          await expect(
            outcomesPool.query(
              'SELECT read_outcome_special_entitlement_lifecycle($1,$2,$3::text[])',
              [award.entitlementId, '2026-08-09T12:06:00Z', []]
            )
          ).rejects.toThrow(/absent from the factual release/);
          expect(read.rows[0].facts.exercise).toEqual({
            record: exercise,
            approvalDecisionId: exerciseInput.approvalDecisionId,
          });
          expect(
            (
              await outcomesPool.query(
                `SELECT read_outcome_special_entitlement_lifecycle($1,$2) AS facts`,
                [award.entitlementId, '2026-08-09T12:05:00Z']
              )
            ).rows[0].facts
          ).toEqual({});
          await expect(
            outcomesPool.query(
              `UPDATE outcome_special_entitlement_lifecycle SET record_json='{}' WHERE entitlement_id=$1`,
              [award.entitlementId]
            )
          ).rejects.toThrow();
          revisionChecks.push(async () => {
            const original = await repository.loadSpecialEntitlementRevision(award.entitlementId);
            expect(original.content.revision).toBe(1);
            expect(original.content.state.exercise?.record).toEqual(exercise);
            const correctedAward = createSpecialEntitlementAward({
              ...award.content,
              awardedOn: `${year}-01-12`,
            });
            const correctedApproval = await approve(correctedAward);
            const revised = createSpecialEntitlementRevision({
              ...original.content,
              revision: 2,
              supersedesRevisionId: original.revisionId,
              reason: 'Reviewed fixture establishes award date',
              changedFields: ['award'],
              proposedAt: '2026-08-09T12:06:00Z',
              state: {
                ...original.content.state,
                award: { award: correctedAward, approvalDecisionId: correctedApproval },
              },
            });
            async function approveRevision(revision: typeof revised, decidedAt = '2026-08-09T12:06:30Z') {
              const evidence = {
                schemaVersion: 'afl-trade-special-entitlement-revision-approval/v1',
                revision,
                authorityEvidenceId: authority.authority_evidence_id,
              };
              const approvalDecisionId = createAflTradeContentAddress('review-decision', evidence);
              await outcomesPool.query(
                `INSERT INTO outcome_review_decision
                (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
                VALUES ($1,'special_draft_entitlement_revision',$2,'approved','Reviewed correction fixture',$3::jsonb,$4,$5::timestamptz) ON CONFLICT DO NOTHING`,
                [
                  approvalDecisionId,
                  revision.revisionId,
                  canonicalizeAflTradeJson(evidence),
                  authority.principal_ref,
                  decidedAt,
                ]
              );
              return { revision, approvalDecisionId };
            }
            const correctionInput = await approveRevision(revised);
            const invalid = createSpecialEntitlementRevision({
              ...revised.content,
              changedFields: ['award', 'custody'],
              state: {
                ...revised.content.state,
                custody: revised.content.state.custody.map((edge, index) =>
                  index === 0 ? { ...edge, assetVersionId: 'unavailable-corrected-asset' } : edge
                ),
              },
            });
            await expect(
              repository.registerSpecialEntitlementRevision(await approveRevision(invalid))
            ).rejects.toThrow(/exact current canonical assets/);
            expect(
              (
                await outcomesPool.query(
                  'SELECT count(*)::integer AS count FROM outcome_special_entitlement_revision WHERE entitlement_id=$1',
                  [award.entitlementId]
                )
              ).rows[0].count
            ).toBe(0);
            await outcomesPool.query(
              `INSERT INTO outcome_review_decision
              (decision_id,subject_type,subject_id,decision,decided_by,rationale,evidence_json,supersedes_decision_id,decided_at)
              VALUES ($1,'special_draft_entitlement_award',$2,'withdrawn',$3,'Fixture withdrawal before correction','{}',$4,'2026-08-09T12:01:00Z') ON CONFLICT DO NOTHING`,
              [
                `withdrawal:${approvalDecisionId}`,
                award.entitlementId,
                authority.principal_ref,
                approvalDecisionId,
              ]
            );
            const results = await Promise.all([
              repository.registerSpecialEntitlementRevision(correctionInput),
              repository.registerSpecialEntitlementRevision(correctionInput),
            ]);
            expect(results.map((item) => item.idempotentReplay).sort()).toEqual([false, true]);
            expect(await repository.loadSpecialEntitlementRevision(award.entitlementId)).toEqual(
              revised
            );
            const currentAssetId = revised.content.state.custody[0]!.assetVersionId;
            const currentRead = await outcomesPool.query<{
              fact: { revision: unknown; award: unknown };
            }>(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
              [award.entitlementId, currentAssetId, '2026-08-09T12:07:00Z', [rightCaptureId]]
            );
            expect(currentRead.rows[0]!.fact).toMatchObject({
              revision: revised,
              award: correctedAward,
            });
            expect(
              (
                await outcomesPool.query(
                  'SELECT award_json FROM outcome_special_entitlement_award WHERE entitlement_id=$1',
                  [award.entitlementId]
                )
              ).rows[0].award_json
            ).toEqual(award);
            await expect(
              repository.registerSpecialEntitlementLifecycle(exerciseInput)
            ).rejects.toThrow(/current revision owner/);
            await expect(
              outcomesPool.query(
                'DELETE FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=$1',
                [award.entitlementId]
              )
            ).rejects.toThrow(/exactly match/);
            const stale = createSpecialEntitlementRevision({
              ...revised.content,
              reason: 'Competing successor of the original state',
            });
            await expect(
              repository.registerSpecialEntitlementRevision(await approveRevision(stale))
            ).rejects.toThrow(/exact current predecessor/);
            let currentRevision = revised;
            if (currentRevision.content.state.activation?.record.kind === 'activation') {
              const activationRecord = {
                ...currentRevision.content.state.activation.record,
                noticeYear: selectionYear,
                noticedOn: `${selectionYear}-03-01`,
              };
              const activationApproval = await reviewed(activationRecord);
              currentRevision = createSpecialEntitlementRevision({
                ...currentRevision.content,
                revision: currentRevision.content.revision + 1,
                supersedesRevisionId: currentRevision.revisionId,
                reason: 'Reviewed fixture establishes activation notice day',
                changedFields: ['activation'],
                state: {
                  ...currentRevision.content.state,
                  activation: {
                    record: activationRecord,
                    approvalDecisionId: activationApproval.approvalDecisionId,
                  },
                },
              });
              await repository.registerSpecialEntitlementRevision(
                await approveRevision(currentRevision)
              );
              expect(
                (await repository.loadSpecialEntitlementRevision(award.entitlementId)).content.state
                  .activation?.record
              ).toMatchObject({ noticedOn: `${selectionYear}-03-01` });
              expect(
                (
                  await outcomesPool.query(
                    `SELECT record_json->'noticedOn' AS day FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=$1 AND kind='activation'`,
                    [award.entitlementId]
                  )
                ).rows[0].day
              ).toBeNull();
            }
            const correctedSource = createAflTradeExternalReconciliationCandidate({
              ...sourceCandidate.content,
              transactions: sourceCandidate.content.transactions.map((record) => ({
                ...record,
                title: `${record.title} corrected custody`,
                parties: ['club-correction', 'club-gws'],
              })),
              transfers: sourceCandidate.content.transfers.map((record) => ({
                ...record,
                fromClubId:
                  record.fromClubId === 'club-western-bulldogs'
                    ? 'club-correction'
                    : record.fromClubId,
                toClubId:
                  record.toClubId === 'club-western-bulldogs' ? 'club-correction' : record.toClubId,
              })),
            });
            await reconciliation.persistCandidate({
              candidate: correctedSource,
              identityResolutions: [],
            });
            const correctedCandidate = resolveSpecialEntitlementCustody({
              candidate: correctedSource,
              reconciledAt: '2026-08-09T12:03:00Z',
              bindings: transferIds.map((id, index) => ({
                transferId: id,
                award: correctedAward,
                awardApprovalDecisionId: correctedApproval,
                predecessorTransferId: index === 0 ? null : transferIds[0]!,
              })),
            });
            const correctedPromotionReview = await approveCustody(correctedCandidate);
            const promotionInput = {
              candidateId: correctedCandidate.candidateId,
              approvalDecisionId: correctedPromotionReview.decision.decisionId,
            };
            const preview = await repository.previewSpecialEntitlementCustody(
              promotionInput,
              award.entitlementId
            );
            expect(preview.promotionEligible).toBe(false);
            const custodyRevision = createSpecialEntitlementRevision({
              ...currentRevision.content,
              revision: currentRevision.content.revision + 1,
              supersedesRevisionId: currentRevision.revisionId,
              reason: 'Reviewed fixture corrects intermediary club and revalidates exercise',
              changedFields: ['custody'],
              state: {
                ...currentRevision.content.state,
                custody: currentRevision.content.state.custody.map((edge) =>
                  preview.custody.find((item) => item.transferId === edge.transferId)!
                ),
              },
            });
            const beforeCustodyCorrection = currentRevision;
            const custodyInput = await approveRevision(custodyRevision, '2026-08-09T12:06:40Z');
            await expect(
              repository.promoteWithSpecialEntitlementRevisions({
                promotion: promotionInput,
                revisions: [{ ...custodyInput, approvalDecisionId: 'missing-correction-approval' }],
              })
            ).rejects.toThrow(/current reviewed approval/);
            expect(
              (
                await outcomesPool.query(
                  'SELECT count(*)::integer AS count FROM outcome_external_canonical_promotion WHERE candidate_id=$1',
                  [correctedCandidate.candidateId]
                )
              ).rows[0].count
            ).toBe(0);
            const atomic = await repository.promoteWithSpecialEntitlementRevisions({
              promotion: promotionInput,
              revisions: [custodyInput],
            });
            expect(atomic.promotion).toMatchObject({ status: 'finalized', transferCount: 2 });
            const atomicReplay = await repository.promoteWithSpecialEntitlementRevisions({
              promotion: promotionInput,
              revisions: [custodyInput],
            });
            expect(atomicReplay.promotion.idempotentReplay).toBe(true);
            expect(atomicReplay.revisions[0]!.idempotentReplay).toBe(true);
            currentRevision = custodyRevision;
            await expect.soft(outcomesPool.query<{ fact: unknown }>(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
              [award.entitlementId, beforeCustodyCorrection.content.state.custody[0]!.assetVersionId,
                '2026-08-09T12:06:35Z', [rightCaptureId]]
            )).resolves.toMatchObject({ rows: [{ fact: { revision: beforeCustodyCorrection } }] });

            const correctedRead = await outcomesPool.query<{
              fact: { revision: unknown; lifecycle: { exercise: unknown } };
            }>(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
              [
                award.entitlementId,
                currentRevision.content.state.custody[0]!.assetVersionId,
                '2026-08-09T12:07:00Z',
                [rightCaptureId],
              ]
            );
            expect(correctedRead.rows[0]!.fact).toMatchObject({
              revision: custodyRevision,
              lifecycle: { exercise: currentRevision.content.state.exercise },
            });
            const historicalRead = await outcomesPool.query<{ fact: {
              revisionStatus: string;
              revision: { content: { state: { custody: { assetVersionId: string }[] } } };
              currentRevision: unknown;
            } }>(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
              [award.entitlementId, currentAssetId, '2026-08-09T12:07:00Z', [rightCaptureId]]
            );
            expect(historicalRead.rows[0]!.fact).toMatchObject({
              revisionStatus: 'superseded', currentRevision: custodyRevision,
            });
            expect(historicalRead.rows[0]!.fact.revision.content.state.custody)
              .toContainEqual(expect.objectContaining({ assetVersionId: currentAssetId }));
            await expect(outcomesPool.query(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
              [award.entitlementId, 'asset:unknown', '2026-08-09T12:07:00Z', [rightCaptureId]]
            )).rejects.toThrow(/absent from retained entitlement revision history/);
            await expect(outcomesPool.query(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
              [award.entitlementId, currentAssetId, '2026-08-09T12:07:00Z', []]
            )).rejects.toThrow(/absent from the factual release source set/);
            const replacementPlayerId = `${playerId}:corrected`;
            const replacementIdentityId = createAflTradeContentAddress('review-decision', { replacementPlayerId });
            await outcomesPool.query(`INSERT INTO outcome_player(player_id,display_name,status) VALUES ($1,'Corrected fixture player','approved')`, [replacementPlayerId]);
            await outcomesPool.query(
              `INSERT INTO outcome_review_decision
               (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,canonical_record_type,canonical_record_id)
               VALUES ($1,'external_provider_identity_fixture',$2,'approved','Corrected fixture identity','{}',$3,'2026-08-09T12:05:00Z','player',$2)`,
              [replacementIdentityId, replacementPlayerId, authority.principal_ref]
            );
            const replacementIdentity = createAflTradeExternalIdentityResolution({
              ...resolution.content, canonicalId: replacementPlayerId,
              sourceIdentity: { nativeId: replacementPlayerId, recordedName: 'Corrected fixture player' },
              reviewDecisionId: replacementIdentityId, reviewDecisionSha256: replacementIdentityId.split(':')[1]!,
            });
            const replacementCandidate = createAflTradeExternalReconciliationCandidate({
              ...selectionCandidate.content, identityResolutionIds: [replacementIdentity.resolutionId],
              draftSelections: selectionCandidate.content.draftSelections.map((record) => ({ ...record, playerId: replacementPlayerId })),
            });
            await reconciliation.persistCandidate({ candidate: replacementCandidate, identityResolutions: [replacementIdentity] });
            const replacementProposal = deriveAflTradeExternalCanonicalPromotionProposal({
              candidate: replacementCandidate, proposedAt: '2026-08-09T12:05:00Z',
              draftEvents: [{ draftYear: selectionYear, draftType, eventDate: `${selectionYear}-11-20`, officialName: 'Reviewed corrected fixture selection' }],
            });
            const replacementDecision = createAflTradeExternalCanonicalPromotionReviewDecision({
              ...selectionDecision.content, candidateId: replacementCandidate.candidateId,
              proposalId: replacementProposal.proposalId, proposalSha256: replacementProposal.proposalId.split(':')[1]!,
              proposal: replacementProposal,
            });
            await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(createPgAflOutcomeSqlClient(outcomesPool))
              .persistDecision({ candidate: replacementCandidate, proposal: replacementProposal, decision: replacementDecision });
            const replacementPromotionInput = { candidateId: replacementCandidate.candidateId, approvalDecisionId: replacementDecision.decisionId };
            const replacementRequest = createAflTradeExternalCanonicalPromotionRequest({ ...replacementPromotionInput, proposalId: replacementProposal.proposalId });
            const originalSelection = (await outcomesPool.query<{ event_id: string; event_version_id: string; version: number }>(
              `SELECT version.event_id,version.event_version_id,version.version FROM outcome_draft_selection selection
               JOIN outcome_event_version version USING(event_version_id) WHERE selection.selection_id=$1`, [selectionId]
            )).rows[0]!;
            const replacementVersionId = createAflTradeContentAddress('event-version', {
              promotionId: replacementRequest.promotionId, eventId: originalSelection.event_id,
              version: originalSelection.version + 1, supersedesVersionId: originalSelection.event_version_id,
              coverage: replacementProposal.content.draftEventCoverage[0],
            });
            const replacementSelectionId = createAflTradeContentAddress('draft-selection', {
              promotionId: replacementRequest.promotionId, eventVersionId: replacementVersionId, sourceSelectionId,
            });
            const replacementExercise = await reviewed({ ...currentRevision.content.state.exercise!.record, selectionId: replacementSelectionId });
            const exerciseRevision = createSpecialEntitlementRevision({
              ...currentRevision.content, revision: currentRevision.content.revision + 1,
              supersedesRevisionId: currentRevision.revisionId, reason: 'Correct the selected player through a reviewed canonical draft version',
              changedFields: ['exercise'], state: { ...currentRevision.content.state, exercise: replacementExercise },
            });
            const exerciseCorrectionInput = await approveRevision(exerciseRevision);
            await expect(repository.promoteWithSpecialEntitlementRevisions({
              promotion: replacementPromotionInput,
              revisions: [{ ...exerciseCorrectionInput, approvalDecisionId: 'missing-exercise-correction-approval' }],
            })).rejects.toThrow();
            expect((await outcomesPool.query<{ selection_id: string }>(
              'SELECT selection_id FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=$1', [award.entitlementId]
            )).rows).toEqual([{ selection_id: selectionId }]);
            await expect(repository.promote(replacementPromotionInput)).rejects.toThrow(/atomic replacement of dependent special-entitlement facts/);
            const changedExercise = await repository.promoteWithSpecialEntitlementRevisions({
              promotion: replacementPromotionInput, revisions: [exerciseCorrectionInput],
            });
            expect(changedExercise.revisions[0]!.idempotentReplay).toBe(false);
            currentRevision = exerciseRevision;
            const replayedExercise = await repository.promoteWithSpecialEntitlementRevisions({
              promotion: replacementPromotionInput, revisions: [exerciseCorrectionInput],
            });
            expect(replayedExercise.promotion.idempotentReplay).toBe(true);
            expect(replayedExercise.revisions[0]!.idempotentReplay).toBe(true);
            expect((await outcomesPool.query<{ fact: unknown }>(
              'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
              [award.entitlementId, currentRevision.content.state.custody[0]!.assetVersionId,
               '2026-08-09T12:07:00Z', [rightCaptureId]]
            )).rows[0]!.fact).toMatchObject({ lifecycle: { exercise: { record: { selectionId: replacementSelectionId } } } });

            expect((await outcomesPool.query<{ selection_id: string }>(
              'SELECT selection_id FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=$1', [award.entitlementId]
            )).rows).toEqual([{ selection_id: replacementSelectionId }]);
            expect((await outcomesPool.query(
              'SELECT entitlement_id FROM outcome_special_entitlement_selection_claim WHERE selection_id=$1', [selectionId]
            )).rows).toEqual([]);
            expect((await outcomesPool.query<{ selected_player: string; retained_selection: string }>(
              `SELECT selection.player_id AS selected_player,original.record_json->>'selectionId' AS retained_selection
               FROM outcome_draft_selection selection CROSS JOIN outcome_special_entitlement_lifecycle original
               WHERE selection.selection_id=$1 AND original.entitlement_id=$2 AND original.kind='exercise'`,
              [replacementSelectionId, award.entitlementId]
            )).rows).toEqual([{ selected_player: replacementPlayerId, retained_selection: selectionId }]);
            const newIdentityAward = createSpecialEntitlementAward({
              ...currentRevision.content.state.award.award.content,
              issuingAwardId: `${award.content.issuingAwardId}:identity-correction`,
            });
            const newIdentityAwardApproval = await approve(newIdentityAward);
            const identityCandidate = resolveSpecialEntitlementCustody({
              candidate: correctedSource, reconciledAt: '2026-08-09T12:03:00Z',
              bindings: transferIds.map((id, index) => ({ transferId: id, award: newIdentityAward,
                awardApprovalDecisionId: newIdentityAwardApproval, predecessorTransferId: index === 0 ? null : transferIds[0]! })),
            });
            const identityPromotionReview = await approveCustody(identityCandidate);
            const identityPromotion = { candidateId: identityCandidate.candidateId, approvalDecisionId: identityPromotionReview.decision.decisionId };
            const identityCustody = await repository.previewSpecialEntitlementCustody(identityPromotion, newIdentityAward.entitlementId);
            const identityRoot = createSpecialEntitlementRevision({
              schemaVersion: 'afl-trade-special-entitlement-revision/v1', entitlementId: newIdentityAward.entitlementId,
              revision: 1, supersedesRevisionId: null, reason: 'Retained original admitted state', changedFields: [],
              proposedAt: '2026-08-09T12:00:00.000Z',
              state: { award: { award: newIdentityAward, approvalDecisionId: newIdentityAwardApproval }, custody: [], activation: null, exercise: null },
            });
            const identityExercise = await reviewed({ ...currentRevision.content.state.exercise!.record, entitlementId: newIdentityAward.entitlementId });
            const identityActivation = currentRevision.content.state.activation === null ? null : await reviewed({
              ...currentRevision.content.state.activation.record, entitlementId: newIdentityAward.entitlementId,
            });
            const identityRevision = createSpecialEntitlementRevision({
              ...identityRoot.content, revision: 2, supersedesRevisionId: identityRoot.revisionId,
              proposedAt: '2026-08-09T12:06:00.000Z', reason: 'Reviewed replacement of incorrect issuing identity',
              changedFields: identityActivation ? ['activation', 'custody', 'exercise'] : ['custody', 'exercise'],
              state: { ...identityRoot.content.state,
                custody: currentRevision.content.state.custody.map((edge) => identityCustody.custody.find((item) => item.transferId === edge.transferId)!),
                activation: identityActivation, exercise: identityExercise },
            });
            const identityRevisionInput = await approveRevision(identityRevision);
            const identityReplacement = createSpecialEntitlementIdentityReplacement({
              schemaVersion: 'afl-trade-special-entitlement-identity-replacement/v1', retiredRevision: currentRevision,
              replacementRevision: identityRevision, reason: 'Fixture corrects issuing-award identity',
              evidence: newIdentityAward.content.evidence, proposedAt: '2026-08-09T12:07:00.000Z',
            });
            const identityEvidence = { schemaVersion: 'afl-trade-special-entitlement-identity-replacement-approval/v1',
              replacement: identityReplacement, authorityEvidenceId: authority.authority_evidence_id };
            const identityApproval = createAflTradeContentAddress('review-decision', identityEvidence);
            await outcomesPool.query(
              `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
               VALUES ($1,'special_draft_entitlement_identity_replacement',$2,'approved','Reviewed identity fixture',$3::jsonb,$4,'2026-08-09T12:07:00Z')`,
              [identityApproval, identityReplacement.replacementId, canonicalizeAflTradeJson(identityEvidence), authority.principal_ref]
            );
            const identityInput = { replacement: identityReplacement, approvalDecisionId: identityApproval,
              replacementRevisionApprovalDecisionId: identityRevisionInput.approvalDecisionId, promotion: identityPromotion };
            await expect(createPgAflOutcomeSqlClient(outcomesPool).transaction(async (tx) => {
              const transactionClient = { query: tx.query.bind(tx),
                transaction: <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx) };
              const transactionalOwner = new PostgresAflTradeExternalCanonicalPromotionRepository(transactionClient);
              const replaced = await transactionalOwner.replaceSpecialEntitlementIdentity(identityInput);
              expect(replaced.idempotentReplay).toBe(false);
              await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
              expect((await tx.query<{ fact: unknown }>(
                'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
                [award.entitlementId, currentAssetId, '2026-08-09T12:07:00Z', [rightCaptureId]]
              )).rows[0]!.fact).toMatchObject({ entitlementId: award.entitlementId, revisionStatus: 'retired_identity',
                identityReplacement, replacementFact: { entitlementId: newIdentityAward.entitlementId,
                  lifecycle: { exercise: { record: { selectionId: replacementSelectionId } } } } });

              expect((await tx.query<{ entitlement_id: string }>(
                'SELECT entitlement_id FROM outcome_special_entitlement_selection_claim WHERE selection_id=$1', [replacementSelectionId]
              )).rows).toEqual([{ entitlement_id: newIdentityAward.entitlementId }]);
              const identityCorpus = await new PostgresAflTradePromotionBackedCorpusRepository(transactionClient).build({
                environment: 'test_fixture', competition: 'AFLM', knowledgeCutoffAt: '2026-08-09T12:07:00.000Z',
                createdAt: '2026-08-09T12:11:00.000Z',
              });
              const identityRelease = await new PostgresAflTradePromotionBackedFactualReleaseRepository(transactionClient).build({
                corpusId: identityCorpus.corpusId, scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2010-2025', createdAt: '2026-08-09T12:12:00.000Z',
              });
              const identityArchive = await new PostgresAflTradePromotionBackedPublicArchiveRepository(transactionClient).build({
                releaseId: identityRelease.releaseId, createdAt: '2026-08-09T12:13:00.000Z',
              });
              expect(identityArchive.archive.content.records.filter(({ record }) => record.recordKind === 'transfer' &&
                record.specialEntitlement?.entitlementId === newIdentityAward.entitlementId)).toHaveLength(2);
              expect(identityArchive.archive.content.records.filter(({ record }) => record.recordKind === 'transfer' &&
                record.specialEntitlement?.entitlementId === award.entitlementId).length).toBeGreaterThanOrEqual(2);
              expect((await transactionalOwner.replaceSpecialEntitlementIdentity(identityInput)).idempotentReplay).toBe(true);
              await tx.query('SAVEPOINT retired_write');
              await expect(transactionalOwner.registerSpecialEntitlementRevision({ revision: currentRevision,
                approvalDecisionId: exerciseCorrectionInput.approvalDecisionId })).rejects.toThrow(/Retired identity/);
              await tx.query('ROLLBACK TO SAVEPOINT retired_write');
              await tx.query('SAVEPOINT replacement_withdrawal');
              await tx.query(
                `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
                 VALUES ($1,'special_draft_entitlement_identity_replacement',$2,'withdrawn','Fixture withdrawal','{}',$3,'2026-08-09T12:08:00Z',$4)`,
                [`withdraw:${identityApproval}`, identityReplacement.replacementId, authority.principal_ref, identityApproval]
              );
              await expect(tx.query('SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
                [award.entitlementId, currentAssetId, '2026-08-09T12:09:00Z', [rightCaptureId]]))
                .rejects.toThrow(/exact current reviewed approval/);
              await tx.query('ROLLBACK TO SAVEPOINT replacement_withdrawal');
              throw new Error('Fixture restores source after verified identity transition');
            })).rejects.toThrow('Fixture restores source after verified identity transition');
            expect((await outcomesPool.query<{ entitlement_id: string }>(
              'SELECT entitlement_id FROM outcome_special_entitlement_selection_claim WHERE selection_id=$1', [replacementSelectionId]
            )).rows).toEqual([{ entitlement_id: award.entitlementId }]);
            expect((await outcomesPool.query('SELECT replacement_id FROM outcome_special_entitlement_identity_replacement WHERE replacement_id=$1',
              [identityReplacement.replacementId])).rows).toEqual([]);
            committedIdentityChecks.push(async () => {
              const retiredRevision = await repository.loadSpecialEntitlementRevision(award.entitlementId);
              const committedReplacement = createSpecialEntitlementIdentityReplacement({
                ...identityReplacement.content, retiredRevision,
                reason: 'Commit reviewed replacement after source authority withdrawal', proposedAt: '2026-08-09T12:10:00.000Z',
              });
              const evidence = { ...identityEvidence, replacement: committedReplacement };
              const decisionId = createAflTradeContentAddress('review-decision', evidence);
              await outcomesPool.query(
                `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
                 VALUES ($1,'special_draft_entitlement_identity_replacement',$2,'approved','Committed replacement fixture',$3::jsonb,$4,'2026-08-09T12:10:00Z')`,
                [decisionId, committedReplacement.replacementId, canonicalizeAflTradeJson(evidence), authority.principal_ref]
              );
              const input = { ...identityInput, replacement: committedReplacement, approvalDecisionId: decisionId };
              expect((await repository.replaceSpecialEntitlementIdentity(input)).idempotentReplay).toBe(false);
              const restarted = new PostgresAflTradeExternalCanonicalPromotionRepository(createPgAflOutcomeSqlClient(outcomesPool));
              expect((await restarted.replaceSpecialEntitlementIdentity(input)).idempotentReplay).toBe(true);
              expect((await outcomesPool.query<{ entitlement_id: string }>(
                'SELECT entitlement_id FROM outcome_special_entitlement_selection_claim WHERE selection_id=$1', [replacementSelectionId]
              )).rows).toEqual([{ entitlement_id: newIdentityAward.entitlementId }]);
              expect((await outcomesPool.query<{ fact: unknown }>(
                'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
                [award.entitlementId, currentAssetId, '2026-08-09T12:11:00Z', [rightCaptureId]]
              )).rows[0]!.fact).toMatchObject({ revisionStatus: 'retired_identity', replacementFact: { entitlementId: newIdentityAward.entitlementId } });
              const writer = await outcomesPool.connect();
              const reader = await outcomesPool.connect();
              try {
                await writer.query('BEGIN');
                await writer.query("SELECT pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||$1,0))",
                  [newIdentityAward.entitlementId]);
                await reader.query('BEGIN');
                await reader.query("SET LOCAL statement_timeout='2s'");
                await expect(reader.query(
                  'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
                  [award.entitlementId, currentAssetId, '2026-08-09T12:11:00Z', [rightCaptureId]]
                )).rejects.toMatchObject({ code: '40001' });
                await reader.query('ROLLBACK');
                // The failed read releases its ancestor lock, allowing a replacement writer to finish.
                expect((await writer.query<{ acquired: boolean }>(
                  "SELECT pg_try_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||$1,0)) AS acquired",
                  [award.entitlementId])).rows[0]!.acquired).toBe(true);
                await writer.query('ROLLBACK');
                expect((await reader.query<{ fact: unknown }>(
                  'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
                  [award.entitlementId, currentAssetId, '2026-08-09T12:11:00Z', [rightCaptureId]]
                )).rows[0]!.fact).toMatchObject({ revisionStatus: 'retired_identity',
                  replacementFact: { entitlementId: newIdentityAward.entitlementId } });
              } finally {
                await reader.query('ROLLBACK');
                await writer.query('ROLLBACK');
                reader.release();
                writer.release();
              }
              const chainAward = createSpecialEntitlementAward({ ...newIdentityAward.content,
                issuingAwardId: `${newIdentityAward.content.issuingAwardId}:chain` });
              const chainAwardApproval = await approve(chainAward);
              const chainCandidate = resolveSpecialEntitlementCustody({ candidate: correctedSource, reconciledAt: '2026-08-09T12:03:00Z',
                bindings: transferIds.map((id, index) => ({ transferId: id, award: chainAward,
                  awardApprovalDecisionId: chainAwardApproval, predecessorTransferId: index === 0 ? null : transferIds[0]! })) });
              const chainReview = await approveCustody(chainCandidate);
              const chainPromotion = { candidateId: chainCandidate.candidateId, approvalDecisionId: chainReview.decision.decisionId };
              const chainCustody = await repository.previewSpecialEntitlementCustody(chainPromotion, chainAward.entitlementId);
              const chainRoot = createSpecialEntitlementRevision({ ...identityRoot.content, entitlementId: chainAward.entitlementId,
                state: { ...identityRoot.content.state, award: { award: chainAward, approvalDecisionId: chainAwardApproval } } });
              const chainExercise = await reviewed({ ...identityExercise.record, entitlementId: chainAward.entitlementId });
              const chainActivation = identityActivation === null ? null : await reviewed({ ...identityActivation.record, entitlementId: chainAward.entitlementId });
              const chainRevision = createSpecialEntitlementRevision({ ...identityRevision.content,
                entitlementId: chainAward.entitlementId, supersedesRevisionId: chainRoot.revisionId,
                state: { ...chainRoot.content.state,
                  custody: identityRevision.content.state.custody.map((edge) => chainCustody.custody.find((item) => item.transferId === edge.transferId)!),
                  activation: chainActivation, exercise: chainExercise } });
              const chainRevisionInput = await approveRevision(chainRevision);
              const chainReplacement = createSpecialEntitlementIdentityReplacement({ ...committedReplacement.content,
                retiredRevision: identityRevision, replacementRevision: chainRevision,
                reason: 'Follow a second reviewed identity correction', proposedAt: '2026-08-09T12:11:00.000Z' });
              const chainEvidence = { ...identityEvidence, replacement: chainReplacement };
              const chainApproval = createAflTradeContentAddress('review-decision', chainEvidence);
              await outcomesPool.query(
                `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
                 VALUES ($1,'special_draft_entitlement_identity_replacement',$2,'approved','Chained replacement',$3::jsonb,$4,'2026-08-09T12:11:00Z')`,
                [chainApproval, chainReplacement.replacementId, canonicalizeAflTradeJson(chainEvidence), authority.principal_ref]
              );
              await restarted.replaceSpecialEntitlementIdentity({ replacement: chainReplacement, approvalDecisionId: chainApproval,
                replacementRevisionApprovalDecisionId: chainRevisionInput.approvalDecisionId, promotion: chainPromotion });
              const laterRevision = createSpecialEntitlementRevision({ ...chainRevision.content, revision: 3,
                supersedesRevisionId: chainRevision.revisionId, proposedAt: '2026-08-09T12:12:00.000Z',
                reason: 'Reviewed withdrawal of current exercise after identity correction', changedFields: ['exercise'],
                state: { ...chainRevision.content.state, exercise: null } });
              const laterInput = await approveRevision(laterRevision, '2026-08-09T12:12:30Z');
              await restarted.registerSpecialEntitlementRevision(laterInput);
              expect((await outcomesPool.query<{ fact: unknown }>(
                'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
                [award.entitlementId, beforeCustodyCorrection.content.state.custody[0]!.assetVersionId,
                  '2026-08-09T12:06:35Z', [rightCaptureId]]
              )).rows[0]!.fact).toMatchObject({ revision: beforeCustodyCorrection });

              const chainRead = await outcomesPool.query<{ fact: unknown }>(
                'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[]) AS fact',
                [award.entitlementId, currentAssetId, '2026-08-09T12:13:00Z', [rightCaptureId]]
              );
              expect(chainRead.rows[0]!.fact).toMatchObject({ entitlementId: award.entitlementId, revisionStatus: 'retired_identity',
                replacementFact: { entitlementId: newIdentityAward.entitlementId, revisionStatus: 'retired_identity',
                  replacementFact: { entitlementId: chainAward.entitlementId, revision: laterRevision } } });
              expect((await outcomesPool.query('SELECT entitlement_id FROM outcome_special_entitlement_selection_claim WHERE selection_id=$1', [replacementSelectionId])).rows).toEqual([]);
              await outcomesPool.query(
                `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
                 VALUES ($1,'special_draft_entitlement_revision',$2,'withdrawn','Withdraw current chain target','{}',$3,'2026-08-09T12:13:00Z',$4)`,
                [`withdraw:${laterInput.approvalDecisionId}`, laterRevision.revisionId, authority.principal_ref, laterInput.approvalDecisionId]
              );
              await expect(outcomesPool.query('SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
                [award.entitlementId, currentAssetId, '2026-08-09T12:14:00Z', [rightCaptureId]])).rejects.toThrow(/current reviewed approval/);
              await expect(outcomesPool.query('SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
                [award.entitlementId, beforeCustodyCorrection.content.state.custody[0]!.assetVersionId,
                  '2026-08-09T12:06:35Z', [rightCaptureId]])).rejects.toThrow(/current reviewed approval/);


            });
            revisionWithdrawalChecks.push(async () => {
            const withdrawnExercise = createSpecialEntitlementRevision({
              ...currentRevision.content,
              revision: currentRevision.content.revision + 1,
              supersedesRevisionId: currentRevision.revisionId,
              reason: 'Fixture withdraws exercise claim pending corrected selection',
              changedFields: ['exercise'],
              state: { ...currentRevision.content.state, exercise: null },
            });
            const removalInput = await approveRevision(withdrawnExercise);
            await expect(
              createPgAflOutcomeSqlClient(outcomesPool).transaction(async (tx) => {
                await tx.query(
                  'SELECT * FROM register_outcome_special_entitlement_revision($1::jsonb,$2)',
                  [canonicalizeAflTradeJson(withdrawnExercise), removalInput.approvalDecisionId]
                );
                throw new Error('Fixture correction rollback');
              })
            ).rejects.toThrow('Fixture correction rollback');
            expect(
              (
                await outcomesPool.query(
                  'SELECT count(*)::integer AS count FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=$1',
                  [award.entitlementId]
                )
              ).rows[0].count
            ).toBe(1);
            await repository.registerSpecialEntitlementRevision(removalInput);
            expect(
              (
                await outcomesPool.query(
                  'SELECT count(*)::integer AS count FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=$1',
                  [award.entitlementId]
                )
              ).rows[0].count
            ).toBe(0);
            expect(
              (
                await outcomesPool.query(
                  `SELECT count(*)::integer AS count FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=$1 AND kind='exercise'`,
                  [award.entitlementId]
                )
              ).rows[0].count
            ).toBe(1);
            await expect(
              repository.registerSpecialEntitlementRevision(correctionInput)
            ).rejects.toThrow(/current state/);
            await outcomesPool.query(
              `INSERT INTO outcome_review_decision
              (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
              VALUES ($1,'special_draft_entitlement_revision',$2,'withdrawn','Fixture withdraws current revision','{}',$3,'2026-08-09T12:08:00Z',$4)`,
              [
                `withdraw-revision:${removalInput.approvalDecisionId}`,
                withdrawnExercise.revisionId,
                authority.principal_ref,
                removalInput.approvalDecisionId,
              ]
            );
            await expect(
              repository.registerSpecialEntitlementRevision(removalInput)
            ).rejects.toThrow(/current reviewed approval/);
            await expect(
              outcomesPool.query(
                'SELECT read_outcome_special_entitlement_revision_for_asset($1,$2,$3,$4::text[])',
                [award.entitlementId, currentAssetId, '2026-08-09T12:09:00Z', [rightCaptureId]]
              )
            ).rejects.toThrow(/current reviewed approval/);

            await expect(
              outcomesPool.query(
                `UPDATE outcome_special_entitlement_revision SET revision_json='{}' WHERE entitlement_id=$1`,
                [award.entitlementId]
              )
            ).rejects.toThrow();
            });
          });
          withdrawals.push(async () => {
            await outcomesPool.query(
              `INSERT INTO outcome_review_decision
            (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
            VALUES ($1,'special_draft_entitlement_exercise',$2,'withdrawn','Fixture withdrawal','{}',$3,'2026-08-09T12:07:00Z',$4)`,
              [
                `withdraw:${exerciseInput.approvalDecisionId}`,
                award.entitlementId,
                authority.principal_ref,
                exerciseInput.approvalDecisionId,
              ]
            );
            await expect(
              repository.registerSpecialEntitlementLifecycle(exerciseInput)
            ).rejects.toThrow(/current reviewed approval|current revision owner/);
            await expect(
              outcomesPool.query(`SELECT read_outcome_special_entitlement_lifecycle($1,$2)`, [
                award.entitlementId,
                '2026-08-09T12:06:00Z',
              ])
            ).rejects.toThrow(/current reviewed approval|current revision owner/);
          });
        });
        const conflicting = createSpecialEntitlementAward({
          ...award.content,
          holderClubId: 'club-western-bulldogs',
        });
        await expect(
          repository.registerSpecialEntitlementAward({
            award: conflicting,
            approvalDecisionId: await approve(conflicting),
          })
        ).rejects.toThrow(/immutable conflict/);
        const invalidCapture = createSpecialEntitlementAward({
          ...award.content,
          issuingAwardId: `bad-capture:${label}`,
          evidence: [{ ...award.content.evidence[0]!, contentSha256: digest('9') }],
        });
        await expect(
          repository.registerSpecialEntitlementAward({
            award: invalidCapture,
            approvalDecisionId: await approve(invalidCapture),
          })
        ).rejects.toThrow(/capture, digest, URL or season/);
        const invalidAuthority = createSpecialEntitlementAward({
          ...award.content,
          issuingAwardId: `bad-authority:${label}`,
        });
        await expect(
          repository.registerSpecialEntitlementAward({
            award: invalidAuthority,
            approvalDecisionId: await approve(invalidAuthority, 'unknown-authority'),
          })
        ).rejects.toThrow(/reviewer lacks/);
        const rolledBack = createSpecialEntitlementAward({
          ...award.content,
          issuingAwardId: `rollback:${label}`,
        });
        const rollbackApproval = await approve(rolledBack);
        await expect(
          createPgAflOutcomeSqlClient(outcomesPool).transaction(async (transaction) => {
            await transaction.query(
              'SELECT * FROM register_outcome_special_entitlement_award($1::jsonb,$2)',
              [canonicalizeAflTradeJson(rolledBack), rollbackApproval]
            );
            throw new Error('Simulated downstream failure');
          })
        ).rejects.toThrow('Simulated downstream failure');
        expect(
          (
            await outcomesPool.query(
              'SELECT entitlement_id FROM outcome_special_entitlement_award WHERE entitlement_id=$1',
              [rolledBack.entitlementId]
            )
          ).rows
        ).toEqual([]);
        withdrawals.push(async () => {
          await outcomesPool.query(
            `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
          VALUES ($1,'special_draft_entitlement_award',$2,'withdrawn',$3,'Fixture withdrawal','{}',$4,'2026-08-09T12:01:00Z') ON CONFLICT DO NOTHING`,
            [
              `withdrawal:${approvalDecisionId}`,
              award.entitlementId,
              approvalDecisionId,
              authority.principal_ref,
            ]
          );
          await expect(repository.registerSpecialEntitlementAward(input)).rejects.toThrow(
            /current reviewed approval|current revision owner/
          );
          await expect(
            repository.promote({
              candidateId: resolved.candidateId,
              approvalDecisionId: decision.decisionId,
            })
          ).rejects.toThrow(/current reviewed approval|current revision owner/);
        });
      }
      const corpus = await new PostgresAflTradePromotionBackedCorpusRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({
        environment: 'test_fixture',
        competition: 'AFLM',
        knowledgeCutoffAt: '2026-08-09T12:06:00.000Z',
        createdAt: '2026-08-09T12:07:00.000Z',
      });
      const release = await new PostgresAflTradePromotionBackedFactualReleaseRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({
        corpusId: corpus.corpusId,
        scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2010-2025',
        createdAt: '2026-08-09T12:08:00.000Z',
      });
      const archive = await new PostgresAflTradePromotionBackedPublicArchiveRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({
        releaseId: release.releaseId,
        createdAt: '2026-08-09T12:09:00.000Z',
      });
      expect(archive.archive.content.recordCounts.transfer).toBe(7);
      const retained = await outcomesPool.query(
        `SELECT record_json#>>'{record,specialEntitlement,entitlementType}' AS type,
        record_json#>>'{record,specialEntitlement,entitlementId}' AS id
        FROM outcome_public_factual_archive_record WHERE archive_id=$1 AND record_json#>>'{record,assetKind}'='list_right'`,
        [archive.archive.archiveId]
      );
      expect(retained.rows).toHaveLength(6);
      expect(retained.rows.map((row) => row.type).sort()).toEqual([
        'assistance_concession',
        'assistance_concession',
        'expansion_compensation',
        'expansion_compensation',
        'mini_draft',
        'mini_draft',
      ]);
      expect(new Set(retained.rows.map((row) => row.id)).size).toBe(3);
      for (const check of exerciseChecks) await check();
      const exercisedRelease = await new PostgresAflTradePromotionBackedFactualReleaseRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({
        corpusId: corpus.corpusId,
        scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2010-2025',
        createdAt: '2026-08-09T12:10:00.000Z',
      });
      const exerciseSnapshots = await outcomesPool.query(
        `SELECT record_canonical_json::jsonb#>'{record,specialEntitlement,lifecycle,exercise,record}' AS exercise
        FROM outcome_release_event_asset WHERE release_id=$1 AND record_canonical_json::jsonb#>'{record,specialEntitlement,lifecycle,exercise}' IS NOT NULL`,
        [exercisedRelease.releaseId]
      );
      expect(exerciseSnapshots.rows).toHaveLength(6);
      expect(
        new Set(
          exerciseSnapshots.rows.map(
            (row) => (row.exercise as { entitlementId: string }).entitlementId
          )
        ).size
      ).toBe(3);
      expect(
        (
          await outcomesPool.query(
            `SELECT count(*)::integer AS count FROM outcome_release_event_asset
        WHERE release_id=$1 AND record_canonical_json::jsonb#>'{record,specialEntitlement,lifecycle,exercise}' IS NOT NULL`,
            [release.releaseId]
          )
        ).rows[0].count
      ).toBe(0);

      for (const check of revisionChecks) await check();
      const correctedCorpus = await new PostgresAflTradePromotionBackedCorpusRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({ environment: 'test_fixture', competition: 'AFLM',
        knowledgeCutoffAt: '2026-08-09T12:07:00.000Z', createdAt: '2026-08-09T12:11:00.000Z' });
      const correctedRelease = await new PostgresAflTradePromotionBackedFactualReleaseRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({ corpusId: correctedCorpus.corpusId,
        scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2010-2025', createdAt: '2026-08-09T12:12:00.000Z' });
      const correctedArchive = await new PostgresAflTradePromotionBackedPublicArchiveRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({ releaseId: correctedRelease.releaseId, createdAt: '2026-08-09T12:13:00.000Z' });
      expect(correctedArchive.archive.content.recordCounts.transfer).toBe(13);
      expect(correctedArchive.archive.content.records.filter(({ record }) =>
        record.recordKind === 'transaction' && record.supersedesVersionId !== undefined
      )).toHaveLength(6);
      const retainedCorrectionStates = await outcomesPool.query<{ status: string; count: number }>(
        `SELECT record_canonical_json::jsonb#>>'{record,specialEntitlement,revisionStatus}' AS status,
          count(*)::integer AS count FROM outcome_release_event_asset WHERE release_id=$1
          AND record_canonical_json::jsonb#>'{record,specialEntitlement,revisionStatus}' IS NOT NULL GROUP BY 1`,
        [correctedRelease.releaseId]
      );
      expect(retainedCorrectionStates.rows).toEqual(expect.arrayContaining([
        { status: 'current', count: 6 }, { status: 'superseded', count: 6 },
      ]));
      async function selectedArchive(value: typeof correctedArchive) {
        const gates = new PostgresAflTradePromotionBackedGate2Repository(createPgAflOutcomeSqlClient(outcomesPool));
        const staged = await gates.stage({ factualCandidateId: value.archive.content.factualCandidateId,
          createdAt: '2026-08-10T00:00:04.000Z' });
        const lineage = parseAflTradePromotionBackedFactualLineage((await outcomesPool.query<{ lineage_json: unknown }>(
          'SELECT lineage_json FROM outcome_corpus_factual_lineage WHERE lineage_id=$1', [staged.lineageId]
        )).rows[0]!.lineage_json);
        await seedGate2Authority(lineage);
        const admission = await gates.admit({ lineageId: lineage.lineageId, evaluatedAt: '2026-08-10T00:00:07.000Z' });
        const manifest = aflTradePromotionBackedFactualReleaseSchema.parse((await outcomesPool.query<{ manifest_json: unknown }>(
          'SELECT manifest_json FROM outcome_release_manifest WHERE release_id=$1', [value.archive.content.releaseId]
        )).rows[0]!.manifest_json);
        const head = (await outcomesPool.query<{ revision: number }>(
          'SELECT revision FROM outcome_registry_head WHERE singleton_id=1'
        )).rows[0]!.revision;
        const registered = await createPostgresAflDraftTradeOutcomeReleaseRepository(createPgAflOutcomeSqlClient(outcomesPool)).register({
          expectedRevision: head, manifest, actor: 'fixture-release-registrar',
          evidenceId: `artifact:${digest('8')}`, occurredAt: '2026-08-10T00:00:08.000Z',
        });
        // Seed the exact sealed projection as reader input; do not claim publication or activation.
        await outcomesPool.query(
          `INSERT INTO outcome_projection_manifest(projection_id,release_id,public_archive_id,created_at,manifest_json)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [value.projection.projectionId, value.archive.content.releaseId, value.archive.archiveId,
           value.projection.content.createdAt, canonicalizeAflTradeJson(value.projection)]
        );
        // Explicit fixture selection tests the SQL reader; live publication/selector authority is separate.
        return aflTradePromotionBackedArchiveSelectionSchema.parse({
          schemaVersion: 'afl-trade-promotion-backed-archive-selection/v1', registryRevision: registered.revision,
          scopeKey: lineage.content.scopeKey, environment: 'test_fixture', competition: 'AFLM',
          validFromSeason: lineage.content.validFromSeason, validThroughSeason: lineage.content.validThroughSeason,
          releaseId: value.archive.content.releaseId, projectionId: value.projection.projectionId,
          publicArchiveId: value.archive.archiveId, factualCandidateId: value.archive.content.factualCandidateId,
          corpusId: value.archive.content.corpusId, lineageId: lineage.lineageId,
          gate2AdmissionId: admission.admissionId, gate2DecisionId: admission.gate2DecisionId,
          sourceMemberSetSha256: value.projection.content.sourceMemberSetSha256,
          canonicalMemberSetSha256: value.projection.content.canonicalMemberSetSha256,
          publicRecordSetSha256: value.projection.content.publicRecordSetSha256,
          publicRecordCount: value.projection.content.publicRecordCount,
          effectiveThrough: value.projection.content.effectiveThrough,
          publishedAt: '2026-08-10T00:00:08.000Z', capturedAt: '2026-08-10T00:00:09.000Z',
        });
      }
      const reader = createPostgresAflTradePromotionBackedPublicArchiveReadRepository({
        client: createPgAflOutcomeSqlClient(outcomesPool), pageSize: 2,
      });
      const oldSelection = await selectedArchive(archive);
      const newSelection = await selectedArchive(correctedArchive);
      const currentTransfers = await reader.listAllRecords(newSelection, { recordKinds: ['transfer'] });
      expect(currentTransfers).toHaveLength(7);
      expect(currentTransfers.filter((record) => record.recordKind === 'transfer' && record.assetKind === 'list_right')).toHaveLength(6);
      const oldTransfers = await reader.listAllRecords(oldSelection, { recordKinds: ['transfer'] });
      expect(oldTransfers).toHaveLength(7);
      expect(currentTransfers.map((record) => record.recordId).filter((id) => oldTransfers.some((record) => record.recordId === id))).toHaveLength(1);
      expect(await reader.listAllRecords(newSelection, { recordKinds: ['transaction'] })).toHaveLength(7);
      expect(await reader.listAllRecords(newSelection, { recordKinds: ['draft_selection'] })).toHaveLength(3);
      expect(correctedArchive.archive.content.recordCounts.draft_selection).toBe(6);

      const oldEventIds = archive.archive.content.records.flatMap(({ record }) => record.recordKind === 'transaction' && record.seasonYear !== 2025 ? [record.eventVersionId] : []);
      expect(await reader.listAllRecords(newSelection, { recordKinds: ['transaction', 'transfer'], eventVersionIds: oldEventIds })).toEqual([]);
      expect(await reader.listAllRecords(newSelection, { recordKinds: ['transfer'], clubId: 'club-western-bulldogs', seasonYear: 2011 })).toEqual([]);
      expect(await reader.listAllRecords(oldSelection, { recordKinds: ['transfer'], clubId: 'club-western-bulldogs', seasonYear: 2011 })).toHaveLength(2);
      expect((await outcomesPool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM outcome_public_factual_archive_record WHERE archive_id=$1 AND record_kind='transfer'`,
        [newSelection.publicArchiveId]
      )).rows[0]!.count).toBe(13);
      for (const check of revisionWithdrawalChecks) await check();
      await expect(new PostgresAflTradePromotionBackedFactualReleaseRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).build({ corpusId: correctedCorpus.corpusId,
        scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2010-2025', createdAt: '2026-08-10T00:00:10.000Z' }))
        .rejects.toThrow(/current reviewed approval/);
      expect(await reader.listAllRecords(oldSelection, { recordKinds: ['transfer'] })).toEqual(oldTransfers);

      expect(
        (
          await outcomesPool.query(
            `SELECT count(*)::integer AS count FROM outcome_release_event_asset
        WHERE release_id=$1 AND record_canonical_json::jsonb#>'{record,specialEntitlement,lifecycle,exercise}' IS NOT NULL
        AND record_canonical_json::jsonb#>'{record,specialEntitlement,revision}' IS NULL`,
            [exercisedRelease.releaseId]
          )
        ).rows[0].count
      ).toBe(6);

      for (const withdraw of withdrawals) await withdraw();
      expect(
        (
          await outcomesPool.query(
            'SELECT count(*)::INTEGER AS count FROM outcome_special_entitlement_award'
          )
        ).rows
      ).toEqual([{ count: 3 }]);
      await expect(
        outcomesPool.query('DELETE FROM outcome_special_entitlement_award')
      ).rejects.toThrow(/immutable|cannot|append.only/i);
      for (const check of committedIdentityChecks) await check();
      const exampleAward = specialEntitlementAwardSchema.parse((await outcomesPool.query<{ award_json: unknown }>(
        'SELECT award_json FROM outcome_special_entitlement_award ORDER BY entitlement_id LIMIT 1'
      )).rows[0]!.award_json);
      const unexercised = createSpecialEntitlementAward({ ...exampleAward.content, issuingAwardId: 'fixture:award-only-source' });
      await repository.registerSpecialEntitlementAward({ award: unexercised, approvalDecisionId: await approve(unexercised) });
      async function awardOnlyReplacement(sourceId: string, suffix: string) {
        const retiredRevision = await repository.loadSpecialEntitlementRevision(sourceId);
        const targetAward = createSpecialEntitlementAward({ ...exampleAward.content, issuingAwardId: `fixture:award-only-${suffix}` });
        const targetApproval = await approve(targetAward);
        const replacementRevision = createSpecialEntitlementRevision({
          ...retiredRevision.content, entitlementId: targetAward.entitlementId, revision: 1, supersedesRevisionId: null,
          reason: 'Retained original admitted state', changedFields: [], proposedAt: '2026-08-09T12:00:00.000Z',
          state: { award: { award: targetAward, approvalDecisionId: targetApproval }, custody: [], activation: null, exercise: null },
        });
        const replacement = createSpecialEntitlementIdentityReplacement({
          schemaVersion: 'afl-trade-special-entitlement-identity-replacement/v1', retiredRevision, replacementRevision,
          reason: 'Correct an unused award identity', evidence: targetAward.content.evidence, proposedAt: '2026-08-09T12:10:00.000Z',
        });
        const evidence = { schemaVersion: 'afl-trade-special-entitlement-identity-replacement-approval/v1', replacement,
          authorityEvidenceId: authority.authority_evidence_id };
        const approvalDecisionId = createAflTradeContentAddress('review-decision', evidence);
        await outcomesPool.query(
          `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
           VALUES ($1,'special_draft_entitlement_identity_replacement',$2,'approved','Award-only correction',$3::jsonb,$4,'2026-08-09T12:10:00Z')`,
          [approvalDecisionId, replacement.replacementId, canonicalizeAflTradeJson(evidence), authority.principal_ref]
        );
        return { replacement, approvalDecisionId };
      }
      const awardOnly = await awardOnlyReplacement(unexercised.entitlementId, 'target');
      const concurrentlyReplaced = await Promise.all([
        repository.replaceSpecialEntitlementIdentity(awardOnly), repository.replaceSpecialEntitlementIdentity(awardOnly),
      ]);
      expect(concurrentlyReplaced.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
      expect(concurrentlyReplaced.every((result) => result.promotion === null)).toBe(true);
      const unusedTargetId = awardOnly.replacement.content.replacementRevision.content.entitlementId;
      expect((await outcomesPool.query(
        'SELECT entitlement_id FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=ANY($1::text[])',
        [[unexercised.entitlementId, unusedTargetId]]
      )).rows).toEqual([]);
      const competitor = await awardOnlyReplacement(unexercised.entitlementId, 'conflict');
      await expect(repository.replaceSpecialEntitlementIdentity(competitor)).rejects.toThrow(/live source and unused target/);
      const chained = await awardOnlyReplacement(unusedTargetId, 'chain');
      expect((await repository.replaceSpecialEntitlementIdentity(chained)).idempotentReplay).toBe(false);
      await expect(repository.replaceSpecialEntitlementIdentity(awardOnly)).rejects.toThrow(/replay conflicts/);
      const raceSource = createSpecialEntitlementAward({ ...exampleAward.content, issuingAwardId: 'fixture:award-only-race-source' });
      await repository.registerSpecialEntitlementAward({ award: raceSource, approvalDecisionId: await approve(raceSource) });
      const raceLeft = await awardOnlyReplacement(raceSource.entitlementId, 'race-left');
      const raceRight = await awardOnlyReplacement(raceSource.entitlementId, 'race-right');
      const competed = await Promise.allSettled([
        repository.replaceSpecialEntitlementIdentity(raceLeft), repository.replaceSpecialEntitlementIdentity(raceRight),
      ]);
      expect(competed.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(competed.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await outcomesPool.query(
        'SELECT replacement_id FROM outcome_special_entitlement_identity_replacement WHERE retired_entitlement_id=$1',
        [raceSource.entitlementId]
      )).rows).toHaveLength(1);


    });
  });
});
