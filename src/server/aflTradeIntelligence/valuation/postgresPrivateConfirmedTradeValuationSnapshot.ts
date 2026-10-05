import { doesAflTradeArtifactRefMatchCanonicalJson } from '../artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  aflTradeHpnReviewedSeasonMembershipSchema,
  aflTradeHpnReviewedSeasonUniverseCandidateSchema,
  aflTradeHpnReviewedSeasonUniverseSchema,
} from '../modeling/hpnReviewedSeasonUniverse';
import { aflTradePrivateReviewedHpnCalculationSchema } from '../modeling/privateReviewedHpnCalculation';
import { parseLocalWorkbookPlayerIdentityReview } from '../development/localWorkbookPlayerIdentityReview';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { authenticateAflTradePrivateWorkbookTransactionPromotion } from '../source/postgresPrivateWorkbookTransactionPromotionRepository';
import type {
  AflTradePrivateConfirmedValuationSnapshot,
  AflTradePrivateConfirmedValuationSnapshotLoader,
} from './privateConfirmedTradeValuationSource';
import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
} from './privateReviewedEvidenceEvaluation';

interface AuthorityRow {
  decision_json: unknown;
  bundle_json: unknown;
}

interface PromotionRow {
  promotion_id: string;
  review_set_id: string;
  decision_id: string;
  decision_json: unknown;
  receipt_json: unknown;
  source_artifact_sha256: string;
}

interface CanonicalLineageRow {
  event_id: string;
  event_version_id: string;
  event_date: Date | string;
  asset_key: string;
  asset_version_id: string;
  kind: 'player' | 'current_pick' | 'future_pick';
  player_id: string | null;
  from_club_id: string;
  to_club_id: string;
  spell_id: string | null;
  spell_version_id: string | null;
  rule_id: string | null;
  start_date: Date | string | null;
  end_date: Date | string | null;
}

interface SeasonRow {
  reviewed_json: unknown;
  candidate_json: unknown;
  membership_json: unknown;
  actual_member_count: number | string;
}

interface CalculationRow {
  calculation_json: unknown;
  actual_allocation_count: number | string;
}

interface WorkbookIdentityRow {
  workbook_sha256: string;
  asset_id: string;
  decision_json: unknown;
}

interface OfficialAppearanceRow {
  provider_decoded_row_id: string;
  season_year: number;
  match_date_text: string;
  canonical_player_id: string;
  receiving_club_id: string;
  identity_record_id: string;
  native_match_id: string;
  match_record_id: string;
  metric_code: string;
  definition_version: string;
  numeric_value: number | string;
  factual_record_id: string;
  member_document: unknown;
}

function localPrivateReviewCanonicalId(kind: string, value: unknown): string {
  return `${kind}:${sha256AflTradeCanonicalJson({ boundary: 'private-local-review', value })}`;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Disposable PostgreSQL returned an invalid trusted instant.');
  }
  return parsed.toISOString();
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

async function loadTrustedAt(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<{ trusted_at: Date | string }>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  const trustedAt = result.rows[0]?.trusted_at;
  if (result.rows.length !== 1 || !trustedAt) {
    throw new Error('Disposable PostgreSQL did not provide one trusted snapshot time.');
  }
  return iso(trustedAt);
}

async function loadAuthority(
  transaction: AflOutcomeSqlTransaction,
  valuationScopeKey: string
): Promise<{
  authority: AflTradePrivateConfirmedValuationSnapshot['authority'];
  reviewSetIds: readonly string[];
  completedPlayerStatSeasonYears: readonly number[];
  officialPlayerStatCaptureIds: readonly string[];
} | null> {
  const result = await transaction.query<AuthorityRow>(
    `SELECT decision.decision_json,bundle.bundle_json
       FROM outcome_private_reviewed_evaluation_head head
       JOIN outcome_private_reviewed_evaluation_decision decision
         ON decision.decision_id=head.decision_id
       JOIN outcome_private_reviewed_evidence_bundle bundle
         ON bundle.evidence_bundle_id=head.evidence_bundle_id
      WHERE head.valuation_scope_key=$1
        AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
        AND head.status='authorized'
        AND outcome_private_reviewed_evidence_bundle_is_current(head.evidence_bundle_id)
      `,
    [valuationScopeKey]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new Error('Private reviewed-evidence authority is ambiguous.');
  }
  const decision = parseAflTradePrivateReviewedEvidenceEvaluationDecision(row.decision_json);
  const bundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(row.bundle_json);
  const admission = createAflTradePrivateReviewedEvidenceEvaluationAdmission(decision);
  if (
    admission.state !== 'authorized' ||
    decision.content.valuationScopeKey !== valuationScopeKey ||
    decision.content.evidenceBundleId !== bundle.evidenceBundleId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      decision.content.evidenceBundleArtifact,
      bundle
    )
  ) {
    throw new Error('Private reviewed-evidence authority failed exact authentication.');
  }
  const completedPlayerStatSeasonYears = bundle.content.sourceCaptures
    .filter(
      ({ provider, capabilityId }) =>
        provider === 'afl_tables' && capabilityId === 'afl-tables-player-stats'
    )
    .map(({ seasonYear }) => seasonYear)
    .sort((left, right) => left - right);
  if (
    completedPlayerStatSeasonYears.length === 0 ||
    new Set(completedPlayerStatSeasonYears).size !== completedPlayerStatSeasonYears.length
  ) {
    throw new Error('Private reviewed-evidence authority has ambiguous completed-season coverage.');
  }
  const officialPlayerStatCaptureIds = bundle.content.sourceCaptures
    .filter(
      ({ provider, capabilityId }) =>
        provider === 'official_afl' && capabilityId === 'official-afl-player-stats'
    )
    .map(({ captureId }) => captureId)
    .sort();
  return {
    authority: {
      kind: 'private_confirmed_nonproduction_calculation',
      evidenceKind: admission.authority.evidenceKind,
      decisionId: admission.authority.decisionId,
      evidenceBundleId: admission.authority.evidenceBundleId,
      evidenceBundleArtifact: admission.authority.evidenceBundleArtifact,
      publicationEligible: false,
      publicationProhibited: true,
    },
    reviewSetIds: bundle.content.reviewSets.map(({ reviewSetId }) => reviewSetId),
    completedPlayerStatSeasonYears,
    officialPlayerStatCaptureIds,
  };
}

async function loadPromotion(
  transaction: AflOutcomeSqlTransaction,
  tradeId: string,
  evidenceBundleId: string
): Promise<AflTradePrivateConfirmedValuationSnapshot['promotion'] | null> {
  const result = await transaction.query<PromotionRow>(
    `SELECT promotion.promotion_id,promotion.review_set_id,promotion.decision_id,promotion.decision_json,
            promotion.receipt_json,review_set.source_artifact_sha256
       FROM outcome_private_workbook_transaction_promotion promotion
       JOIN outcome_workbook_transaction_review_set review_set
         ON review_set.review_set_id=promotion.review_set_id
      WHERE promotion.workbook_trade_id=$1 AND promotion.status='active'`,
    [tradeId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new Error('Private workbook transaction promotion is ambiguous.');
  }
  const { decision, receipt } = authenticateAflTradePrivateWorkbookTransactionPromotion({
    workbookTradeId: tradeId,
    reviewSetId: row.review_set_id,
    promotionId: row.promotion_id,
    decisionId: row.decision_id,
    decisionDocument: row.decision_json,
    receiptDocument: row.receipt_json,
  });
  const lineageRows = await transaction.query<CanonicalLineageRow>(
    `SELECT event.event_id,event.event_version_id,event.event_date::text AS event_date,
            asset.asset_key,asset.asset_version_id,asset.kind::text AS kind,
            asset.player_id,asset.from_club_id,asset.to_club_id,
            spell.spell_id,spell.spell_version_id,spell.rule_id,
            spell.start_date::text AS start_date,spell.end_date::text AS end_date
       FROM outcome_event_version event
       JOIN outcome_event_asset asset ON asset.event_version_id=event.event_version_id
       LEFT JOIN outcome_acquisition_spell_version spell
         ON spell.start_event_version_id=event.event_version_id
        AND spell.start_asset_version_id=asset.asset_version_id
        AND NOT EXISTS (
          SELECT 1 FROM outcome_acquisition_spell_version successor
           WHERE successor.supersedes_spell_version_id=spell.spell_version_id
        )
       LEFT JOIN outcome_acquisition_spell_rule rule ON rule.rule_id=spell.rule_id
      WHERE event.event_id=$1 AND event.event_version_id=$2
        AND event.status='approved' AND asset.status='approved'
        AND NOT EXISTS (
          SELECT 1 FROM outcome_event_version successor
           WHERE successor.supersedes_version_id=event.event_version_id
        )
        AND (spell.spell_version_id IS NULL OR
             (spell.status='approved' AND rule.status='approved'))
      ORDER BY asset.asset_key`,
    [receipt.canonicalTransaction.eventId, receipt.canonicalTransaction.eventVersionId]
  );
  const reviewedAssets = decision.content.parties.flatMap(({ assets }) => assets);
  const reviewedPlayerAssets = reviewedAssets.filter(({ assetKind }) => assetKind === 'player');
  const reviewedPlayerAssetIds = new Set(reviewedPlayerAssets.map(({ assetId }) => assetId));
  const promotedWorkbookSha256 = row.source_artifact_sha256;
  const identityRows = await transaction.query<WorkbookIdentityRow>(
    `SELECT workbook_sha256,asset_id,decision_json
       FROM outcome_local_workbook_player_identity_review
      WHERE trade_id=$1 AND evidence_bundle_id=$2 AND workbook_sha256=$3
      ORDER BY asset_id`,
    [tradeId, evidenceBundleId, promotedWorkbookSha256]
  );
  const identityByAsset = new Map(
    identityRows.rows.map((row) => {
      const review = parseLocalWorkbookPlayerIdentityReview(row.decision_json);
      if (
        row.workbook_sha256 !== promotedWorkbookSha256 ||
        review.content.workbookSha256 !== row.workbook_sha256 ||
        review.content.tradeId !== tradeId ||
        review.content.assetId !== row.asset_id ||
        review.content.evidenceBundleId !== evidenceBundleId ||
        !reviewedPlayerAssetIds.has(row.asset_id)
      ) {
        throw new Error('Workbook player identity review failed exact snapshot authentication.');
      }
      return [row.asset_id, review] as const;
    })
  );
  if (
    identityRows.rows.length !== reviewedPlayerAssets.length ||
    identityByAsset.size !== reviewedPlayerAssets.length ||
    reviewedPlayerAssets.some(({ assetId }) => !identityByAsset.has(assetId))
  ) {
    throw new Error('Workbook player identity review membership is incomplete or ambiguous.');
  }
  const receiptLineageByAsset = new Map(
    receipt.canonicalTransaction.assets.map((lineage) => [lineage.assetId, lineage] as const)
  );
  const lineageByAsset = new Map(lineageRows.rows.map((lineage) => [lineage.asset_key, lineage] as const));
  if (
    lineageRows.rows.length !== reviewedAssets.length ||
    lineageByAsset.size !== reviewedAssets.length ||
    receiptLineageByAsset.size !== reviewedAssets.length
  ) {
    throw new Error('Private workbook canonical transaction membership is incomplete or ambiguous.');
  }
  const assets = reviewedAssets.map((asset) => {
    const lineage = lineageByAsset.get(asset.assetId);
    const retained = receiptLineageByAsset.get(asset.assetId);
    const expectedKind =
      asset.assetKind === 'player'
        ? 'player'
        : asset.assetKind === 'pick'
          ? 'current_pick'
          : 'future_pick';
    const spell = retained?.acquisitionSpell ?? null;
    const identityReview = identityByAsset.get(asset.assetId) ?? null;
    if (!lineage || !retained) {
      throw new Error(
        'Private workbook acquisition spell failed exact current authentication: missing_lineage.'
      );
    }
    const mismatches = [
      lineage.event_id !== receipt.canonicalTransaction.eventId ? 'event_id' : null,
      lineage.event_version_id !== receipt.canonicalTransaction.eventVersionId
        ? 'event_version_id'
        : null,
      dateOnly(lineage.event_date) !== decision.content.occurredOn ? 'event_date' : null,
      lineage.asset_version_id !== retained.assetVersionId ? 'asset_version_id' : null,
      lineage.kind !== expectedKind ? 'asset_kind' : null,
      lineage.player_id !== asset.canonicalPlayerId ? 'player_id' : null,
      lineage.from_club_id !== asset.sendingClubId ? 'from_club_id' : null,
      lineage.to_club_id !== asset.receivingClubId ? 'to_club_id' : null,
      (asset.assetKind === 'player') !== (spell !== null) ? 'spell_presence' : null,
      spell !== null && lineage.spell_id !== spell.spellId ? 'spell_id' : null,
      spell !== null && lineage.spell_version_id !== spell.spellVersionId
        ? 'spell_version_id'
        : null,
      spell !== null && lineage.rule_id !== spell.ruleId ? 'spell_rule_id' : null,
      spell !== null &&
      (lineage.start_date === null || dateOnly(lineage.start_date) !== spell.startDate)
        ? 'spell_start_date'
        : null,
      spell !== null &&
      (lineage.end_date === null ? null : dateOnly(lineage.end_date)) !== spell.endDate
        ? 'spell_end_date'
        : null,
      spell === null && lineage.spell_version_id !== null ? 'unexpected_spell' : null,
      asset.assetKind === 'player' && identityReview === null ? 'identity_review_missing' : null,
      identityReview !== null && identityReview.content.canonicalPlayerId !== asset.canonicalPlayerId
        ? 'identity_review_player'
        : null,
    ].filter((reason): reason is string => reason !== null);
    if (mismatches.length > 0) {
      throw new Error(
        `Private workbook acquisition spell failed exact current authentication: ${mismatches.join(',')}.`
      );
    }
    return {
      assetId: asset.assetId,
      assetKind: asset.assetKind,
      sendingClubId: asset.sendingClubId,
      receivingClubId: asset.receivingClubId,
      canonicalPlayerId: asset.canonicalPlayerId,
      acquisitionSpell: spell,
      reviewedRecordedName: identityReview?.content.recordedName ?? null,
      reviewedReceivingClubName: identityReview?.content.receivingClubName ?? null,
      identityReviewDocument: identityReview,
    };
  });
  return {
    promotionId: row.promotion_id,
    decisionId: decision.decisionId,
    decidedAt: decision.content.decidedAt,
    decisionDocument: decision,
    workbookTradeId: decision.content.workbookTradeId,
    occurredOn: decision.content.occurredOn,
    occurrencePrecision: decision.content.occurrencePrecision,
    assets,
  };
}

async function loadReviewedSeasons(
  transaction: AflOutcomeSqlTransaction,
  transactionYear: number,
  cutoffYear: number,
  reviewSetIds: readonly string[],
  expectedSeasonYears: readonly number[]
) {
  const result = await transaction.query<SeasonRow>(
    `SELECT season.reviewed_json,season.candidate_json,season.membership_json,
            (SELECT count(*)::integer
               FROM outcome_hpn_reviewed_season_member member
              WHERE member.reviewed_season_id=season.reviewed_season_id)
              AS actual_member_count
       FROM outcome_hpn_reviewed_season_universe season
      WHERE season.season_year>$1 AND season.season_year<=$2
        AND season.candidate_json->'content'->>'resolvedReviewSetSha256'=ANY($3::text[])
      ORDER BY season.season_year,season.reviewed_season_id`,
    [transactionYear, cutoffYear, reviewSetIds]
  );
  const seenYears = new Set<number>();
  const seasons = result.rows.map((row) => {
    const candidate = aflTradeHpnReviewedSeasonUniverseCandidateSchema.parse(row.candidate_json);
    const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse(row.membership_json);
    const reviewed = aflTradeHpnReviewedSeasonUniverseSchema.parse(row.reviewed_json);
    const seasonYear = reviewed.content.seasonYear;
    if (
      !reviewSetIds.includes(candidate.content.resolvedReviewSetSha256) ||
      reviewed.content.sourceCandidateId !== candidate.candidateId ||
      reviewed.content.membershipId !== membership.membershipId ||
      candidate.content.membershipId !== membership.membershipId ||
      candidate.content.seasonYear !== seasonYear ||
      membership.content.seasonYear !== seasonYear ||
      Number(row.actual_member_count) !== membership.content.rows.length ||
      seenYears.has(seasonYear)
    ) {
      throw new Error('Reviewed HPN season failed exact bundle membership authentication.');
    }
    seenYears.add(seasonYear);
    return { reviewedSeasonId: reviewed.reviewedSeasonId, seasonYear, membership };
  });
  const actualSeasonYears = seasons.map(({ seasonYear }) => seasonYear);
  if (
    actualSeasonYears.length !== expectedSeasonYears.length ||
    actualSeasonYears.some((seasonYear, index) => seasonYear !== expectedSeasonYears[index])
  ) {
    throw new Error('Reviewed HPN evidence does not provide exact expected completed-season coverage.');
  }
  return seasons;
}

async function loadCalculations(
  transaction: AflOutcomeSqlTransaction,
  reviewedSeasonIds: readonly string[],
  cutoffAt: string
) {
  if (reviewedSeasonIds.length === 0) return [];
  const result = await transaction.query<CalculationRow>(
    `SELECT calculation.calculation_json,
            (SELECT count(*)::integer
               FROM outcome_private_reviewed_hpn_allocation allocation
              WHERE allocation.calculation_id=calculation.calculation_id)
              AS actual_allocation_count
       FROM outcome_private_reviewed_hpn_calculation calculation
      WHERE calculation.reviewed_season_id=ANY($1::text[])
        AND calculation.calculated_at<=$2::timestamptz
      ORDER BY calculation.season_year,calculation.calculation_id`,
    [reviewedSeasonIds, cutoffAt]
  );
  const calculations = result.rows.map((row) => {
    const calculation = aflTradePrivateReviewedHpnCalculationSchema.parse(row.calculation_json);
    if (
      !reviewedSeasonIds.includes(calculation.content.reviewedSeasonId) ||
      Number(row.actual_allocation_count) !== calculation.content.allocations.length
    ) {
      throw new Error('Private reviewed HPN calculation failed exact authentication.');
    }
    return calculation;
  });
  const methodIds = new Set(calculations.map(({ content }) => content.methodId));
  const seasonIds = new Set(calculations.map(({ content }) => content.reviewedSeasonId));
  if (methodIds.size > 1 || seasonIds.size !== calculations.length) {
    throw new Error('Private reviewed HPN calculation method or season authority is ambiguous.');
  }
  return calculations;
}

async function loadOfficialAppearanceRows(
  transaction: AflOutcomeSqlTransaction,
  captureIds: readonly string[],
  reviewSetIds: readonly string[],
  promotion: AflTradePrivateConfirmedValuationSnapshot['promotion']
): Promise<readonly OfficialAppearanceRow[]> {
  const reviewedPlayers = promotion.assets.flatMap((asset) =>
    asset.assetKind === 'player' &&
    asset.canonicalPlayerId !== null &&
    asset.reviewedRecordedName !== null &&
    asset.reviewedReceivingClubName !== null &&
    asset.identityReviewDocument !== null
      ? [
          {
            canonical_player_id: asset.canonicalPlayerId,
            receiving_club_id: asset.receivingClubId,
            recorded_name: asset.reviewedRecordedName,
            recorded_club_name: asset.reviewedReceivingClubName,
            identity_record_id: localPrivateReviewCanonicalId(
              'local_canonical_player_club',
              {
                canonicalPlayerId: asset.canonicalPlayerId,
                clubName: asset.reviewedReceivingClubName,
              }
            ),
            identity_review_document: asset.identityReviewDocument,
          },
        ]
      : []
  );
  if (captureIds.length === 0 || reviewedPlayers.length === 0) return [];
  const result = await transaction.query<OfficialAppearanceRow>(
    `WITH requested_player AS MATERIALIZED (
       SELECT requested.canonical_player_id,requested.receiving_club_id,
              requested.recorded_name,requested.recorded_club_name,
              requested.identity_record_id,
              requested.identity_review_document
         FROM jsonb_to_recordset($3::jsonb) AS requested(
           canonical_player_id text,receiving_club_id text,recorded_name text,
           recorded_club_name text,identity_record_id text,identity_review_document jsonb
         )
     ), admitted_review_set AS MATERIALIZED (
       SELECT review_set.subject_id,review_set.evidence_json
         FROM outcome_review_decision review_set
        WHERE review_set.subject_type='local_review_set'
          AND review_set.subject_id=ANY($2::text[])
          AND review_set.decision='approved'
          AND review_set.canonical_record_type='local_review_set'
          AND review_set.canonical_record_id=review_set.subject_id
          AND review_set.evidence_json->>'evidenceSetSha256'=review_set.subject_id
          AND jsonb_array_length(review_set.evidence_json->'decisionIds')=
                (review_set.evidence_json->>'decisionCount')::integer
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=review_set.decision_id
          )
          AND (
            SELECT count(*)
              FROM jsonb_array_elements_text(review_set.evidence_json->'decisionIds') expected(decision_id)
              JOIN outcome_review_decision decision USING (decision_id)
             WHERE decision.decision='approved'
               AND decision.evidence_json->>'evidenceSetSha256'=review_set.subject_id
               AND NOT EXISTS (
                 SELECT 1 FROM outcome_review_decision successor
                  WHERE successor.supersedes_decision_id=decision.decision_id
               )
          )=(review_set.evidence_json->>'decisionCount')::integer
     )
     SELECT decoded.provider_decoded_row_id,decoded.season_year,
            match.match_date_text,requested.canonical_player_id,
            requested.receiving_club_id,identity_review.canonical_record_id AS identity_record_id,
            match.native_match_id,match_review.canonical_record_id AS match_record_id,
            metric.metric_code,metric.definition_version,
            metric.numeric_value::double precision AS numeric_value,
            factual_review.canonical_record_id AS factual_record_id,
            jsonb_build_object(
              'providerDecodedRowId',decoded.provider_decoded_row_id,
              'identityCandidate',to_jsonb(identity),
              'matchCandidate',to_jsonb(match),
              'metricCandidate',to_jsonb(metric),
              'identityReview',identity_review.evidence_json,
              'matchReview',match_review.evidence_json,
              'factualReview',factual_review.evidence_json,
              'reviewSetId',review_set.subject_id,
              'workbookIdentityReview',requested.identity_review_document
            ) AS member_document
       FROM outcome_provider_decoded_row decoded
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
       JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
       JOIN outcome_review_decision identity_review
         ON identity_review.subject_type='provider_identity_candidate'
        AND identity_review.subject_id=identity.identity_candidate_id
        AND identity_review.decision='approved'
        AND identity_review.canonical_record_type='local_canonical_player_club'
        AND identity_review.evidence_json->>'nativeEntityId'=identity.native_entity_id
        AND identity_review.evidence_json->>'recordedName'=identity.recorded_name
        AND identity_review.evidence_json->>'recordedClubName'=identity.recorded_club_name
        AND identity_review.evidence_json->>'providerDecodedRowId'=decoded.provider_decoded_row_id
        AND identity_review.evidence_json->>'captureId'=decoded.capture_id
        AND identity_review.decided_by='local-workbook-evidence-reviewer'
       JOIN requested_player requested
         ON requested.canonical_player_id=identity_review.evidence_json->>'canonicalPlayerId'
        AND requested.identity_record_id=identity_review.canonical_record_id
        AND requested.recorded_name=identity.recorded_name
        AND requested.recorded_club_name=identity.recorded_club_name
       JOIN outcome_review_decision match_review
         ON match_review.subject_type='provider_match_candidate'
        AND match_review.subject_id=match.match_candidate_id
        AND match_review.decision='approved'
        AND match_review.canonical_record_type='local_afl_match'
        AND match_review.evidence_json->>'nativeMatchId'=match.native_match_id
        AND match_review.evidence_json->>'providerDecodedRowId'=decoded.provider_decoded_row_id
        AND match_review.evidence_json->>'captureId'=decoded.capture_id
        AND match_review.evidence_json->>'providerStatus'=match.provider_status
        AND match_review.decided_by='local-workbook-evidence-reviewer'
       JOIN outcome_review_decision factual_review
         ON factual_review.subject_type='local_reconciled_player_match_fact'
        AND factual_review.subject_id=decoded.provider_decoded_row_id
        AND factual_review.decision='approved'
        AND factual_review.canonical_record_type='local_player_match_fact'
        AND factual_review.evidence_json->>'identityCandidateId'=identity.identity_candidate_id
        AND factual_review.evidence_json->>'matchCandidateId'=match.match_candidate_id
        AND factual_review.evidence_json->>'metricCode'=metric.metric_code
        AND factual_review.evidence_json->>'definitionVersion'=metric.definition_version
        AND factual_review.evidence_json->>'appearanceObserved'='true'
        AND (factual_review.evidence_json->>'numericValue')::numeric=metric.numeric_value
        AND factual_review.decided_by='local-workbook-evidence-reviewer'
       JOIN admitted_review_set review_set
         ON review_set.subject_id=identity_review.evidence_json->>'evidenceSetSha256'
        AND review_set.subject_id=match_review.evidence_json->>'evidenceSetSha256'
        AND review_set.subject_id=factual_review.evidence_json->>'evidenceSetSha256'
        AND review_set.evidence_json->'decisionIds' ? identity_review.decision_id
        AND review_set.evidence_json->'decisionIds' ? match_review.decision_id
        AND review_set.evidence_json->'decisionIds' ? factual_review.decision_id
      WHERE decoded.capture_id=ANY($1::text[])
        AND decoded.season_year IS NOT NULL
        AND match.provider_status='CONCLUDED'
        AND metric.metric_code='goals'
        AND metric.availability='exact'
        AND NOT EXISTS (
          SELECT 1 FROM outcome_review_decision successor
           WHERE successor.supersedes_decision_id=identity_review.decision_id
              OR successor.supersedes_decision_id=match_review.decision_id
              OR successor.supersedes_decision_id=factual_review.decision_id
        )
      ORDER BY requested.canonical_player_id,match.match_date_text,decoded.provider_decoded_row_id`,
    [captureIds, reviewSetIds, JSON.stringify(reviewedPlayers)]
  );
  const rowIds = result.rows.map(({ provider_decoded_row_id }) => provider_decoded_row_id);
  const canonicalAppearanceKeys = result.rows.map((row) => {
    const expectedMatchRecordId = localPrivateReviewCanonicalId(
      'local_afl_match',
      row.native_match_id
    );
    const expectedFactRecordId = localPrivateReviewCanonicalId('local_player_match_fact', {
      playerClubId: row.identity_record_id,
      matchId: expectedMatchRecordId,
      metricCode: row.metric_code,
      definitionVersion: row.definition_version,
      numericValue: Number(row.numeric_value),
    });
    if (
      row.match_record_id !== expectedMatchRecordId ||
      row.factual_record_id !== expectedFactRecordId
    ) {
      throw new Error('Official appearance review canonical target authentication failed.');
    }
    return `${row.canonical_player_id}\u0000${expectedMatchRecordId}\u0000${row.receiving_club_id}`;
  });
  if (
    new Set(rowIds).size !== rowIds.length ||
    new Set(canonicalAppearanceKeys).size !== canonicalAppearanceKeys.length
  ) {
    throw new Error('Official current-season appearance evidence is ambiguous.');
  }
  return result.rows;
}

export function createPostgresAflTradePrivateConfirmedValuationSnapshotLoader(
  client: AflOutcomeSqlClient
): AflTradePrivateConfirmedValuationSnapshotLoader {
  return {
    load(input) {
      return client.transaction(async (transaction) => {
        const trustedAt = await loadTrustedAt(transaction);
        const cutoffAt = input.knowledgeCutoffAt ?? trustedAt;
        if (Date.parse(cutoffAt) > Date.parse(trustedAt)) {
          throw new TypeError('Private valuation knowledge cutoff cannot exceed trusted database time.');
        }
        const authority = await loadAuthority(transaction, input.valuationScopeKey);
        if (authority === null) return null;
        const promotion = await loadPromotion(
          transaction,
          input.tradeId,
          authority.authority.evidenceBundleId
        );
        if (promotion === null) return null;
        const transactionYear = Number(promotion.occurredOn.slice(0, 4));
        const cutoffYear = new Date(cutoffAt).getUTCFullYear();
        const expectedSeasonYears = authority.completedPlayerStatSeasonYears.filter(
          (seasonYear) => seasonYear > transactionYear && seasonYear <= cutoffYear
        );
        const seasons = await loadReviewedSeasons(
          transaction,
          transactionYear,
          cutoffYear,
          authority.reviewSetIds,
          expectedSeasonYears
        );
        const calculations = await loadCalculations(
          transaction,
          seasons.map(({ reviewedSeasonId }) => reviewedSeasonId),
          cutoffAt
        );
        const playerKeys = new Set(
          promotion.assets.flatMap((asset) =>
            asset.canonicalPlayerId === null
              ? []
              : [`${asset.canonicalPlayerId}\u0000${asset.receivingClubId}`]
          )
        );
        const completedSeasonAppearanceRows = seasons.flatMap(({ seasonYear, membership }) =>
          membership.content.rows.flatMap((member) => {
            if (
              member.playerIdentity.state !== 'resolved' ||
              !playerKeys.has(
                `${member.playerIdentity.canonicalPlayerId}\u0000${member.playingForClubId}`
              )
            ) {
              return [];
            }
            return [
              {
                providerDecodedRowId: member.providerDecodedRowId,
                seasonYear,
                matchDate: member.matchDate,
                canonicalPlayerId: member.playerIdentity.canonicalPlayerId,
                playingForClubId: member.playingForClubId,
                memberDocument: member,
              },
            ];
          })
        );
        const officialAppearanceRows = await loadOfficialAppearanceRows(
          transaction,
          authority.officialPlayerStatCaptureIds,
          authority.reviewSetIds,
          promotion
        );
        const overlappingOfficialSeason = officialAppearanceRows.find((row) =>
          authority.completedPlayerStatSeasonYears.includes(row.season_year)
        );
        if (overlappingOfficialSeason) {
          throw new Error(
            `Official appearance evidence overlaps completed AFL Tables season ${overlappingOfficialSeason.season_year}.`
          );
        }
        const appearanceRows = [
          ...completedSeasonAppearanceRows,
          ...officialAppearanceRows.map((row) => ({
            providerDecodedRowId: row.provider_decoded_row_id,
            seasonYear: row.season_year,
            matchDate: row.match_date_text,
            canonicalPlayerId: row.canonical_player_id,
            playingForClubId: row.receiving_club_id,
            memberDocument: row.member_document,
          })),
        ];
        const appearanceKeys = appearanceRows.map(
          ({ providerDecodedRowId }) => providerDecodedRowId
        );
        if (new Set(appearanceKeys).size !== appearanceKeys.length) {
          throw new Error('Private confirmed appearance evidence contains duplicate rows.');
        }
        const calculationInputs = calculations.flatMap((calculation) =>
          calculation.content.allocations.flatMap((allocation) => {
            if (
              allocation.identity.state !== 'resolved' ||
              !playerKeys.has(
                `${allocation.identity.canonicalPlayerId}\u0000${allocation.clubId}`
              )
            ) {
              return [];
            }
            return [
              {
                calculationId: calculation.calculationId,
                calculatedAt: calculation.content.calculatedAt,
                seasonYear: calculation.content.seasonYear,
                methodId: calculation.content.methodId,
                calculationDocument: calculation,
                allocation: {
                  canonicalPlayerId: allocation.identity.canonicalPlayerId,
                  clubId: allocation.clubId,
                  gamesPlayed: allocation.gamesPlayed,
                  sourceRowIds: allocation.sourceRowIds,
                  offensiveScore: allocation.offensiveScore,
                  midfieldScore: allocation.midfieldScore,
                  defensiveScore: allocation.defensiveScore,
                  offensivePav: allocation.offensivePav,
                  midfieldPav: allocation.midfieldPav,
                  defensivePav: allocation.defensivePav,
                  totalPav: allocation.totalPav,
                },
              },
            ];
          })
        );
        return {
          trustedAt,
          authority: authority.authority,
          promotion,
          expectedSeasonYears,
          appearanceRows,
          calculations: calculationInputs,
        };
      }, { isolationLevel: 'repeatable_read', accessMode: 'read_only' });
    },
  };
}
