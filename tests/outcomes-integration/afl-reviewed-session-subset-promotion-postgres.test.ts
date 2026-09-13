import { buildReviewedSessionCorrection } from '@/server/aflTradeIntelligence/source/reviewedSessionCorrection';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { verifySessionAcquisitionCurrentness } from '../testUtils/sessionAcquisitionCurrentness';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  buildReviewedAdmissionScope,
  prepareReviewedSessionCorrection,
} from '@/server/aflTradeIntelligence/source/reviewedAdmissionScope';
import {
  createReviewedPickLineageRegistration,
  reviewedPickLineageApprovalEvidence,
} from '@/server/aflTradeIntelligence/source/reviewedPickLineageRegistrationContracts';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import {
  loadAflTradeExternalIdentityReviewQueue,
  recordAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { deriveReviewedSessionCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
describe.each([
  'consecutive',
  'enumerated',
  'multi_document',
  'supplemental_selection',
  'rookie_exclusion',
  'window',
])('reviewed retained subset (%s)', (mode) => {
  const sessionWindow = mode === 'window';
  const enumerated = mode !== 'consecutive';
  const multiDocument = mode === 'multi_document' || mode === 'rookie_exclusion';
  const rookieExclusion = mode === 'rookie_exclusion';
  const supplementalSelection = mode === 'supplemental_selection';
  const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable PostgreSQL required.');
  const schema = `reviewed_subset_${mode}_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: url });
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  const sql = createPgAflOutcomeSqlClient(pool);
  const databaseInstant = async () =>
    (
      await pool.query<{ at: string }>(
        `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
      )
    ).rows[0]!.at;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(url);
    scoped.searchParams.set('schema', schema);
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  }, 120000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });

  it(
    sessionWindow
      ? 'persists a reviewed window correction with replay and revocation'
      : 'promotes one reviewed selection from complete retained inventory with exact replay',
    async () => {
      const draft = await createRetainedExternalCaptureFixture(
        sql,
        false,
        'test_fixture',
        71,
        false,
        false,
        false,
        enumerated,
        multiDocument,
        supplementalSelection,
        rookieExclusion,
        sessionWindow
      );
      const trade = await createRetainedExternalCaptureFixture(
        sql,
        false,
        'test_fixture',
        71,
        false,
        true,
        false,
        enumerated,
        multiDocument,
        supplementalSelection,
        rookieExclusion,
        sessionWindow
      );
      const official = await createRetainedExternalCaptureFixture(
        sql,
        true,
        'test_fixture',
        71,
        false,
        false,
        false,
        enumerated,
        multiDocument,
        supplementalSelection,
        rookieExclusion,
        sessionWindow
      );
      const second = await createRetainedExternalCaptureFixture(
        sql,
        true,
        'test_fixture',
        1,
        false,
        false,
        true,
        enumerated,
        multiDocument,
        supplementalSelection,
        rookieExclusion,
        sessionWindow
      );
      const plannedAt = (
        await pool.query<{ at: string }>(
          `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
          [[draft.target.evidenceBatchId, official.target.evidenceBatchId]]
        )
      ).rows[0]!.at;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const plan = createAflTradeRetainedExternalCapturePlan({
        environment: 'test_fixture',
        competition: 'AFLM',
        plannedAt,
        scopeEvidence: [...draft.scopeEvidence, ...trade.scopeEvidence].sort((a, b) =>
          a.artifactId.localeCompare(b.artifactId)
        ),
        targets: [draft.target, trade.target].sort((a, b) =>
          a.captureId.localeCompare(b.captureId)
        ),
      });
      await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, {
        read: async (ref) => {
          for (const repo of [
            draft.raw,
            draft.metadata,
            trade.raw,
            trade.metadata,
            official.raw,
            official.metadata,
            second.raw,
            second.metadata,
          ]) {
            const value = await repo.loadExact(ref, 2097152);
            if (value) return value.bytes;
          }
          throw new Error('Missing retained fixture bytes');
        },
      });
      const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
        sql
      ).completeRetainedPlan(plan.planId);
      const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
      const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
      const actor = 'synthetic-retained-selection-reviewer';
      async function authority(role: string, provider: string, capabilityId: string) {
        const at = await databaseInstant();
        const document = {
          evidenceKind: 'reviewer_authority_evidence',
          environment: 'test_fixture',
          principalRef: actor,
          role,
          provider,
          capabilityId,
          scopeKey: 'public-afl-draft-trade-outcomes',
          competition: 'AFLM',
          validFromSeason: 2024,
          validThroughSeason: 2024,
        };
        const referenceId = address('reviewer-authority-evidence', document),
          digest = sha(document),
          ref = createAflTradeCanonicalJsonArtifactRef(document, at);
        await draft.metadata.putIfAbsent(ref, new TextEncoder().encode(canonical(document)));
        const approval = address('governed-evidence-approval-decision', { referenceId });
        await sql.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO outcome_artifact_custody(artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json) VALUES($1,$2,$3,$4,$5,'capture_metadata','test_fixture',$6,$6,'{}')`,
            [ref.artifactId, ref.contentSha256, ref.storageUri, ref.mediaType, ref.byteLength, at]
          );
          await tx.query(
            `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at) VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic scoped technical authority',$3::jsonb,$4,$5)`,
            [approval, referenceId, canonical({ referenceSha256: digest }), actor, at]
          );
          await tx.query(
            `INSERT INTO outcome_governed_evidence_reference(reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json) VALUES($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6::text,($6::text)::jsonb)`,
            [referenceId, digest, ref.artifactId, approval, at, canonical(document)]
          );
          await tx.query(
            `INSERT INTO outcome_operational_principal_authority(authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through) VALUES($1,$2,$3,'public-afl-draft-trade-outcomes',$4,$5,'AFLM',2024,2024,$6,NULL)`,
            [referenceId, actor, role, provider, capabilityId, at]
          );
        });
        return referenceId;
      }
      const identityAuthority = await authority(
        'afl_trade_external_identity_reviewer',
        'draftguru',
        'external_identity_resolution'
      );
      const promoterAuthority = await authority(
        'afl_trade_canonical_promoter',
        'multi_source',
        'external_candidate_promotion'
      );
      const queue = await loadAflTradeExternalIdentityReviewQueue(
        { completionId: completion.completionId },
        { source, reviewRepository }
      );
      expect(queue.items.filter((i) => i.entityKind === 'player')).toHaveLength(
        supplementalSelection ? 70 : 71
      );
      const targetIds = new Map<string, string>();
      const identityReviewedAt = await databaseInstant();
      for (const [index, item] of queue.items.entries()) {
        const key = item.entityKind + '|' + item.observedNames[0];
        const canonicalId = targetIds.get(key) ?? `synthetic-selection-${item.entityKind}-${index}`;
        const existing = targetIds.has(key);
        targetIds.set(key, canonicalId);
        // Canonical targets are synthetic fixture setup; decisions use the public owner.
        if (!existing && item.entityKind === 'player')
          await pool.query(
            `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')`,
            [canonicalId, item.observedNames[0]]
          );
        else if (!existing)
          await pool.query(
            `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved')`,
            [canonicalId, item.observedNames[0]]
          );
        await recordAflTradeExternalIdentityReviewDecision(
          {
            completionId: completion.completionId,
            subjectId: item.subjectId,
            decision: 'approved',
            canonicalId,
            rationale: 'Synthetic exact native identity',
            authorityEvidenceId: identityAuthority,
            decidedBy: actor,
            decidedAt: identityReviewedAt,
          },
          { source, reviewRepository }
        );
      }
      const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(sql);
      const prepared = await prepareAflTradeHistoricalReconciliation(
        { completionId: completion.completionId },
        { source, identityReviewRepository: reviewRepository, candidateRepository }
      );
      const reviews = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);
      const reconciled = parseAflTradeExternalReconciliationCandidate(
        (
          await pool.query(
            'SELECT candidate_json FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1',
            [prepared.candidateId]
          )
        ).rows[0].candidate_json
      );
      // The synthetic source parent explicitly models usable year-only facts; reviewed owners bind all later changes.
      const original = createAflTradeExternalReconciliationCandidate({
        ...reconciled.content,
        transactions: reconciled.content.transactions.map((t) => ({
          ...t,
          status: 'single_source' as const,
        })),
        pickCustody: [],
        pickLineage: [],
      });
      const originalResolutions = (
        await pool.query(
          'SELECT resolution_json FROM outcome_external_reconciliation_identity_resolution WHERE candidate_id=$1',
          [reconciled.candidateId]
        )
      ).rows.map((r) => r.resolution_json);
      await candidateRepository.persistCandidate({
        candidate: original,
        identityResolutions: originalResolutions,
      });
      const selected = original.content.draftSelections.find(
        (s) => s.selectionNumber === (enumerated ? 97 : 71)
      )!;
      const transfer = original.content.transfers[0]!;
      const registration = createReviewedPickLineageRegistration({
        candidate: original,
        proposedAt: await databaseInstant(),
        records: [
          {
            schemaVersion: 'afl-trade-reviewed-pick-lineage/v1',
            candidateId: original.candidateId,
            transferId: transfer.transferId,
            retainedSourceLabel: `Pick ${enumerated ? 97 : 71}`,
            acceptedTradeTimePick: enumerated ? 97 : 71,
            originalClubId: null,
            movements: [
              {
                transferId: transfer.transferId,
                fromClubId: transfer.fromClubId!,
                toClubId: transfer.toClubId!,
                occurredAt: { precision: 'year', year: 2024 },
                predecessorOrdinal: null,
              },
            ],
            endpoint: {
              kind: 'selected',
              draftYear: 2024,
              draftType: 'national',
              livePick: enumerated ? 97 : 71,
              playerId: selected.playerId!,
              recordedPlayerName: 'Synthetic Player 70',
              exercisingClubId: selected.clubId!,
            },
            attribution: 'direct',
            evidence: [trade.target.sourceArtifact],
          },
        ],
      });
      const evidence = {
        ...reviewedPickLineageApprovalEvidence(registration),
        authorityEvidenceId: promoterAuthority,
      };
      const approval = address('review-decision', evidence);
      await pool.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES($1,'reviewed_pick_lineage_registration',$2,'approved','Synthetic exact pick review',$3::jsonb,$4,$5)`,
        [approval, registration.registrationId, canonical(evidence), actor, await databaseInstant()]
      );
      const promotions = new PostgresAflTradeExternalCanonicalPromotionRepository(sql);
      await promotions.registerReviewedPickLineage({ registration, approvalDecisionId: approval });
      const scoped = buildReviewedAdmissionScope({
        sourceCandidate: original,
        originalCandidate: original,
        registration,
      });
      await candidateRepository.persistCandidate({
        candidate: scoped,
        identityResolutions: originalResolutions,
      });
      const ordinary = await promotions.prepareReviewedOrdinaryCorrection({
        scopeCandidateId: scoped.candidateId,
        environment: 'test_fixture',
      });
      await candidateRepository.persistCandidate({
        candidate: ordinary.candidate,
        identityResolutions: originalResolutions,
      });
      const expandedPlan = createAflTradeRetainedExternalCapturePlan({
        environment: 'test_fixture',
        competition: 'AFLM',
        plannedAt: await databaseInstant(),
        scopeEvidence: [
          ...draft.scopeEvidence,
          ...trade.scopeEvidence,
          ...official.scopeEvidence,
          ...second.scopeEvidence,
        ].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
        targets: [draft.target, trade.target, official.target, second.target].sort((a, b) =>
          b.evidenceBatchId.localeCompare(a.evidenceBatchId)
        ),
      });
      await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(expandedPlan, {
        read: async (ref) => {
          for (const repo of [
            draft.raw,
            draft.metadata,
            trade.raw,
            trade.metadata,
            official.raw,
            official.metadata,
            second.raw,
            second.metadata,
          ]) {
            const value = await repo.loadExact(ref, 2097152);
            if (value) return value.bytes;
          }
          throw new Error('Missing retained fixture bytes');
        },
      });
      const expanded = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
        sql
      ).completeRetainedPlan(expandedPlan.planId);
      if (enumerated) {
        const officialAuthority = await authority(
          'afl_trade_external_identity_reviewer',
          'official_afl',
          'external_identity_resolution'
        );
        const boundaryQueue = await loadAflTradeExternalIdentityReviewQueue(
          { completionId: expanded.completionId },
          { source, reviewRepository }
        );
        for (const item of boundaryQueue.items.filter((item) => item.provider === 'official_afl')) {
          const canonicalId = targetIds.get(item.entityKind + '|' + item.observedNames[0]);
          if (
            supplementalSelection &&
            item.entityKind === 'player' &&
            item.observedNames[0] === 'Synthetic Player 34'
          ) {
            // Interior inventory evidence does not require an unrelated canonical player target.
            expect(canonicalId).toBeUndefined();
            continue;
          }
          expect(canonicalId).toBeDefined();
          await recordAflTradeExternalIdentityReviewDecision(
            {
              completionId: expanded.completionId,
              subjectId: item.subjectId,
              decision: 'approved',
              canonicalId: canonicalId!,
              rationale: 'Synthetic exact boundary identity reused from retained inventory',
              authorityEvidenceId: officialAuthority,
              decidedBy: actor,
              decidedAt: await databaseInstant(),
            },
            { source, reviewRepository }
          );
        }
      }
      const expandedSource = await source.load(expanded.completionId);
      const expandedIds = expandedSource.sourceBatches.map((b) => b.batchId).sort();
      expect(
        ordinary.candidate.content.sourceBatchIds.every((id) => expandedIds.includes(id)),
        JSON.stringify({ parent: ordinary.candidate.content.sourceBatchIds, expanded: expandedIds })
      ).toBe(true);
      expect(expandedSource.sourceAuthority.completionSourceBatchSetSha256).toBe(
        sha(expandedSource.sourceBatches.map((b) => b.batchId))
      );
      if (supplementalSelection) {
        for (const patch of [
          { selectionNumber: 34 },
          { draftYear: 2023 },
          { draftType: 'rookie' as const },
        ]) {
          const changed = expandedSource.sourceBatches.map((batch) => {
            if (batch.batchId !== official.target.evidenceBatchId) return batch;
            return createAflTradeExternalEvidenceBatch({
              ...batch.content,
              evidence: batch.content.evidence.map((row) =>
                row.content.claim.kind === 'draft_selection'
                  ? createAflTradeExternalEvidenceEnvelope({
                      ...row.content,
                      claim: { ...row.content.claim, ...patch },
                    })
                  : row
              ),
            });
          });
          expect(() =>
            buildReviewedSessionCorrection({
              candidate: ordinary.candidate,
              sourceBatches: changed,
              sourceAuthority: {
                ...expandedSource.sourceAuthority,
                candidateSourceBatchSetSha256: sha(changed.map((b) => b.batchId).sort()),
                completionSourceBatchSetSha256: sha(changed.map((b) => b.batchId)),
              },
              identityResolutions: originalResolutions,
            })
          ).toThrow(/absent official selections in relevant drafts/);
        }
      }
      const built = await sql.transaction((tx) =>
        prepareReviewedSessionCorrection(tx, {
          parentCandidateId: ordinary.candidate.candidateId,
          completionId: expanded.completionId,
          environment: 'test_fixture',
        })
      );
      const current = await reviewRepository.loadCurrentResolutions(
        buildAflTradeExternalIdentityReviewPackage(await source.load(expanded.completionId))
      );
      const resolutions = [
        ...new Map(
          [...originalResolutions, ...current].map((r) => {
            const v = r as (typeof current)[number];
            return [v.resolutionId, v] as const;
          })
        ).values(),
      ];
      const candidate = built.candidate;
      await candidateRepository.persistCandidate({ candidate, identityResolutions: resolutions });
      expect(candidate.content.draftSelections).toHaveLength(1);
      expect(
        candidate.content.reviewedSessionCorrection!.projections[0].inventorySelectionIds
      ).toHaveLength(71);
      if (sessionWindow) {
        expect(candidate.content.reviewedSessionCorrection!.projections[0].schemaVersion).toBe(
          'afl-trade-combined-draft-session-projection/v2'
        );
        expect(await reviews.loadCandidate(candidate.candidateId)).toEqual(candidate);
        await candidateRepository.persistCandidate({ candidate, identityResolutions: resolutions });
        const check = async (document: unknown) =>
          (
            await pool.query(
              'SELECT outcome_reviewed_session_inventory_exact($1::jsonb,$2::jsonb) AS valid',
              [canonical(document), canonical(resolutions)]
            )
          ).rows[0].valid;
        expect(await check(candidate)).toBe(true);
        const altered = JSON.parse(JSON.stringify(candidate));
        const projection = altered.content.reviewedSessionCorrection.projections[0];
        projection.inventorySessions[1].datePrecision.latestDate = '2024-11-26';
        projection.selectedSessions[0].datePrecision.latestDate = '2024-11-26';
        expect(await check(altered)).toBe(false);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL session_replication_role=replica');
          await client.query(
            "UPDATE outcome_source_capture SET status='rejected' WHERE capture_id=$1",
            [second.target.captureId]
          );
          expect(
            (
              await client.query(
                'SELECT outcome_reviewed_session_inventory_exact($1::jsonb,$2::jsonb) AS valid',
                [canonical(candidate), canonical(resolutions)]
              )
            ).rows[0].valid
          ).toBe(false);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        expect(await check(candidate)).toBe(true);
        return;
      }
      const proposal = deriveReviewedSessionCanonicalPromotionProposal({
        candidate,
        proposedAt: await databaseInstant(),
        transactionDates: candidate.content.transactions.map((t) => ({
          transactionId: t.transactionId,
          occurredOn: t.occurredOn,
        })),
      });
      expect(proposal.content.draftEventCoverage[0]).toMatchObject({
        sessionOrdinal: 2,
        expectedSelectionCount: 1,
      });
      const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
        candidateId: candidate.candidateId,
        proposalId: proposal.proposalId,
        proposalSha256: proposal.proposalId.split(':')[1]!,
        proposal,
        revision: 1,
        supersedesDecisionId: null,
        decision: 'approved',
        rationale: 'Synthetic complete dated selections; prior pick ownership remains unknown',
        authorityEvidenceId: promoterAuthority,
        decidedBy: actor,
        decidedAt: await databaseInstant(),
      });
      await reviews.persistDecision({ candidate, proposal, decision });

      const input = { candidateId: candidate.candidateId, approvalDecisionId: decision.decisionId };
      const result = await promotions.promote(input);
      expect(result).toMatchObject({
        status: 'finalized',
        draftSelectionCount: 1,
        draftPlayerAssetCount: 1,
        pickCustodyCount: 1,
        pickRealizationCount: 1,
        idempotentReplay: false,
      });
      expect(await promotions.promote(input)).toEqual({ ...result, idempotentReplay: true });
      expect((await reviews.loadCandidate(candidate.candidateId)).content.pickCustody).toHaveLength(
        1
      );
      const retainedArtifacts = new Map();
      for (const fixture of [draft, trade, official, second]) {
        const ref = fixture.target.sourceArtifact;
        const retained = await fixture.raw.loadExact(ref, 2097152);
        if (!retained) throw new Error('Missing actual fixture source bytes');
        retainedArtifacts.set(ref.artifactId, { reference: ref, bytes: retained.bytes });
      }
      const assets = (
        await pool.query<{
          event_date: string;
          event_id: string;
          event_version_id: string;
          asset_version_id: string;
          player_id: string;
        }>(
          `SELECT event.event_date::TEXT,event.event_id,event.event_version_id,asset.asset_version_id,asset.player_id
     FROM outcome_external_canonical_promotion_record member JOIN outcome_event_asset asset ON asset.asset_version_id=member.canonical_record_id
     JOIN outcome_event_version event ON event.event_version_id=asset.event_version_id WHERE member.promotion_id=$1 AND member.record_kind='draft_player_asset'`,
          [result.promotionId]
        )
      ).rows;
      const draftEntries = [];
      for (const asset of assets) {
        const refs = (
          await pool.query<{ artifact_id: string }>(
            `SELECT DISTINCT capture.source_artifact_id AS artifact_id
      FROM outcome_external_canonical_promotion_record member CROSS JOIN LATERAL jsonb_array_elements_text(member.evidence_ids) id(value)
      JOIN outcome_external_evidence_row row ON row.evidence_id=id.value JOIN outcome_external_evidence_batch batch ON batch.batch_id=row.batch_id
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id WHERE member.promotion_id=$1 AND member.canonical_record_id IN ($2,$3) ORDER BY artifact_id`,
            [result.promotionId, asset.asset_version_id, asset.event_version_id]
          )
        ).rows;
        draftEntries.push({
          ...asset,
          entry: {
            promotionId: result.promotionId,
            eventVersionId: asset.event_version_id,
            assetVersionId: asset.asset_version_id,
            eventDate: asset.event_date,
            evidence: refs.map((r) => {
              const retained = retainedArtifacts.get(r.artifact_id);
              if (!retained) throw new Error('Missing promoted evidence');
              return retained.reference;
            }),
          },
        });
      }
      await verifySessionAcquisitionCurrentness(pool, {
        candidate,
        retainedArtifacts,
        sourceArtifact: draft.target.sourceArtifact,
        draftEntries,
        clubId: selected.clubId!,
      });
      // Check the externally persisted unknown, in addition to the public receipt.
      expect(
        (await pool.query('SELECT DISTINCT original_club_id FROM outcome_draft_pick')).rows
      ).toEqual([{ original_club_id: null }]);
    }
  );
});
