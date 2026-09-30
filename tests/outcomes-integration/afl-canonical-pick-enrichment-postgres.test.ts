import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import {
  createReviewedPickLineageRegistration,
  reviewedPickLineageApprovalEvidence,
} from '@/server/aflTradeIntelligence/source/reviewedPickLineageRegistrationContracts';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

// A session-only promotion stores each selected pick with empty round, nominal pick and original
// club (as the 2019-2021 national draft promotions did). A later reviewed-lineage promotion of the
// same stable pick must enrich those empty facts through a versioned record, never overwrite a known
// value, and replay without a second version.
describe.each(['enrich', 'conflict'] as const)('canonical pick enrichment: %s', (mode) => {
  const databaseUrl =
    process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
    (() => {
      throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
    })();
  const schemaName = `afl_pick_enrichment_${mode}_${process.pid}_${Date.now()}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  const sql = () => createPgAflOutcomeSqlClient(pool);
  const digest = (character: string) => character.repeat(64);
  const batchId = `external-evidence-batch:${digest('b')}`;
  const captureId = `source-capture:${digest('c')}`;
  const principalRef = 'operator:pick-enrichment-promoter';
  const evidence = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: 'afl-trade-external-evidence/v1',
    provider: 'draftguru',
    publicationEligible: false,
    capture: {
      captureId,
      artifactId: `artifact:${digest('1')}`,
      contentSha256: digest('1'),
      mediaType: 'text/html',
      sourceUrl: 'https://www.draftguru.com.au/trades/enrichment-fixture',
      capturedAt: '2025-11-01T00:00:00.000Z',
      effectiveAt: '2025-11-01T00:00:00.000Z',
      parserVersion: 'draftguru/v1',
      fieldManifestSha256: digest('4'),
    },
    sourceRow: { ordinal: 1, sourceKey: 'fixture-trade' },
    claim: {
      kind: 'transaction',
      nativeEventId: 'enrichment-fixture',
      seasonYear: 2025,
      occurredOn: null,
      transactionType: 'trade',
      title: null,
    },
  });
  const transactionId = createAflTradeContentAddress('external-transaction', {
    provider: 'draftguru',
    nativeEventId: 'enrichment-fixture',
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
  const candidate = createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: 'enrichment-fixture',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: 'Fixture pick exchange',
        parties: ['club-gws', 'club-western-bulldogs'],
        transferIds: [transferId],
        status: 'single_source',
        evidenceIds: [evidence.evidenceId],
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
        evidenceIds: [evidence.evidenceId],
      },
    ],
    draftSelections: [],
    pickCustody: [
      {
        custodyId: createAflTradeContentAddress('external-pick-custody', { fixture: 'enrichment' }),
        pickId,
        observedAt: { precision: 'year', year: 2025 },
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClubId: 'club-gws',
        currentClubId: 'club-western-bulldogs',
        status: 'single_source',
        evidenceIds: [evidence.evidenceId],
      },
    ],
    pickLineage: [
      {
        lineageId: createAflTradeContentAddress('external-pick-lineage', { fixture: 'enrichment' }),
        pickId,
        transferId,
        selectionId: null,
        status: 'single_source',
        evidenceIds: [evidence.evidenceId],
        terminalOutcome: { kind: 'passed', draftYear: 2025, draftType: 'national', livePick: 14 },
      },
    ],
    issues: [],
    reconciledAt: '2026-08-09T11:00:00.000Z',
    publicationEligible: false,
  });
  const proposal = createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v4',
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateId.split(':')[1] ?? '',
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftEventCoverage: [],
    transactionDateCoverage: [{ transactionId, seasonYear: 2025, occurredOn: null }],
    proposedAt: '2026-08-09T11:03:00.000Z',
    publicationEligible: false,
  });

  async function seedSourcesAndAuthority(): Promise<string> {
    await pool.query(
      `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2025)`
    );
    await pool.query(`INSERT INTO outcome_club (club_id,current_name,status) VALUES
      ('club-gws','GWS','approved'),('club-western-bulldogs','Western Bulldogs','approved'),
      ('club-other','Other','approved')`);
    await pool.query(
      `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
        artifact_class,environment,created_at,verified_at,custody_json)
       VALUES ('artifact:${digest('1')}',$1,$2,'text/html',1,'raw_source','test_fixture',
        '2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`,
      [digest('1'), `artifact://sha256/${digest('1')}`]
    );
    await pool.query(`INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
      VALUES ('attempt-enrichment','test_fixture','draftguru','trades','draftguru-trade-detail',
        'captured','2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`);
    await pool.query(
      `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,
        environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
        anchor_season_year,effective_at,captured_at,status,manifest_json)
       VALUES ($1,'attempt-enrichment',$2,'artifact:${digest('1')}','test_fixture','draftguru','trades',
        '2025','automated_web','draftguru-trade-detail','AFLM',2025,'2025-10-15T00:00:00.000Z',
        '2025-11-01T00:00:01.000Z','approved',$3::jsonb)`,
      [
        captureId,
        `source-snapshot:${digest('2')}`,
        canonicalizeAflTradeJson({
          sourceUrl: 'https://www.draftguru.com.au/trades/enrichment-fixture',
          executionReceipt,
        }),
      ]
    );
    await pool.query(
      `INSERT INTO outcome_external_evidence_batch (batch_id,capture_id,provider,evidence_count,issue_count,
        row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
       VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,'{}'::jsonb)`,
      [batchId, captureId, sha256AflTradeCanonicalJson([evidence.evidenceId]), digest('0')]
    );
    await pool.query(
      `INSERT INTO outcome_external_evidence_row (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
       VALUES ($1,$2,1,'fixture-trade','transaction',$3::jsonb)`,
      [evidence.evidenceId, batchId, canonicalizeAflTradeJson(evidence)]
    );
    await pool.query(
      `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2025-11-01T00:00:02.000Z'
        WHERE batch_id=$1`,
      [batchId]
    );
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
    await pool.query(
      `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
        artifact_class,environment,created_at,verified_at,custody_json)
       VALUES ('artifact-enrichment-authority',$1,$2,'application/json',$3,'derived_private','test_fixture',
        '2026-08-09T11:01:00.000Z','2026-08-09T11:01:01.000Z','{}'::jsonb)`,
      [authoritySha, `artifact://sha256/${authoritySha}`, Buffer.byteLength(authorityCanonical)]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO outcome_review_decision (decision_id,subject_type,subject_id,decision,rationale,
          evidence_json,decided_by,decided_at)
         VALUES ($1,'governed_evidence_reference',$2,'approved','Fixture authority approval',
          jsonb_build_object('referenceSha256',$3::text),'fixture-governance-reviewer','2026-08-09T11:02:00.000Z')`,
        [authorityApprovalId, authorityId, authoritySha]
      );
      await client.query(
        `INSERT INTO outcome_governed_evidence_reference (reference_id,reference_sha256,evidence_kind,
          artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json)
         VALUES ($1,$2,'reviewer_authority_evidence','artifact-enrichment-authority','test_fixture',
          'approved',$3,'2026-08-09T11:02:00.000Z',$4,$5::jsonb)`,
        [authorityId, authoritySha, authorityApprovalId, authorityCanonical, authorityCanonical]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.query(
      `INSERT INTO outcome_operational_principal_authority (authority_evidence_id,principal_ref,role,scope_key,
        provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES ($1,$2,'afl_trade_canonical_promoter','public-afl-draft-trade-outcomes','multi_source',
        'external_candidate_promotion','AFLM',2010,2025,'2026-01-01T00:00:00.000Z',NULL)`,
      [authorityId, principalRef]
    );
    return authorityId;
  }

  async function approvePromotion(authorityId: string): Promise<string> {
    const reviews = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql());
    const stored = await reviews.loadCandidate(candidate.candidateId);
    const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
      candidateId: candidate.candidateId,
      proposalId: proposal.proposalId,
      proposalSha256: proposal.proposalId.split(':')[1]!,
      proposal,
      revision: 1,
      supersedesDecisionId: null,
      decision: 'approved',
      rationale: 'Promote exact enrichment fixture candidate',
      authorityEvidenceId: authorityId,
      decidedBy: principalRef,
      decidedAt: '2026-08-09T11:04:00.000Z',
    });
    await reviews.persistDecision({ candidate: stored, proposal, decision });
    return decision.decisionId;
  }

  async function registerReviewedLineage(authorityId: string): Promise<string> {
    const registration = createReviewedPickLineageRegistration({
      candidate,
      proposedAt: '2026-08-09T12:00:00Z',
      records: [
        {
          schemaVersion: 'afl-trade-reviewed-pick-lineage/v1',
          candidateId: candidate.candidateId,
          transferId,
          retainedSourceLabel: 'Pick 14',
          acceptedTradeTimePick: 14,
          originalClubId: 'club-gws',
          movements: [
            {
              transferId,
              fromClubId: 'club-gws',
              toClubId: 'club-western-bulldogs',
              occurredAt: { precision: 'year', year: 2025 },
              predecessorOrdinal: null,
            },
          ],
          endpoint: { kind: 'passed', draftYear: 2025, draftType: 'national', livePick: 14 },
          attribution: 'direct',
          evidence: [
            createAflTradeByteArtifactRef(
              new TextEncoder().encode('Reviewed enrichment fixture source'),
              'text/plain',
              '2026-08-09T11:00:00Z'
            ),
          ],
        },
      ],
    });
    const evidenceJson = {
      ...reviewedPickLineageApprovalEvidence(registration),
      authorityEvidenceId: authorityId,
    };
    const approvalDecisionId = createAflTradeContentAddress('review-decision', evidenceJson);
    await pool.query(
      `INSERT INTO outcome_review_decision (decision_id,subject_type,subject_id,decision,rationale,
        evidence_json,decided_by,decided_at)
       VALUES ($1,'reviewed_pick_lineage_registration',$2,'approved','Fixture lineage review',$3::jsonb,$4,
        '2026-08-09T12:01:00Z')`,
      [
        approvalDecisionId,
        registration.registrationId,
        canonicalizeAflTradeJson(evidenceJson),
        principalRef,
      ]
    );
    await new PostgresAflTradeExternalCanonicalPromotionRepository(
      sql()
    ).registerReviewedPickLineage({
      registration,
      approvalDecisionId,
    });
    return registration.registrationId;
  }

  // The stored pick an earlier session-only promotion created: no round, pick number or club.
  async function seedSessionPromotedPick(nominalPick: number | null): Promise<void> {
    await pool.query(
      `INSERT INTO outcome_draft_pick (pick_id,draft_season_year,draft_kind,nominal_round,nominal_pick,
        original_club_id,status)
       VALUES ($1,2025,'national_draft',NULL,$2,NULL,'approved')`,
      [pickId, nominalPick]
    );
  }

  const facts = async (asOf: string | null = null) =>
    (
      await pool.query(
        `SELECT nominal_round,nominal_pick,original_club_id,enrichment_version
           FROM outcome_draft_pick_facts(ARRAY[$1]::text[],$2::timestamptz)`,
        [pickId, asOf]
      )
    ).rows[0];
  const enrichmentCount = async () =>
    (await pool.query('SELECT count(*)::int AS count FROM outcome_draft_pick_enrichment')).rows[0]
      .count;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('schema', schemaName);
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  }, 300_000);

  afterAll(async () => {
    await pool.end();
    try {
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    } finally {
      await adminPool.end();
    }
  });

  it(
    mode === 'enrich'
      ? 'enriches empty session-promoted pick facts from reviewed lineage, versioned, with exact replay'
      : 'keeps a differing known pick fact an immutable conflict',
    async () => {
      const authorityId = await seedSourcesAndAuthority();
      await new PostgresAflTradeExternalReconciliationRepository(sql()).persistCandidate({
        candidate,
        identityResolutions: [],
      });
      await seedSessionPromotedPick(mode === 'enrich' ? null : 13);
      const approvalDecisionId = await approvePromotion(authorityId);
      const owner = new PostgresAflTradeExternalCanonicalPromotionRepository(sql());
      const promote = () =>
        owner.promote({ candidateId: candidate.candidateId, approvalDecisionId });

      if (mode === 'conflict') {
        await registerReviewedLineage(authorityId);
        await expect(promote()).rejects.toMatchObject({ code: 'IMMUTABLE_CONFLICT' });
        expect(await enrichmentCount()).toBe(0);
        expect(await facts()).toEqual({
          nominal_round: null,
          nominal_pick: 13,
          original_club_id: null,
          enrichment_version: null,
        });
        expect(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM outcome_external_canonical_promotion'
            )
          ).rows[0].count
        ).toBe(0);
        return;
      }

      // Without reviewed lineage evidence, filling a stored pick stays a conflict.
      await expect(promote()).rejects.toMatchObject({ code: 'IMMUTABLE_CONFLICT' });
      expect(await enrichmentCount()).toBe(0);

      const registrationId = await registerReviewedLineage(authorityId);
      const promoted = await promote();
      expect(promoted).toMatchObject({
        idempotentReplay: false,
        pickCustodyCount: 1,
        pickRealizationCount: 1,
      });
      expect(
        (
          await pool.query(
            'SELECT nominal_round,nominal_pick,original_club_id FROM outcome_draft_pick WHERE pick_id=$1',
            [pickId]
          )
        ).rows[0]
      ).toEqual({ nominal_round: null, nominal_pick: null, original_club_id: null });
      expect(await facts()).toEqual({
        nominal_round: 1,
        nominal_pick: 14,
        original_club_id: 'club-gws',
        enrichment_version: 1,
      });
      // A reader bound to an earlier cutoff still sees the stored facts.
      expect(await facts('2026-01-01T00:00:00.000Z')).toMatchObject({
        nominal_pick: null,
        enrichment_version: null,
      });
      const enrichment = (
        await pool.query(
          `SELECT version,supersedes_enrichment_id,promotion_id,approval_decision_id,registration_id,source_json
             FROM outcome_draft_pick_enrichment WHERE pick_id=$1`,
          [pickId]
        )
      ).rows;
      expect(enrichment).toEqual([
        {
          version: 1,
          supersedes_enrichment_id: null,
          promotion_id: promoted.promotionId,
          approval_decision_id: approvalDecisionId,
          registration_id: registrationId,
          source_json: {
            candidateId: candidate.candidateId,
            custodyIds: candidate.content.pickCustody.map((row) => row.custodyId),
            transferIds: [transferId],
          },
        },
      ]);

      await expect(promote()).resolves.toEqual({ ...promoted, idempotentReplay: true });
      expect(await enrichmentCount()).toBe(1);

      // The version chain is append-only and cannot change or restate a known fact.
      await expect(
        pool.query('UPDATE outcome_draft_pick_enrichment SET nominal_pick=15')
      ).rejects.toThrow();
      await expect(pool.query('DELETE FROM outcome_draft_pick_enrichment')).rejects.toThrow();
      const insertVersion = (nominalPick: number, originalClubId: string | null) =>
        pool.query(
          `INSERT INTO outcome_draft_pick_enrichment (enrichment_id,pick_id,version,supersedes_enrichment_id,
            nominal_round,nominal_pick,original_club_id,promotion_id,approval_decision_id,registration_id,source_json)
           SELECT 'draft-pick-enrichment:'||repeat($3,64),pick_id,2,enrichment_id,nominal_round,$1,$2,
            promotion_id,approval_decision_id,registration_id,source_json
             FROM outcome_draft_pick_enrichment WHERE version=1`,
          [nominalPick, originalClubId, nominalPick === 14 ? 'd' : 'e']
        );
      await expect(insertVersion(15, 'club-gws')).rejects.toThrow(/cannot change a known/);
      await expect(insertVersion(14, 'club-gws')).rejects.toThrow(/must fill at least one/);
      expect(await enrichmentCount()).toBe(1);
    }
  );
});
