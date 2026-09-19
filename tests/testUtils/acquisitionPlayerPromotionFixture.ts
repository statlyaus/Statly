import { completeSyntheticCaptureReceipt } from './completeSyntheticCaptureReceipt';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeByteArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeExternalCanonicalPromotionProposal,
  AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalHistoricalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalCaptureScheduleRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeScheduleRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';

import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';

// Synthetic source parents only. Candidate, review and canonical promotion use public owners.
export async function createSyntheticAcquisitionPlayerPromotion(
  outcomesPool: Pool,
  options: {
    /** Optional complete synthetic capture envelope for factual-release owner tests. */
    fixtureCaptureExecutionReceipt?: unknown;
    /** Full synthetic admitted receipts for private release/measurement composition tests. */
    completeCaptureReceipts?: boolean;
    tradeSeasonYear?: number;
    candidateAnchorSeasonYear?: number;
    providerEventId?: string;
    promoterThroughSeason?: number;
    draftSessions?: boolean;
    sessionProposalV5?: boolean;
    mixedDraftSessionProofs?: boolean;
    partialTransactionDates?: boolean;
    combinedDraftSessions?: boolean;
    official2017CombinedDraft?: boolean;
    officialCombinedDraftYear?: 2016 | 2017;
    existingDraftTargets?: readonly [
      { playerId: string; playerName: string; clubId: string; clubName: string },
      { playerId: string; playerName: string; clubId: string; clubName: string },
    ];
    lifecycle?: boolean;
    reciprocalPlayer?: boolean;
    reciprocalFuturePickYearOffset?: number;
    environment?: 'test_fixture' | 'non_production';
    existingTargets?: {
      playerId: string;
      playerName: string;
      fromClubId: string;
      fromClubName: string;
      toClubId: string;
      toClubName: string;
    };
  } = {}
) {
  if (
    options.fixtureCaptureExecutionReceipt !== undefined &&
    options.environment === 'non_production'
  )
    throw new Error('Synthetic capture envelope overrides are limited to test_fixture.');
  if (options.partialTransactionDates && (!options.sessionProposalV5 || options.lifecycle))
    throw new Error(
      'Partial trade dates require the v5 session profile without an exact-date lifecycle.'
    );
  if (
    options.mixedDraftSessionProofs &&
    (!options.sessionProposalV5 ||
      !options.combinedDraftSessions ||
      options.officialCombinedDraftYear ||
      options.official2017CombinedDraft)
  )
    throw new Error('Mixed proof fixture requires synthetic v5 combined-session profile.');
  if (options.reciprocalPlayer && options.reciprocalFuturePickYearOffset !== undefined)
    throw new Error('Choose one reciprocal synthetic asset.');
  if (
    options.reciprocalFuturePickYearOffset !== undefined &&
    (!Number.isSafeInteger(options.reciprocalFuturePickYearOffset) ||
      options.reciprocalFuturePickYearOffset < 1)
  )
    throw new Error('Reciprocal future-pick year offset must be a positive integer.');
  const hasDraftSessions = options.draftSessions || options.combinedDraftSessions;
  if (options.official2017CombinedDraft && options.officialCombinedDraftYear)
    throw new Error('Choose one reviewed Official combined-draft profile.');
  const officialCombinedDraftYear =
    options.officialCombinedDraftYear ?? (options.official2017CombinedDraft ? 2017 : null);
  const reviewedOfficialCombinedDraft = officialCombinedDraftYear !== null;
  if (reviewedOfficialCombinedDraft && !options.combinedDraftSessions)
    throw new Error('A reviewed Official profile requires combined draft sessions.');
  if (options.tradeSeasonYear !== undefined && (hasDraftSessions || options.lifecycle))
    throw new Error('Custom year is limited to simple synthetic trades.');
  const seasonYear = officialCombinedDraftYear ?? options.tradeSeasonYear ?? 2024;
  const candidateAnchorSeasonYear = options.candidateAnchorSeasonYear ?? seasonYear;
  if (
    candidateAnchorSeasonYear !== seasonYear &&
    (options.reciprocalFuturePickYearOffset === undefined ||
      candidateAnchorSeasonYear !== seasonYear + options.reciprocalFuturePickYearOffset)
  )
    throw new Error('Synthetic candidate anchor must be represented by its future pick year.');
  const fixtureNamespace = reviewedOfficialCombinedDraft
    ? `official-${seasonYear}`
    : 'synthetic-2024';
  const providerEventId =
    options.providerEventId ??
    (reviewedOfficialCombinedDraft
      ? `official-${seasonYear}-promotion-fixture`
      : 'promotion-fixture');
  if (providerEventId.trim().length === 0) throw new Error('Provider event ID is required.');
  const tradeDate = options.partialTransactionDates ? null : `${seasonYear}-10-15`;
  const nativePlayerId = reviewedOfficialCombinedDraft
    ? `official-${seasonYear}-player`
    : 'synthetic-player';
  const officialSelectionCount =
    officialCombinedDraftYear === 2016 ? 77 : officialCombinedDraftYear === 2017 ? 78 : null;
  const officialTerminalClubId = reviewedOfficialCombinedDraft
    ? `official-${seasonYear}-${seasonYear === 2016 ? 'west-coast' : 'carlton'}`
    : null;
  if (options.existingDraftTargets && !hasDraftSessions)
    throw new Error('Existing draft targets require draft sessions.');
  const environment = options.environment ?? 'test_fixture';
  const targets =
    options.existingTargets ??
    (reviewedOfficialCombinedDraft
      ? seasonYear === 2016
        ? {
            playerId: 'official-2016-acquisition-player',
            playerName: 'Official 2016 Acquisition Player',
            fromClubId: 'official-2016-gws',
            fromClubName: 'GWS',
            toClubId: 'official-2016-essendon',
            toClubName: 'Essendon',
          }
        : {
            playerId: 'official-2017-acquisition-player',
            playerName: 'Official 2017 Acquisition Player',
            fromClubId: 'official-2017-gws',
            fromClubName: 'GWS',
            toClubId: 'official-2017-brisbane-lions',
            toClubName: 'Brisbane Lions',
          }
      : {
          playerId: 'synthetic-acquisition-player',
          playerName: 'Synthetic Player',
          fromClubId: 'club-gws',
          fromClubName: 'GWS',
          toClubId: 'club-western-bulldogs',
          toClubName: 'Western Bulldogs',
        });
  if (environment !== 'test_fixture' && environment !== 'non_production')
    throw new Error('Synthetic acquisition fixture scope invalid.');
  const retainedArtifacts = new Map<
    string,
    { reference: AflTradeArtifactRef; bytes: Uint8Array }
  >();
  const sourceBytes = new TextEncoder().encode(
    options.lifecycle
      ? `<p>${targets.playerName} joined ${targets.toClubName} on ${seasonYear}-10-15, moved to ${targets.fromClubName} on ${seasonYear}-10-20, and returned to ${targets.toClubName} on ${seasonYear}-10-25.</p>`
      : `<p>${targets.playerName} joined ${targets.toClubName}${tradeDate === null ? ` during ${seasonYear}` : ` on ${tradeDate}`}.</p>`
  );
  const sourceArtifact = createAflTradeByteArtifactRef(
    sourceBytes,
    'text/html',
    `${seasonYear}-11-01T00:00:00.000Z`
  );
  const sha = (character: string) => character.repeat(64);
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const capturedAt = new Date(Date.now() - 120_000).toISOString();
  const syntheticAdmission = {
    schemaVersion: 'afl-trade-external-capture-execution/v2',
    admission: { leaseExpiresAt: new Date(Date.now() + 600_000).toISOString() },
  };
  const plannedAt = new Date(Date.parse(capturedAt) + 30_000).toISOString();
  const indexBytes = new TextEncoder().encode(
    `<a href="/trades/${seasonYear}-alpha-trade">Synthetic ${seasonYear} trade</a>`
  );
  const sourceSha256 = digest(new TextDecoder().decode(indexBytes));
  const artifactId = `artifact:${sourceSha256}`;
  const captureId = `source-capture:${digest(`index-${fixtureNamespace}`)}`;
  const transactionId = createAflTradeContentAddress('external-transaction', {
    provider: 'draftguru',
    nativeEventId: providerEventId,
  });
  const transferId = createAflTradeContentAddress('external-transfer', {
    transactionId,
    nativeTransferId: nativePlayerId,
  });
  const reciprocalFuturePickTransferId = createAflTradeContentAddress('external-transfer', {
    transactionId,
    nativeTransferId: 'synthetic-reciprocal-future-pick',
  });
  const reciprocalFuturePickId = createAflTradeContentAddress('draft-pick', {
    draftYear: seasonYear + (options.reciprocalFuturePickYearOffset ?? 1),
    draftType: 'national',
    roundNumber: 1,
    originalClubId: targets.toClubId,
  });
  const reciprocalFuturePickCustodyId = createAflTradeContentAddress('external-pick-custody', {
    pickId: reciprocalFuturePickId,
    observedAt: `${seasonYear}-10-15T00:00:00.000Z`,
    currentClubId: targets.fromClubId,
  });
  let reviewedAt: string;
  async function databaseNow() {
    const result = await outcomesPool.query<{ at: Date }>(
      "SELECT date_trunc('milliseconds',clock_timestamp()) AS at"
    );
    return result.rows[0]!.at.toISOString();
  }
  async function nextIdentityRevision(subjectId: string) {
    const result = await outcomesPool.query<{ decision_id: string; revision: number }>(
      `SELECT decision_id,revision FROM outcome_external_identity_resolution_head
        WHERE subject_id=$1`,
      [subjectId]
    );
    const head = result.rows[0];
    return {
      revision: head === undefined ? 1 : Number(head.revision) + 1,
      supersedesDecisionId: head?.decision_id ?? null,
    };
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
        sourceRow: { ordinal: 1, sourceKey: `${seasonYear}-alpha-trade` },
        claim: {
          kind: 'trade_detail_link',
          nativeEventId: `${seasonYear}-alpha-trade`,
          anchorSeasonYear: seasonYear,
          sourceUrl: `https://www.draftguru.com.au/trades/${seasonYear}-alpha-trade`,
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
       SELECT 'AFLM',unnest($1::integer[]) ON CONFLICT DO NOTHING`,
      [
        [
          seasonYear,
          ...(options.reciprocalFuturePickYearOffset === undefined
            ? []
            : [seasonYear + options.reciprocalFuturePickYearOffset]),
        ],
      ]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'text/html',$5,'raw_source','${environment}',$4,$4,'{}'::jsonb)`,
      [
        artifactId,
        sourceSha256,
        `artifact://sha256/${sourceSha256}`,
        capturedAt,
        indexBytes.byteLength,
      ]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ($2,'${environment}','draftguru','trade-index',
             'draftguru-trade-index','captured',$1,$1,'{}'::jsonb)`,
      [capturedAt, `attempt-discovery-${fixtureNamespace}`]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_source_capture
      (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
       dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
       captured_at,status,manifest_json)
     VALUES ($1,$6,$7,$2,'${environment}','draftguru',
             'trade-index','2026-08-10','automated_web','draftguru-trade-index','AFLM',$5,
             $3,$3,'approved',$4::jsonb)`,
      [
        captureId,
        artifactId,
        capturedAt,
        canonicalizeAflTradeJson({
          sourceUrl: 'https://www.draftguru.com.au/trades',
          executionReceipt: {
            content: { ...syntheticAdmission, request: { discoveryFromSeasonYear: seasonYear } },
          },
        }),
        seasonYear,
        `attempt-discovery-${fixtureNamespace}`,
        `snapshot-discovery-${fixtureNamespace}`,
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
    const targetBytes =
      request.capabilityId === 'draftguru-trade-detail'
        ? sourceBytes
        : new TextEncoder().encode(`<p>Synthetic ${seasonYear} draft selection.</p>`);
    const targetArtifact =
      request.capabilityId === 'draftguru-trade-detail'
        ? sourceArtifact
        : createAflTradeByteArtifactRef(targetBytes, 'text/html', capturedAt);
    retainedArtifacts.set(targetArtifact.artifactId, {
      reference: targetArtifact,
      bytes: targetBytes,
    });
    const contentSha256 = targetArtifact.contentSha256;
    const targetArtifactId = `artifact:${contentSha256}`;
    const targetCaptureId = `source-capture:${digest(
      `historical-completion-capture-${fixtureNamespace}-${index}`
    )}`;
    const attemptId = `attempt-historical-completion-${fixtureNamespace}-${index}`;
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
    function selectionPlayerName(selectionNumber: number) {
      return reviewedOfficialCombinedDraft
        ? selectionNumber === 1
          ? seasonYear === 2016
            ? 'Andrew McGrath'
            : 'Cameron Rayner'
          : selectionNumber === officialSelectionCount
            ? seasonYear === 2016
              ? 'Jake Waterman'
              : 'Jarrod Garlett'
            : `${seasonYear} Player ${selectionNumber}`
        : (options.existingDraftTargets?.[selectionNumber - 1]?.playerName ??
            (selectionNumber === 1 ? `Player ${index}` : 'Synthetic second draft player'));
    }

    function selectionClubName(selectionNumber: number) {
      return reviewedOfficialCombinedDraft
        ? selectionNumber === 1
          ? targets.toClubName
          : selectionNumber === officialSelectionCount
            ? seasonYear === 2016
              ? 'West Coast'
              : 'Carlton'
            : targets.toClubName
        : (options.existingDraftTargets?.[selectionNumber - 1]?.clubName ??
            (options.combinedDraftSessions ? targets.toClubName : `Club ${index}`));
    }

    function buildTargetEvidence() {
      const draftSelectionClaim = (selectionNumber: number) => ({
        kind: 'draft_selection' as const,
        draftYear: request.anchorSeasonYear,
        draftType:
          options.mixedDraftSessionProofs && selectionNumber === 3
            ? ('rookie' as const)
            : ('national' as const),
        selectionNumber:
          options.mixedDraftSessionProofs && selectionNumber === 3 ? 1 : selectionNumber,
        roundNumber: 1,
        player: {
          nativeId: reviewedOfficialCombinedDraft
            ? `official-${seasonYear}-player-${selectionNumber}`
            : `draft-player-${selectionNumber}`,
          recordedName: selectionPlayerName(selectionNumber),
        },
        selectedByClub: {
          nativeId: reviewedOfficialCombinedDraft
            ? `official-${seasonYear}-club-${selectionNumber}`
            : `draft-club-${selectionNumber}`,
          recordedName: selectionClubName(selectionNumber),
        },
      });
      const evidence = createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'draftguru',
        capture: evidenceCapture,
        sourceRow: { ordinal: 1, sourceKey: `completion-${index}` },
        claim:
          request.capabilityId === 'draftguru-trade-detail'
            ? {
                kind: 'directed_transfer' as const,
                nativeEventId: providerEventId,
                nativeTransferId: nativePlayerId,
                fromClub: { nativeId: null, recordedName: targets.fromClubName },
                toClub: { nativeId: null, recordedName: targets.toClubName },
                asset: {
                  kind: 'player' as const,
                  player: { nativeId: nativePlayerId, recordedName: targets.playerName },
                },
              }
            : draftSelectionClaim(hasDraftSessions ? 1 : index + 1),
        publicationEligible: false,
      });
      const targetEvidence = [evidence];
      if (options.reciprocalPlayer && request.capabilityId === 'draftguru-trade-detail') {
        targetEvidence.push(
          createAflTradeExternalEvidenceEnvelope({
            ...evidence.content,
            sourceRow: { ordinal: 20, sourceKey: 'synthetic-reciprocal-player' },
            claim: {
              kind: 'directed_transfer',
              nativeEventId: providerEventId,
              nativeTransferId: 'synthetic-reciprocal-player',
              fromClub: { nativeId: null, recordedName: targets.toClubName },
              toClub: { nativeId: null, recordedName: targets.fromClubName },
              asset: {
                kind: 'player',
                player: {
                  nativeId: 'synthetic-reciprocal-player',
                  recordedName: 'Synthetic Reciprocal Player',
                },
              },
            },
          })
        );
      }
      if (
        options.reciprocalFuturePickYearOffset !== undefined &&
        request.capabilityId === 'draftguru-trade-detail'
      ) {
        targetEvidence.push(
          createAflTradeExternalEvidenceEnvelope({
            ...evidence.content,
            sourceRow: { ordinal: 20, sourceKey: 'synthetic-reciprocal-future-pick' },
            claim: {
              kind: 'directed_transfer',
              nativeEventId: providerEventId,
              nativeTransferId: 'synthetic-reciprocal-future-pick',
              fromClub: { nativeId: null, recordedName: targets.toClubName },
              toClub: { nativeId: null, recordedName: targets.fromClubName },
              asset: {
                kind: 'future_pick',
                draftYear: seasonYear + options.reciprocalFuturePickYearOffset,
                draftType: 'national',
                roundNumber: 1,
                originalClub: { nativeId: null, recordedName: targets.toClubName },
              },
            },
          })
        );
      }

      if (hasDraftSessions && evidence.content.claim.kind === 'draft_selection') {
        const selectionCount = options.mixedDraftSessionProofs ? 3 : (officialSelectionCount ?? 2);
        for (let selectionNumber = 2; selectionNumber <= selectionCount; selectionNumber += 1) {
          targetEvidence.push(
            createAflTradeExternalEvidenceEnvelope({
              ...evidence.content,
              sourceRow: {
                ordinal: selectionNumber,
                sourceKey: `completion-${index}-selection-${selectionNumber}`,
              },
              claim: draftSelectionClaim(selectionNumber),
            })
          );
        }
      }
      if (request.capabilityId === 'draftguru-trade-detail') {
        targetEvidence.push(
          createAflTradeExternalEvidenceEnvelope({
            schemaVersion: 'afl-trade-external-evidence/v1',
            provider: 'draftguru',
            capture: evidenceCapture,
            sourceRow: { ordinal: 2, sourceKey: `completion-${index}-transaction` },
            claim: {
              kind: 'transaction',
              nativeEventId: providerEventId,
              seasonYear,
              occurredOn: tradeDate,
              transactionType: 'trade',
              title: 'Synthetic player entry',
            },
            publicationEligible: false,
          })
        );
        if (reviewedOfficialCombinedDraft) {
          for (const [partyIndex, party] of [
            { nativePartyId: `official-${seasonYear}-from`, recordedName: targets.fromClubName },
            { nativePartyId: `official-${seasonYear}-to`, recordedName: targets.toClubName },
          ].entries()) {
            targetEvidence.push(
              createAflTradeExternalEvidenceEnvelope({
                ...evidence.content,
                sourceRow: {
                  ordinal: 3 + partyIndex,
                  sourceKey: `official-2017-party-${partyIndex + 1}`,
                },
                claim: {
                  kind: 'transaction_party',
                  nativeEventId: providerEventId,
                  nativePartyId: party.nativePartyId,
                  club: { nativeId: null, recordedName: party.recordedName },
                },
              })
            );
          }
        }
        if (options.lifecycle) {
          for (const [index, transition] of [
            {
              nativeEventId: 'synthetic-departure',
              date: `${seasonYear}-10-20`,
              from: targets.toClubName,
              to: targets.fromClubName,
            },
            {
              nativeEventId: 'synthetic-return',
              date: `${seasonYear}-10-25`,
              from: targets.fromClubName,
              to: targets.toClubName,
            },
          ].entries()) {
            targetEvidence.push(
              createAflTradeExternalEvidenceEnvelope({
                ...evidence.content,
                sourceRow: { ordinal: 3 + index * 2, sourceKey: transition.nativeEventId },
                claim: {
                  kind: 'directed_transfer',
                  nativeEventId: transition.nativeEventId,
                  nativeTransferId: nativePlayerId,
                  fromClub: { nativeId: null, recordedName: transition.from },
                  toClub: { nativeId: null, recordedName: transition.to },
                  asset: {
                    kind: 'player',
                    player: { nativeId: nativePlayerId, recordedName: targets.playerName },
                  },
                },
              })
            );
            targetEvidence.push(
              createAflTradeExternalEvidenceEnvelope({
                ...evidence.content,
                sourceRow: {
                  ordinal: 4 + index * 2,
                  sourceKey: `${transition.nativeEventId}-transaction`,
                },
                claim: {
                  kind: 'transaction',
                  nativeEventId: transition.nativeEventId,
                  seasonYear,
                  occurredOn: transition.date,
                  transactionType: 'trade',
                  title: transition.nativeEventId,
                },
              })
            );
          }
        }
      }
      return targetEvidence;
    }
    const targetEvidence = buildTargetEvidence().sort(
      (a, b) => a.content.sourceRow.ordinal - b.content.sourceRow.ordinal
    );
    const batch = createAflTradeExternalEvidenceBatch({
      schemaVersion: 'afl-trade-external-evidence-batch/v1',
      provider: 'draftguru',
      captureId: targetCaptureId,
      evidence: targetEvidence,
      finalizedAt: capturedAt,
      publicationEligible: false,
    });
    await outcomesPool.query(
      `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'text/html',$5,'raw_source','${environment}',$4,$4,'{}'::jsonb)`,
      [
        targetArtifactId,
        contentSha256,
        `artifact://sha256/${contentSha256}`,
        targetArtifact.createdAt,
        targetBytes.byteLength,
      ]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ($1,'${environment}','draftguru',$2,$3,'captured',$4,$4,'{}'::jsonb)`,
      [attemptId, request.dataset, request.capabilityId, capturedAt]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_source_capture
      (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
       dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
       captured_at,status,manifest_json)
     VALUES ($1,$2,$3,$4,'${environment}','draftguru',$5,$6,'automated_web',$7,'AFLM',$8,
             $9,$9,'approved',$10::jsonb)`,
      [
        targetCaptureId,
        attemptId,
        options.fixtureCaptureExecutionReceipt === undefined && !options.completeCaptureReceipts
          ? `snapshot-historical-completion-${fixtureNamespace}-${index}`
          : targetArtifactId.replace('artifact:', 'source-snapshot:'),
        targetArtifactId,
        request.dataset,
        request.datasetVersion,
        request.capabilityId,
        request.anchorSeasonYear,
        capturedAt,
        canonicalizeAflTradeJson({
          sourceUrl: request.sourceUrl,
          executionReceipt: options.completeCaptureReceipts
            ? await completeSyntheticCaptureReceipt(sql, {
                environment,
                provider: 'draftguru',
                year: seasonYear,
                sourceUrl: request.sourceUrl,
                capabilityId: request.capabilityId,
                dataset: request.dataset,
                datasetVersion: request.datasetVersion,
                parserVersion: request.parserVersion,
                fieldManifestSha256: request.fieldManifestSha256,
                capturedAt,
                artifact: targetArtifact,
              })
            : (options.fixtureCaptureExecutionReceipt ?? {
                content: syntheticAdmission,
              }),
        }),
      ]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_external_evidence_batch
      (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
       status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',$6,0,$3,$4,'open',NULL,$5::jsonb)`,
      [
        batch.batchId,
        targetCaptureId,
        batch.content.rowSetSha256,
        sha256AflTradeCanonicalJson([]),
        canonicalizeAflTradeJson(batch),
        targetEvidence.length,
      ]
    );
    for (const targetRow of targetEvidence) {
      await outcomesPool.query(
        `INSERT INTO outcome_external_evidence_row
      (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
     VALUES ($1,$2,$6,$3,$4,$5::jsonb)`,
        [
          targetRow.evidenceId,
          batch.batchId,
          targetRow.content.sourceRow.sourceKey,
          targetRow.content.claim.kind,
          canonicalizeAflTradeJson(targetRow),
          targetRow.content.sourceRow.ordinal,
        ]
      );
    }
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
      environment,
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
       VALUES ($1,$2,$3,'application/json',$4,'derived_private','${environment}',$5,$5,'{}'::jsonb)`,
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
       VALUES ($1,$2,'reviewer_authority_evidence',$3,'${environment}','approved',$4,$5,$6::TEXT,$6::jsonb)`,
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
      if (environment === 'non_production') {
        const activeSchema = await connection.query<{ schema_name: string }>(
          'SELECT current_schema() AS schema_name'
        );
        await connection.query('SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer');
        await connection.query("SELECT set_config('search_path',$1,TRUE)", [
          activeSchema.rows[0]!.schema_name,
        ]);
      }
      await connection.query('COMMIT');
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined);
      connection.release();
    }
    return referenceId;
  }

  async function seedPromotionAuthority(
    candidateId: string,
    proposal: ReturnType<typeof createAflTradeExternalCanonicalPromotionProposal>
  ): Promise<string> {
    const principalRef = 'operator:external-canonical-promotion';
    const authorityPayload = {
      evidenceKind: 'reviewer_authority_evidence',
      environment,
      principalRef,
      role: 'afl_trade_canonical_promoter',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: 'multi_source',
      capabilityId: 'external_candidate_promotion',
      competition: 'AFLM',
      validFromSeason: seasonYear,
      validThroughSeason: options.promoterThroughSeason ?? seasonYear,
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
     VALUES ($4,$1,$2,'application/json',$3,'derived_private',
             '${environment}','${reviewedAt}','${reviewedAt}','{}'::jsonb)`,
      [
        authoritySha,
        `artifact://sha256/${authoritySha}`,
        Buffer.byteLength(authorityCanonical),
        `artifact-promotion-authority-${fixtureNamespace}`,
      ]
    );
    const authorityClient = await outcomesPool.connect();
    try {
      await authorityClient.query('BEGIN');
      await authorityClient.query(
        `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'governed_evidence_reference',$2,'approved','Fixture authority approval',
               jsonb_build_object('referenceSha256',$3::text),'fixture-governance-reviewer',
               '${reviewedAt}')`,
        [authorityApprovalId, authorityId, authoritySha]
      );
      await authorityClient.query(
        `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,'reviewer_authority_evidence',$6,'${environment}',
               'approved',$3,'${reviewedAt}',$4,$5::jsonb)`,
        [
          authorityId,
          authoritySha,
          authorityApprovalId,
          authorityCanonical,
          authorityCanonical,
          `artifact-promotion-authority-${fixtureNamespace}`,
        ]
      );
      if (environment === 'non_production') {
        const activeSchema = await authorityClient.query<{ schema_name: string }>(
          'SELECT current_schema() AS schema_name'
        );
        await authorityClient.query(
          'SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer'
        );
        await authorityClient.query("SELECT set_config('search_path',$1,TRUE)", [
          activeSchema.rows[0]!.schema_name,
        ]);
      }
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
             'external_candidate_promotion','AFLM',$3,$4,
             '2026-01-01T00:00:00.000Z',NULL)`,
      [authorityId, principalRef, seasonYear, options.promoterThroughSeason ?? seasonYear]
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
      decidedAt: reviewedAt,
    });
    await repository.persistDecision({ candidate, proposal, decision });
    return decision.decisionId;
  }

  const sql = createPgAflOutcomeSqlClient(outcomesPool);
  const repository = new PostgresAflTradeExternalDiscoveryRepository(sql);
  const indexBatch = await seedIndexBatch();
  const inventory = await repository.loadInventoryFromBatch({
    batchId: indexBatch.batchId,
    fromYear: seasonYear,
    throughYear: seasonYear,
  });
  await repository.persistInventory(inventory);
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

  await repository.persistPlan(plan);
  const schedules = new PostgresAflTradeExternalCaptureScheduleRepository(sql);
  let playerBatch: Awaited<ReturnType<typeof seedTargetBatch>> | undefined;
  let draftBatch: Awaited<ReturnType<typeof seedTargetBatch>> | undefined;
  for (const [index, target] of plan.content.targets.entries()) {
    const seeded = await seedTargetBatch(target, index);
    if (
      target.content.schedule.definition.requestTemplate.capabilityId === 'draftguru-trade-detail'
    )
      playerBatch = seeded;
    else draftBatch = seeded;
    const claimResult = await schedules.claim({
      scheduleId: target.content.schedule.scheduleId,
      dueAt: target.content.schedule.definition.cadence.anchorAt,
      observedAt: await databaseNow(),
      workerId: 'synthetic-acquisition',
      leaseTokenSha256: digest(`acquisition-lease-${index}`),
    });
    if (!claimResult.proposedClaim) throw new Error('Synthetic target is not claimable.');
    await schedules.complete({
      claim: claimResult.proposedClaim,
      completedAt: await databaseNow(),
      outcome: { status: 'completed', resultId: seeded.batch.batchId },
    });
  }
  if (!playerBatch) throw new Error('Missing synthetic player transfer batch.');
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completePlan(plan.planId);
  const loaded = await new PostgresAflTradeExternalHistoricalReconciliationSource(sql).load(
    completion.completionId
  );
  const reviewPackage = buildAflTradeExternalIdentityReviewPackage(loaded);
  const workItem = reviewPackage.content.items.find(
    ({ workItem }) =>
      workItem.content.subject.content.entityKind === 'player' &&
      workItem.content.subject.content.identityScope.kind === 'provider_native_id' &&
      workItem.content.subject.content.identityScope.nativeId === nativePlayerId
  )?.workItem;
  if (!workItem) throw new Error('Missing exact synthetic player identity work item.');
  const playerId = targets.playerId;
  if (!options.existingTargets) {
    await outcomesPool.query(
      `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')`,
      [playerId, targets.playerName]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_club(club_id,current_name,status) VALUES ($1,$2,'approved'),($3,$4,'approved')`,
      [targets.fromClubId, targets.fromClubName, targets.toClubId, targets.toClubName]
    );
    if (reviewedOfficialCombinedDraft) {
      await outcomesPool.query(
        `INSERT INTO outcome_club(club_id,current_name,status)
         VALUES ($1,$2,'approved')`,
        [officialTerminalClubId, seasonYear === 2016 ? 'West Coast' : 'Carlton']
      );
    }
  } else {
    const player = await outcomesPool.query(
      `SELECT display_name,status FROM outcome_player WHERE player_id=$1`,
      [playerId]
    );
    const clubs = await outcomesPool.query(
      `SELECT club_id,current_name,status FROM outcome_club WHERE club_id=ANY($1::text[])`,
      [[targets.fromClubId, targets.toClubId]]
    );
    if (
      player.rows.length !== 1 ||
      player.rows[0].display_name !== targets.playerName ||
      player.rows[0].status !== 'approved' ||
      clubs.rows.length !== 2 ||
      !clubs.rows.every(
        (row) =>
          row.status === 'approved' &&
          row.current_name ===
            (row.club_id === targets.fromClubId ? targets.fromClubName : targets.toClubName)
      )
    ) {
      throw new Error(
        'Existing synthetic acquisition targets differ from exact approved canonical records.'
      );
    }
  }
  const principalRef = 'operator:synthetic-acquisition-identity';
  const authorityEvidenceId = await seedExternalIdentityReviewerAuthority({
    principalRef,
    provider: 'draftguru',
    validFromSeason: seasonYear,
    validThroughSeason: Math.max(seasonYear, candidateAnchorSeasonYear),
  });
  const clock = await outcomesPool.query<{ at: Date }>('SELECT clock_timestamp() AS at');
  reviewedAt = clock.rows[0]!.at.toISOString();
  const identityDecision = createAflTradeExternalIdentityReviewDecision({
    subject: workItem.content.subject,
    reviewPackageId: reviewPackage.packageId,
    reviewPackageSha256: reviewPackage.packageId.split(':')[1]!,
    workItemId: workItem.workItemId,
    workItemSha256: workItem.workItemId.split(':')[1]!,
    workItem,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
      entityKind: 'player',
      canonicalId: playerId,
      recordedLabel: targets.playerName,
    }),
    rationale: 'Synthetic acquisition identity review',
    authorityEvidenceId,
    decidedBy: principalRef,
    decidedAt: reviewedAt,
  });
  const identities = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  await identities.persistDecision({ reviewPackage, decision: identityDecision });
  const resolution = (await identities.loadCurrentResolutions(reviewPackage)).find(
    (value) => value.content.canonicalId === playerId
  );
  if (!resolution) throw new Error('Synthetic identity did not become current.');
  const identityDecisionId = identityDecision.decisionId;
  const batchId = playerBatch.batch.batchId;
  const evidenceId = playerBatch.batch.content.evidence[0]!.evidenceId;
  const allResolutions = [resolution];
  if (options.reciprocalPlayer) {
    const item = reviewPackage.content.items.find(
      ({ workItem }) =>
        workItem.content.subject.content.entityKind === 'player' &&
        workItem.content.subject.content.identityScope.kind === 'provider_native_id' &&
        workItem.content.subject.content.identityScope.nativeId === 'synthetic-reciprocal-player'
    )?.workItem;
    if (!item) throw new Error('Missing reciprocal player identity work item.');
    await outcomesPool.query(
      "INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')",
      ['synthetic-reciprocal-player', 'Synthetic Reciprocal Player']
    );
    const decision = createAflTradeExternalIdentityReviewDecision({
      ...identityDecision.content,
      ...(await nextIdentityRevision(item.content.subject.subjectId)),
      subject: item.content.subject,
      workItemId: item.workItemId,
      workItemSha256: item.workItemId.split(':')[1]!,
      workItem: item,
      canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
        entityKind: 'player',
        canonicalId: 'synthetic-reciprocal-player',
        recordedLabel: 'Synthetic Reciprocal Player',
      }),
      decidedAt: await databaseNow(),
    });
    await identities.persistDecision({ reviewPackage, decision });
    const reciprocalResolution = (await identities.loadCurrentResolutions(reviewPackage)).find(
      (value) =>
        value.content.reviewDecisionId === decision.decisionId &&
        value.content.canonicalId === 'synthetic-reciprocal-player'
    );
    if (!reciprocalResolution)
      throw new Error('Reciprocal player identity did not become current.');
    allResolutions.push(reciprocalResolution);
  }

  if (reviewedOfficialCombinedDraft) {
    for (const [recordedName, canonicalId] of [
      [targets.fromClubName, targets.fromClubId],
      [targets.toClubName, targets.toClubId],
    ] as const) {
      const clubItem = reviewPackage.content.items.find(
        ({ workItem }) =>
          workItem.content.subject.content.entityKind === 'club' &&
          workItem.content.subject.content.identityScope.kind === 'exact_recorded_name' &&
          workItem.content.subject.content.identityScope.recordedName === recordedName
      )?.workItem;
      if (!clubItem) throw new Error(`Missing ${recordedName} transaction-party identity item.`);
      const clubDecision = createAflTradeExternalIdentityReviewDecision({
        ...identityDecision.content,
        subject: clubItem.content.subject,
        workItemId: clubItem.workItemId,
        workItemSha256: clubItem.workItemId.split(':')[1]!,
        workItem: clubItem,
        canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
          entityKind: 'club',
          canonicalId,
          recordedLabel: recordedName,
        }),
        decidedAt: await databaseNow(),
      });
      await identities.persistDecision({ reviewPackage, decision: clubDecision });
      const clubResolution = (await identities.loadCurrentResolutions(reviewPackage)).find(
        (value) =>
          value.content.canonicalId === canonicalId &&
          value.content.reviewDecisionId === clubDecision.decisionId
      );
      if (!clubResolution) throw new Error(`${recordedName} identity did not become current.`);
      allResolutions.push(clubResolution);
    }
  }
  const draftSelections: Array<{
    selectionId: string;
    draftYear: number;
    draftType: string;
    selectionNumber: number;
    roundNumber: number | null;
    pickId: string;
    playerId: string;
    clubId: string;
    status: 'single_source';
    supportingProviders: ['draftguru'];
    evidenceIds: string[];
  }> = [];
  const draftEventCoverage: Array<{
    draftYear: number;
    draftType: string;
    sessionOrdinal: number;
    eventDate: string;
    officialName: string;
    expectedSelectionCount: number;
    selectionIds: string[];
    evidenceIds: string[];
    status: 'complete';
    proofKind?: 'combined_session_facts';
  }> = [];
  const sourceBatchIds = [batchId];
  const combinedFactBatches: ReturnType<typeof createAflTradeExternalEvidenceBatch>[] = [];
  if (hasDraftSessions) {
    if (!draftBatch) throw new Error('Missing synthetic draft batch.');
    sourceBatchIds.push(draftBatch.batch.batchId);
    for (const [index, row] of draftBatch.batch.content.evidence.entries()) {
      if (row.content.claim.kind !== 'draft_selection')
        throw new Error('Expected draft selection.');
      const claim = row.content.claim;
      const draftTarget = options.existingDraftTargets?.[claim.selectionNumber - 1];
      const draftPlayerId = draftTarget?.playerId ?? `${fixtureNamespace}-draft-player-${index}`;
      const item = reviewPackage.content.items.find(
        ({ workItem }) =>
          workItem.content.subject.content.entityKind === 'player' &&
          workItem.content.subject.content.identityScope.kind === 'provider_native_id' &&
          workItem.content.subject.content.identityScope.nativeId === claim.player.nativeId
      )?.workItem;
      if (!item) throw new Error('Missing draft identity work item.');
      if (draftTarget) {
        const retained = await outcomesPool.query(
          `SELECT player.display_name,club.current_name FROM outcome_player player CROSS JOIN outcome_club club
           WHERE player.player_id=$1 AND club.club_id=$2 AND player.status='approved' AND club.status='approved'`,
          [draftPlayerId, draftTarget.clubId]
        );
        if (
          retained.rows.length !== 1 ||
          retained.rows[0].display_name !== claim.player.recordedName ||
          retained.rows[0].current_name !== claim.selectedByClub.recordedName
        )
          throw new Error('Existing draft targets differ from exact approved canonical records.');
      } else {
        await outcomesPool.query(
          `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')`,
          [draftPlayerId, claim.player.recordedName]
        );
      }
      const revision = await nextIdentityRevision(item.content.subject.subjectId);
      const decision = createAflTradeExternalIdentityReviewDecision({
        ...identityDecision.content,
        ...revision,
        subject: item.content.subject,
        workItemId: item.workItemId,
        workItemSha256: item.workItemId.split(':')[1]!,
        workItem: item,
        canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
          entityKind: 'player',
          canonicalId: draftPlayerId,
          recordedLabel: claim.player.recordedName,
        }),
        decidedAt: await databaseNow(),
      });
      await identities.persistDecision({ reviewPackage, decision });
      const draftResolution = (await identities.loadCurrentResolutions(reviewPackage)).find(
        (value) =>
          value.content.canonicalId === draftPlayerId &&
          value.content.reviewDecisionId === decision.decisionId &&
          value.content.sourceIdentity.nativeId === claim.player.nativeId
      );
      if (!draftResolution) throw new Error('Draft identity did not become current.');
      allResolutions.push(draftResolution);
      const draftClubId =
        reviewedOfficialCombinedDraft && claim.selectionNumber === officialSelectionCount
          ? officialTerminalClubId!
          : (draftTarget?.clubId ?? targets.toClubId);
      if (options.combinedDraftSessions) {
        const clubItem = reviewPackage.content.items.find(
          ({ workItem }) =>
            workItem.content.subject.content.entityKind === 'club' &&
            workItem.content.subject.content.identityScope.kind === 'provider_native_id' &&
            workItem.content.subject.content.identityScope.nativeId ===
              claim.selectedByClub.nativeId
        )?.workItem;
        if (!clubItem) throw new Error('Missing combined-proof club identity work item.');
        const revision = await nextIdentityRevision(clubItem.content.subject.subjectId);
        const clubDecision = createAflTradeExternalIdentityReviewDecision({
          ...identityDecision.content,
          ...revision,
          subject: clubItem.content.subject,
          workItemId: clubItem.workItemId,
          workItemSha256: clubItem.workItemId.split(':')[1]!,
          workItem: clubItem,
          canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
            entityKind: 'club',
            canonicalId: draftClubId,
            recordedLabel: claim.selectedByClub.recordedName,
          }),
          decidedAt: await databaseNow(),
        });
        await identities.persistDecision({ reviewPackage, decision: clubDecision });
        const clubResolution = (await identities.loadCurrentResolutions(reviewPackage)).find(
          (value) =>
            value.content.canonicalId === draftClubId &&
            value.content.reviewDecisionId === clubDecision.decisionId &&
            value.content.sourceIdentity.nativeId === claim.selectedByClub.nativeId
        );
        if (!clubResolution) throw new Error('Draft club identity did not become current.');
        allResolutions.push(clubResolution);
        if (
          !reviewedOfficialCombinedDraft ||
          claim.selectionNumber === 1 ||
          claim.selectionNumber === officialSelectionCount
        ) {
          allResolutions.push(
            createAflTradeExternalIdentityResolution({
              ...clubResolution.content,
              provider: 'official_afl',
              sourceIdentity: reviewedOfficialCombinedDraft
                ? { nativeId: null, recordedName: claim.selectedByClub.recordedName }
                : clubResolution.content.sourceIdentity,
            })
          );
        }
      }
      if (
        options.combinedDraftSessions &&
        (!reviewedOfficialCombinedDraft ||
          claim.selectionNumber === 1 ||
          claim.selectionNumber === officialSelectionCount)
      ) {
        allResolutions.push(
          createAflTradeExternalIdentityResolution({
            ...draftResolution.content,
            provider: 'official_afl',
            sourceIdentity: reviewedOfficialCombinedDraft
              ? { nativeId: null, recordedName: claim.player.recordedName }
              : draftResolution.content.sourceIdentity,
          })
        );
      }
      const selectionId = createAflTradeContentAddress('external-draft-selection', {
        draftYear: seasonYear,
        draftType: claim.draftType,
        selectionNumber: claim.selectionNumber,
      });
      if (options.combinedDraftSessions && claim.draftType === 'national') {
        draftSelections.push({
          selectionId,
          draftYear: seasonYear,
          draftType: claim.draftType,
          selectionNumber: claim.selectionNumber,
          roundNumber: claim.roundNumber,
          pickId: createAflTradeContentAddress('draft-pick', { selectionId }),
          playerId: draftPlayerId,
          clubId: draftClubId,
          status: 'single_source',
          supportingProviders: ['draftguru'],
          evidenceIds: [row.evidenceId],
        });
        continue;
      }
      const date = index === 0 ? `${seasonYear}-11-20` : `${seasonYear}-11-21`;
      const dateBytes = new TextEncoder().encode(
        `Synthetic session ${index + 1} on ${date}, selection ${claim.selectionNumber}.`
      );
      const dateArtifact = createAflTradeByteArtifactRef(dateBytes, 'text/html', capturedAt);
      retainedArtifacts.set(dateArtifact.artifactId, { reference: dateArtifact, bytes: dateBytes });
      const dateCaptureId = createAflTradeContentAddress('source-capture', { session: index });
      const dateRow = createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: {
          ...row.content.capture,
          captureId: dateCaptureId,
          artifactId: dateArtifact.artifactId,
          contentSha256: dateArtifact.contentSha256,
          sourceUrl: `https://www.afl.com.au/news/123/synthetic-session-${index + 1}`,
        },
        sourceRow: { ordinal: 1, sourceKey: `synthetic-session-${index + 1}` },
        claim: {
          kind: 'draft_session',
          draftYear: seasonYear,
          draftType: claim.draftType,
          sessionOrdinal: claim.draftType === 'rookie' ? 1 : index + 1,
          eventDate: date,
          officialName: `Synthetic session ${index + 1}`,
          selectionNumbers: [claim.selectionNumber],
        },
        publicationEligible: false,
      });
      const dateBatch = createAflTradeExternalEvidenceBatch({
        schemaVersion: 'afl-trade-external-evidence-batch/v1',
        provider: 'official_afl',
        captureId: dateCaptureId,
        evidence: [dateRow],
        finalizedAt: capturedAt,
        publicationEligible: false,
      });
      await outcomesPool.query(
        `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
        VALUES($1,$2,$3,'text/html',$4,'raw_source','${environment}',$5,$5,'{}')`,
        [
          dateArtifact.artifactId,
          dateArtifact.contentSha256,
          dateArtifact.storageUri,
          dateArtifact.byteLength,
          capturedAt,
        ]
      );
      await outcomesPool.query(
        `INSERT INTO outcome_source_capture_attempt
        (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
        VALUES($1,'${environment}','official_afl','draft-session','synthetic-session','captured',$2,$2,'{}')`,
        [`session-attempt-${index}`, capturedAt]
      );
      await outcomesPool.query(
        `INSERT INTO outcome_source_capture
        (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
         access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
        VALUES($1,$2,$3,$4,'${environment}','official_afl','draft-session','synthetic-v1','automated_web',
          'synthetic-session','AFLM',$7,$5,$5,'approved',$6::jsonb)`,
        [
          dateCaptureId,
          `session-attempt-${index}`,
          options.fixtureCaptureExecutionReceipt === undefined && !options.completeCaptureReceipts
            ? `session-snapshot-${index}`
            : dateArtifact.artifactId.replace('artifact:', 'source-snapshot:'),
          dateArtifact.artifactId,
          capturedAt,
          canonicalizeAflTradeJson({
            sourceUrl: dateRow.content.capture.sourceUrl,
            executionReceipt: options.completeCaptureReceipts
              ? await completeSyntheticCaptureReceipt(sql, {
                  environment,
                  provider: 'official_afl',
                  year: seasonYear,
                  sourceUrl: dateRow.content.capture.sourceUrl,
                  capabilityId: 'synthetic-session',
                  dataset: 'draft-session',
                  datasetVersion: 'synthetic-v1',
                  parserVersion: dateRow.content.capture.parserVersion,
                  fieldManifestSha256: dateRow.content.capture.fieldManifestSha256,
                  capturedAt,
                  artifact: dateArtifact,
                })
              : (options.fixtureCaptureExecutionReceipt ?? {
                  content: syntheticAdmission,
                }),
          }),
          seasonYear,
        ]
      );
      await outcomesPool.query(
        `INSERT INTO outcome_external_evidence_batch
        (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
        VALUES($1,$2,'official_afl',1,0,$3,$4,'open',NULL,$5::jsonb)`,
        [
          dateBatch.batchId,
          dateCaptureId,
          dateBatch.content.rowSetSha256,
          sha256AflTradeCanonicalJson([]),
          canonicalizeAflTradeJson(dateBatch),
        ]
      );
      await outcomesPool.query(
        `INSERT INTO outcome_external_evidence_row
        (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json) VALUES($1,$2,1,$3,'draft_session',$4::jsonb)`,
        [
          dateRow.evidenceId,
          dateBatch.batchId,
          dateRow.content.sourceRow.sourceKey,
          canonicalizeAflTradeJson(dateRow),
        ]
      );
      await outcomesPool.query(
        `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at=$2 WHERE batch_id=$1`,
        [dateBatch.batchId, capturedAt]
      );
      sourceBatchIds.push(dateBatch.batchId);
      draftSelections.push({
        selectionId,
        draftYear: seasonYear,
        draftType: claim.draftType,
        selectionNumber: claim.selectionNumber,
        roundNumber: claim.roundNumber,
        pickId: createAflTradeContentAddress('draft-pick', { selectionId }),
        playerId: draftPlayerId,
        clubId: draftClubId,
        status: 'single_source',
        supportingProviders: ['draftguru'],
        evidenceIds: [row.evidenceId, dateRow.evidenceId].sort(),
      });
      draftEventCoverage.push({
        draftYear: seasonYear,
        draftType: claim.draftType,
        sessionOrdinal: claim.draftType === 'rookie' ? 1 : index + 1,
        eventDate: date,
        officialName: `Synthetic session ${index + 1}`,
        expectedSelectionCount: 1,
        selectionIds: [selectionId],
        evidenceIds: [dateRow.evidenceId],
        status: 'complete',
      });
    }
    if (options.combinedDraftSessions) {
      const selectionRows = draftBatch.batch.content.evidence
        .map((row) => {
          if (row.content.claim.kind !== 'draft_selection') {
            throw new Error('Expected combined-proof draft selection.');
          }
          return row.content.claim;
        })
        .filter((claim) => claim.draftType === 'national');
      const first = selectionRows[0]!;
      const last = selectionRows.at(-1)!;
      const combinedFactGroups = reviewedOfficialCombinedDraft
        ? seasonYear === 2016
          ? [
              {
                sourceUrl:
                  'https://www.afl.com.au/news/157359/all-the-picks-from-the-2016-nab-afl-draft',
                claims: [
                  {
                    kind: 'draft_session_date' as const,
                    draftYear: 2016,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    eventDate: '2016-11-25',
                  },
                  {
                    kind: 'draft_session_completion' as const,
                    draftYear: 2016,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                  },
                  {
                    kind: 'draft_session_boundary' as const,
                    draftYear: 2016,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    boundary: 'first' as const,
                    selectionNumber: 1,
                    player: { nativeId: null, recordedName: first.player.recordedName },
                    selectedByClub: {
                      nativeId: null,
                      recordedName: first.selectedByClub.recordedName,
                    },
                  },
                  {
                    kind: 'draft_session_boundary' as const,
                    draftYear: 2016,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    boundary: 'last' as const,
                    selectionNumber: 77,
                    player: { nativeId: null, recordedName: last.player.recordedName },
                    selectedByClub: {
                      nativeId: null,
                      recordedName: last.selectedByClub.recordedName,
                    },
                  },
                ],
              },
              {
                sourceUrl:
                  'https://www.afl.com.au/news/149290/revisiting-the-drafts-2016-national-draft',
                effectiveAt: '2019-11-28T11:30:00.000Z',
                claims: [
                  {
                    kind: 'draft_completed_total' as const,
                    draftYear: 2016,
                    draftType: 'national' as const,
                    selectionCount: 77,
                  },
                ],
              },
              {
                sourceUrl:
                  'https://www.afl.com.au/news/49872/indicative-draft-order-your-clubs-picks',
                claims: [
                  {
                    kind: 'draft_session_date' as const,
                    draftYear: 2016,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    eventDate: '2016-11-25',
                  },
                ],
              },
            ]
          : [
              {
                sourceUrl:
                  'https://www.afl.com.au/news/142762/draft-wrap-lions-reveal-top-pick-freos-big-call',
                claims: [
                  {
                    kind: 'draft_session_date' as const,
                    draftYear: 2017,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    eventDate: '2017-11-24',
                  },
                  {
                    kind: 'draft_session_completion' as const,
                    draftYear: 2017,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                  },
                  {
                    kind: 'draft_session_boundary' as const,
                    draftYear: 2017,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    boundary: 'first' as const,
                    selectionNumber: 1,
                    player: { nativeId: null, recordedName: first.player.recordedName },
                    selectedByClub: {
                      nativeId: null,
                      recordedName: first.selectedByClub.recordedName,
                    },
                  },
                  {
                    kind: 'draft_session_boundary' as const,
                    draftYear: 2017,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    boundary: 'last' as const,
                    selectionNumber: 78,
                    player: { nativeId: null, recordedName: last.player.recordedName },
                    selectedByClub: {
                      nativeId: null,
                      recordedName: last.selectedByClub.recordedName,
                    },
                  },
                ],
              },
              {
                sourceUrl: 'https://www.afl.com.au/news/83698/broadcast-guide-premiership',
                claims: [
                  {
                    kind: 'draft_completed_total' as const,
                    draftYear: 2017,
                    draftType: 'national' as const,
                    selectionCount: 78,
                  },
                ],
              },
              {
                sourceUrl:
                  'https://www.afl.com.au/news/46107/final-draft-order-check-out-all-of-your-clubs-picks',
                claims: [
                  {
                    kind: 'draft_session_date' as const,
                    draftYear: 2017,
                    draftType: 'national' as const,
                    sessionOrdinal: 1,
                    eventDate: '2017-11-24',
                  },
                ],
              },
            ]
        : [
            {
              sourceUrl: 'https://www.afl.com.au/news/900001/combined-session-one',
              claims: [
                {
                  kind: 'draft_session_date' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 1,
                  eventDate: '2024-11-20',
                },
                {
                  kind: 'draft_session_completion' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 1,
                },
                {
                  kind: 'draft_session_boundary' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 1,
                  boundary: 'first' as const,
                  selectionNumber: 1,
                  player: first.player,
                  selectedByClub: first.selectedByClub,
                },
              ],
            },
            {
              sourceUrl: 'https://www.afl.com.au/news/900002/combined-session-two',
              claims: [
                {
                  kind: 'draft_session_date' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 2,
                  eventDate: '2024-11-21',
                },
                {
                  kind: 'draft_session_completion' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 2,
                },
                {
                  kind: 'draft_session_boundary' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 2,
                  boundary: 'first' as const,
                  selectionNumber: 2,
                  player: last.player,
                  selectedByClub: last.selectedByClub,
                },
                {
                  kind: 'draft_session_boundary' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  sessionOrdinal: 2,
                  boundary: 'last' as const,
                  selectionNumber: 2,
                  player: last.player,
                  selectedByClub: last.selectedByClub,
                },
              ],
            },
            {
              sourceUrl: 'https://www.afl.com.au/news/900003/combined-total',
              claims: [
                {
                  kind: 'draft_completed_total' as const,
                  draftYear: 2024,
                  draftType: 'national' as const,
                  selectionCount: 2,
                },
              ],
            },
          ];
      const combinedEvidenceIds: string[] = [];
      for (const [groupIndex, group] of combinedFactGroups.entries()) {
        const bytes = new TextEncoder().encode(
          `${fixtureNamespace} combined proof ${groupIndex + 1}.`
        );
        const artifact = createAflTradeByteArtifactRef(bytes, 'text/html', capturedAt);
        retainedArtifacts.set(artifact.artifactId, { reference: artifact, bytes });
        const factCaptureId = createAflTradeContentAddress('source-capture', {
          fixtureNamespace,
          combinedDraftSession: groupIndex + 1,
        });
        const factCapture = {
          captureId: factCaptureId,
          artifactId: artifact.artifactId,
          contentSha256: artifact.contentSha256,
          mediaType: 'text/html' as const,
          sourceUrl: group.sourceUrl,
          capturedAt,
          effectiveAt:
            'effectiveAt' in group && typeof group.effectiveAt === 'string'
              ? group.effectiveAt
              : capturedAt,
          parserVersion: 'synthetic-combined-session/v1',
          fieldManifestSha256: sha('c'),
        };
        const rows = group.claims.map((claim, index) =>
          createAflTradeExternalEvidenceEnvelope({
            schemaVersion: 'afl-trade-external-evidence/v1',
            provider: 'official_afl',
            capture: factCapture,
            sourceRow: {
              ordinal: index + 1,
              sourceKey: `synthetic-combined-${groupIndex + 1}-${index + 1}`,
            },
            claim,
            publicationEligible: false,
          })
        );
        const factBatch = createAflTradeExternalEvidenceBatch({
          schemaVersion: 'afl-trade-external-evidence-batch/v1',
          provider: 'official_afl',
          captureId: factCaptureId,
          evidence: rows,
          finalizedAt: capturedAt,
          publicationEligible: false,
        });
        combinedFactBatches.push(factBatch);
        await outcomesPool.query(
          `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
          VALUES($1,$2,$3,'text/html',$4,'raw_source','${environment}',$5,$5,'{}')`,
          [
            artifact.artifactId,
            artifact.contentSha256,
            artifact.storageUri,
            artifact.byteLength,
            capturedAt,
          ]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_source_capture_attempt
          (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
          VALUES($1,'${environment}','official_afl','draft-session','synthetic-combined-session','captured',$2,$2,'{}')`,
          [`combined-session-attempt-${fixtureNamespace}-${groupIndex}`, capturedAt]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
           access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
          VALUES($1,$2,$3,$4,'${environment}','official_afl','draft-session','synthetic-v1','automated_web',
            'synthetic-combined-session','AFLM',$7,$8,$5,'approved',$6::jsonb)`,
          [
            factCaptureId,
            `combined-session-attempt-${fixtureNamespace}-${groupIndex}`,
            options.fixtureCaptureExecutionReceipt === undefined && !options.completeCaptureReceipts
              ? `combined-session-snapshot-${fixtureNamespace}-${groupIndex}`
              : artifact.artifactId.replace('artifact:', 'source-snapshot:'),
            artifact.artifactId,
            capturedAt,
            canonicalizeAflTradeJson({
              sourceUrl: group.sourceUrl,
              executionReceipt: options.completeCaptureReceipts
                ? await completeSyntheticCaptureReceipt(sql, {
                    environment,
                    provider: 'official_afl',
                    year: seasonYear,
                    sourceUrl: group.sourceUrl,
                    capabilityId: 'synthetic-combined-session',
                    dataset: 'draft-session',
                    datasetVersion: 'synthetic-v1',
                    parserVersion: factCapture.parserVersion,
                    fieldManifestSha256: factCapture.fieldManifestSha256,
                    capturedAt,
                    effectiveAt: factCapture.effectiveAt,
                    artifact,
                  })
                : (options.fixtureCaptureExecutionReceipt ?? {
                    content: syntheticAdmission,
                  }),
            }),
            seasonYear,
            factCapture.effectiveAt,
          ]
        );
        await outcomesPool.query(
          `INSERT INTO outcome_external_evidence_batch
          (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
          VALUES($1,$2,'official_afl',$3,0,$4,$5,'open',NULL,$6::jsonb)`,
          [
            factBatch.batchId,
            factCaptureId,
            rows.length,
            factBatch.content.rowSetSha256,
            sha256AflTradeCanonicalJson([]),
            canonicalizeAflTradeJson(factBatch),
          ]
        );
        for (const row of rows) {
          await outcomesPool.query(
            `INSERT INTO outcome_external_evidence_row
            (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
            VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
            [
              row.evidenceId,
              factBatch.batchId,
              row.content.sourceRow.ordinal,
              row.content.sourceRow.sourceKey,
              row.content.claim.kind,
              canonicalizeAflTradeJson(row),
            ]
          );
          combinedEvidenceIds.push(row.evidenceId);
        }
        await outcomesPool.query(
          `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at=$2 WHERE batch_id=$1`,
          [factBatch.batchId, capturedAt]
        );
        sourceBatchIds.push(factBatch.batchId);
      }
      combinedEvidenceIds.sort();
      for (const selection of draftSelections.filter(
        (selection) => selection.draftType === 'national'
      )) {
        selection.evidenceIds = [...selection.evidenceIds, ...combinedEvidenceIds].sort();
      }
      if (reviewedOfficialCombinedDraft) {
        draftEventCoverage.push({
          draftYear: seasonYear,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: seasonYear === 2016 ? '2016-11-25' : '2017-11-24',
          officialName: `${seasonYear} AFL Draft`,
          expectedSelectionCount: officialSelectionCount!,
          selectionIds: draftSelections.map(({ selectionId }) => selectionId).sort(),
          evidenceIds: combinedEvidenceIds,
          status: 'complete',
          proofKind: 'combined_session_facts',
        });
      } else {
        draftEventCoverage.push(
          ...draftSelections
            .filter((selection) => selection.draftType === 'national')
            .map((selection, index) => ({
              draftYear: seasonYear,
              draftType: 'national',
              sessionOrdinal: index + 1,
              eventDate: `${seasonYear}-11-${20 + index}`,
              officialName: `Synthetic combined session ${index + 1}`,
              expectedSelectionCount: 1,
              selectionIds: [selection.selectionId],
              evidenceIds: combinedEvidenceIds,
              status: 'complete' as const,
              proofKind: 'combined_session_facts' as const,
            }))
        );
      }
    }
    reviewedAt = await databaseNow();
  }
  if (options.reciprocalPlayer || options.reciprocalFuturePickYearOffset !== undefined)
    reviewedAt = await databaseNow();
  const syntheticCandidateContent = {
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment,
    competition: 'AFLM' as const,
    anchorSeasonYear: candidateAnchorSeasonYear,
    sourceBatchIds: sourceBatchIds.sort(),
    identityResolutionIds: allResolutions.map((value) => value.resolutionId).sort(),
    transactions: [
      {
        transactionId,
        providerEventId,
        seasonYear,
        occurredOn: tradeDate,
        transactionType: 'trade' as const,
        title: 'Synthetic player entry',
        parties: [targets.fromClubId, targets.toClubId].sort(),
        transferIds: [
          transferId,
          ...(options.reciprocalPlayer
            ? [
                createAflTradeContentAddress('external-transfer', {
                  transactionId,
                  nativeTransferId: 'synthetic-reciprocal-player',
                }),
              ]
            : []),
          ...(options.reciprocalFuturePickYearOffset === undefined
            ? []
            : [reciprocalFuturePickTransferId]),
        ].sort(),
        status: 'single_source' as const,
        evidenceIds: playerBatch.batch.content.evidence
          .filter(
            (row) =>
              'nativeEventId' in row.content.claim &&
              row.content.claim.nativeEventId === providerEventId
          )
          .map((row) => row.evidenceId)
          .sort(),
      },
      ...playerBatch.batch.content.evidence.flatMap((row) => {
        const claim = row.content.claim;
        if (claim.kind !== 'transaction' || claim.nativeEventId === providerEventId) return [];
        const id = createAflTradeContentAddress('external-transaction', {
          provider: 'draftguru',
          nativeEventId: claim.nativeEventId,
        });
        return [
          {
            transactionId: id,
            providerEventId: claim.nativeEventId,
            seasonYear,
            occurredOn: claim.occurredOn,
            transactionType: 'trade' as const,
            title: claim.title,
            parties: [targets.fromClubId, targets.toClubId].sort(),
            transferIds: [
              createAflTradeContentAddress('external-transfer', {
                transactionId: id,
                nativeTransferId: nativePlayerId,
              }),
            ],
            status: 'single_source' as const,
            evidenceIds: playerBatch.batch.content.evidence
              .filter(
                (source) =>
                  'nativeEventId' in source.content.claim &&
                  source.content.claim.nativeEventId === claim.nativeEventId
              )
              .map((source) => source.evidenceId)
              .sort(),
          },
        ];
      }),
    ].sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
    transfers: [
      ...(options.reciprocalPlayer
        ? [
            {
              transferId: createAflTradeContentAddress('external-transfer', {
                transactionId,
                nativeTransferId: 'synthetic-reciprocal-player',
              }),
              transactionId,
              fromClubId: targets.toClubId,
              toClubId: targets.fromClubId,
              asset: {
                kind: 'player' as const,
                playerId: 'synthetic-reciprocal-player',
                recordedName: 'Synthetic Reciprocal Player',
              },
              status: 'single_source' as const,
              evidenceIds: playerBatch.batch.content.evidence
                .filter(
                  (row) =>
                    row.content.claim.kind === 'directed_transfer' &&
                    row.content.claim.nativeTransferId === 'synthetic-reciprocal-player'
                )
                .map((row) => row.evidenceId),
            },
          ]
        : []),
      ...(options.reciprocalFuturePickYearOffset === undefined
        ? []
        : [
            {
              transferId: reciprocalFuturePickTransferId,
              transactionId,
              fromClubId: targets.toClubId,
              toClubId: targets.fromClubId,
              asset: {
                kind: 'pick_entitlement' as const,
                pickId: reciprocalFuturePickId,
                draftYear: seasonYear + options.reciprocalFuturePickYearOffset,
                draftType: 'national' as const,
                nominalRound: 1,
                nominalPick: null,
                originalClubId: targets.toClubId,
                recordedLabel: null,
              },
              status: 'single_source' as const,
              evidenceIds: playerBatch.batch.content.evidence
                .filter(
                  (row) =>
                    row.content.claim.kind === 'directed_transfer' &&
                    row.content.claim.nativeTransferId === 'synthetic-reciprocal-future-pick'
                )
                .map((row) => row.evidenceId),
            },
          ]),

      {
        transferId,
        transactionId,
        fromClubId: targets.fromClubId,
        toClubId: targets.toClubId,
        asset: { kind: 'player' as const, playerId, recordedName: targets.playerName },
        status: 'single_source' as const,
        evidenceIds: [evidenceId],
      },
      ...playerBatch.batch.content.evidence.flatMap((row) => {
        const claim = row.content.claim;
        if (claim.kind !== 'directed_transfer' || claim.nativeEventId === providerEventId)
          return [];
        const id = createAflTradeContentAddress('external-transaction', {
          provider: 'draftguru',
          nativeEventId: claim.nativeEventId,
        });
        return [
          {
            transferId: createAflTradeContentAddress('external-transfer', {
              transactionId: id,
              nativeTransferId: nativePlayerId,
            }),
            transactionId: id,
            fromClubId:
              claim.fromClub.recordedName === targets.fromClubName
                ? targets.fromClubId
                : targets.toClubId,
            toClubId:
              claim.toClub.recordedName === targets.fromClubName
                ? targets.fromClubId
                : targets.toClubId,
            asset: { kind: 'player' as const, playerId, recordedName: targets.playerName },
            status: 'single_source' as const,
            evidenceIds: [row.evidenceId],
          },
        ];
      }),
    ].sort((a, b) => a.transferId.localeCompare(b.transferId)),
    draftSelections,
    pickCustody:
      options.reciprocalFuturePickYearOffset === undefined
        ? []
        : [
            {
              custodyId: reciprocalFuturePickCustodyId,
              pickId: reciprocalFuturePickId,
              observedAt: `${seasonYear}-10-15T00:00:00.000Z`,
              draftYear: seasonYear + options.reciprocalFuturePickYearOffset,
              draftType: 'national' as const,
              roundNumber: 1,
              recordedPickNumber: null,
              originalClubId: targets.toClubId,
              currentClubId: targets.fromClubId,
              status: 'single_source' as const,
              evidenceIds: playerBatch.batch.content.evidence
                .filter(
                  (row) =>
                    row.content.claim.kind === 'directed_transfer' &&
                    row.content.claim.nativeTransferId === 'synthetic-reciprocal-future-pick'
                )
                .map((row) => row.evidenceId),
            },
          ],
    pickLineage: [],
    issues: [],
    reconciledAt: reviewedAt,
    publicationEligible: false as const,
  };
  const candidate = reviewedOfficialCombinedDraft
    ? reconcileAflTradeExternalEvidence({
        environment,
        competition: 'AFLM',
        anchorSeasonYear: seasonYear,
        sourceBatches: [playerBatch.batch, draftBatch!.batch, ...combinedFactBatches],
        identityResolutions: allResolutions,
        reconciledAt: reviewedAt,
      })
    : createAflTradeExternalReconciliationCandidate(syntheticCandidateContent);
  if (reviewedOfficialCombinedDraft && candidate.content.issues.length !== 0) {
    throw new Error(
      `Official ${seasonYear} public reconciliation failed: ${candidate.content.issues
        .map(({ detail }) => detail)
        .join('; ')}`
    );
  }
  await new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
    candidate,
    identityResolutions: allResolutions,
  });
  draftEventCoverage.sort(
    (a, b) =>
      a.draftYear - b.draftYear ||
      a.draftType.localeCompare(b.draftType) ||
      a.sessionOrdinal - b.sessionOrdinal
  );
  const proposalInput = {
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateId.split(':')[1]!,
    environment,
    competition: 'AFLM',
    anchorSeasonYear: candidateAnchorSeasonYear,
    draftEventCoverage,
    transactionDateCoverage: candidate.content.transactions.map((transaction) => ({
      transactionId: transaction.transactionId,
      seasonYear,
      occurredOn: transaction.occurredOn!,
    })),
    proposedAt: reviewedAt,
    publicationEligible: false as const,
  };
  const proposal = options.sessionProposalV5
    ? createAflTradeExternalCanonicalPromotionProposal({
        ...proposalInput,
        schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v5',
        draftEventCoverage: draftEventCoverage.map((coverage) => ({
          ...coverage,
          proofKind:
            options.combinedDraftSessions && coverage.draftType === 'national'
              ? ('combined_session_facts' as const)
              : ('direct_session_claim' as const),
        })),
      })
    : options.combinedDraftSessions
      ? createAflTradeExternalCanonicalPromotionProposal({
          ...proposalInput,
          schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v3',
          draftEventCoverage: draftEventCoverage.map((coverage) => ({
            ...coverage,
            proofKind: 'combined_session_facts' as const,
          })),
        })
      : hasDraftSessions
        ? createAflTradeExternalCanonicalPromotionProposal({
            ...proposalInput,
            schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v2',
            draftEventCoverage,
          })
        : createAflTradeExternalCanonicalPromotionProposal({
            ...proposalInput,
            schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
            draftEventCoverage: [],
          });
  const approvalDecisionId = await seedPromotionAuthority(candidate.candidateId, proposal);
  const receipt = await new PostgresAflTradeExternalCanonicalPromotionRepository(sql).promote({
    candidateId: candidate.candidateId,
    approvalDecisionId,
  });
  const assets = await outcomesPool.query<{ asset_version_id: string; event_version_id: string }>(
    `SELECT asset.asset_version_id,asset.event_version_id FROM outcome_external_canonical_promotion_record member
 JOIN outcome_event_asset asset ON asset.asset_version_id=member.canonical_record_id
 WHERE member.promotion_id=$1 AND member.record_kind='transfer' AND asset.player_id=$2
   AND member.source_record_id=$3`,
    [receipt.promotionId, playerId, transferId]
  );
  if (assets.rows.length !== 1)
    throw new Error('Synthetic public promotion did not produce one player asset.');
  const replay = await new PostgresAflTradeExternalCanonicalPromotionRepository(sql).promote({
    candidateId: candidate.candidateId,
    approvalDecisionId,
  });
  if (
    !replay.idempotentReplay ||
    canonicalizeAflTradeJson({ ...replay, idempotentReplay: false }) !==
      canonicalizeAflTradeJson(receipt)
  )
    throw new Error('Promotion replay differs.');
  const draftAssets = await outcomesPool.query<{
    event_date: string;
    event_id: string;
    event_version_id: string;
    asset_version_id: string;
    player_id: string;
  }>(
    `SELECT event.event_date::TEXT,event.event_id,event.event_version_id,asset.asset_version_id,asset.player_id FROM outcome_external_canonical_promotion_record member
     JOIN outcome_event_asset asset ON asset.asset_version_id=member.canonical_record_id
     JOIN outcome_event_version event ON event.event_version_id=asset.event_version_id
     WHERE member.promotion_id=$1 AND member.record_kind='draft_player_asset' ORDER BY event.event_date`,
    [receipt.promotionId]
  );
  const draftEntries = [];
  for (const asset of draftAssets.rows) {
    const references = await outcomesPool.query<{ artifact_id: string }>(
      `SELECT DISTINCT capture.source_artifact_id AS artifact_id
       FROM outcome_external_canonical_promotion_record member
       CROSS JOIN LATERAL jsonb_array_elements_text(member.evidence_ids) id(value)
       JOIN outcome_external_evidence_row row ON row.evidence_id=id.value
       JOIN outcome_external_evidence_batch batch ON batch.batch_id=row.batch_id
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
       WHERE member.promotion_id=$1 AND member.canonical_record_id IN ($2,$3)
       ORDER BY artifact_id`,
      [receipt.promotionId, asset.asset_version_id, asset.event_version_id]
    );
    draftEntries.push({
      ...asset,
      entry: {
        promotionId: receipt.promotionId,
        eventVersionId: asset.event_version_id,
        assetVersionId: asset.asset_version_id,
        eventDate: asset.event_date,
        evidence: references.rows.map(({ artifact_id }) => {
          const retained = retainedArtifacts.get(artifact_id);
          if (!retained) throw new Error('Missing actual synthetic draft artifact bytes.');
          return retained.reference;
        }),
      },
    });
  }
  const lifecycleAssets = await outcomesPool.query<{
    asset_version_id: string;
    event_version_id: string;
    event_date: string;
  }>(
    `SELECT asset.asset_version_id,asset.event_version_id,event.event_date::TEXT
      FROM outcome_external_canonical_promotion_record member
      JOIN outcome_event_asset asset ON asset.asset_version_id=member.canonical_record_id
      JOIN outcome_event_version event ON event.event_version_id=asset.event_version_id
      WHERE member.promotion_id=$1 AND member.record_kind='transfer' AND asset.player_id=$2
      ORDER BY event.event_date`,
    [receipt.promotionId, playerId]
  );
  return {
    lifecycleEntries: lifecycleAssets.rows.map((asset) => ({
      promotionId: receipt.promotionId,
      eventVersionId: asset.event_version_id,
      assetVersionId: asset.asset_version_id,
      eventDate: asset.event_date,
      evidence: [sourceArtifact],
    })),
    identityResolutions: allResolutions,
    retainedArtifacts,
    draftEntries,
    draftAssets: draftAssets.rows,
    candidate,
    proposal,
    sourceBytes,
    sourceArtifact,
    playerId,
    clubId: targets.toClubId,
    identityDecisionId,
    approvalDecisionId,
    entry: {
      promotionId: receipt.promotionId,
      eventVersionId: assets.rows[0]!.event_version_id,
      assetVersionId: assets.rows[0]!.asset_version_id,
      get eventDate(): string {
        if (tradeDate === null) throw new Error('Year-only trade has no exact-day spell entry.');
        return tradeDate;
      },
      evidence: [sourceArtifact],
    },
  };
}
