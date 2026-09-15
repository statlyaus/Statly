import { z } from 'zod';

import { doesAflTradeArtifactRefMatchBytes } from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { createAflTradePostseasonYearContext } from '../domain/postseasonYearContext';
import {
  PostgresAflTradeAcquisitionSpellRegistrationRepository,
  type AflTradeAcquisitionRegistrationEvidenceReader,
} from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradePromotionBackedFactualReleaseSchema } from '../outcomes/promotionBackedFactualReleaseContracts';
import { aflTradePostseasonMaterializationReviewSchema } from './postseasonMaterializationReview';

const requestSchema = z
  .object({
    reviewDecisionId: z.string().min(1).max(240),
    environment: z.enum(['test_fixture', 'non_production']),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

interface ReviewRow {
  evidence_json: unknown;
  subject_id: string;
  recorded_at: string;
}

/** Resolves a reviewed private factual selection; grants no dataset/model admission. */
export async function loadCurrentAflTradePostseasonContext(
  transaction: AflOutcomeSqlTransaction,
  input: unknown,
  evidence: AflTradeAcquisitionRegistrationEvidenceReader
) {
  const request = requestSchema.parse(input);
  const decisions = await transaction.query<ReviewRow>(
    `SELECT evidence_json,subject_id,
       to_char(decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at
     FROM outcome_review_decision
     WHERE decision_id=$1 AND subject_type='postseason_materialization' AND decision='approved'
       AND decided_at<=$2::timestamptz AND $2::timestamptz<=transaction_timestamp()
     FOR SHARE`,
    [request.reviewDecisionId, request.knowledgeCutoffAt]
  );
  if (decisions.rows.length !== 1)
    throw new Error('Postseason materialization review is unavailable.');
  const decision = decisions.rows[0]!;
  const review = aflTradePostseasonMaterializationReviewSchema.parse(decision.evidence_json);
  const c = review.content;
  const reviewArtifacts = [
    c.reviewEvidence,
    ...(c.schemaVersion === 'afl-trade-postseason-materialization-review/v2'
      ? [
          c.valuation.componentDrawSetArtifact,
          c.valuation.realizedContributionLedgerArtifact,
          c.valuation.packagePolicyArtifact,
          c.valuation.lineageGraphArtifact,
        ]
      : []),
  ].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (decision.subject_id !== review.reviewId || c.environment !== request.environment) {
    throw new Error('Postseason materialization review scope differs.');
  }
  await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `outcome-review-subject:postseason_materialization:${review.reviewId}`,
  ]);
  const authority = await transaction.query<{ manifest_json: unknown }>(
    `SELECT release.manifest_json
     FROM outcome_release_manifest release
     JOIN outcome_factual_release_candidate candidate ON candidate.target_release_id=release.release_id
     JOIN outcome_release_event_version member ON member.release_id=release.release_id
     JOIN outcome_event_version event ON event.event_version_id=member.event_version_id
     JOIN outcome_event root ON root.event_id=event.event_id
     JOIN outcome_release_event_asset asset_member ON asset_member.release_id=release.release_id
     JOIN outcome_acquisition_spell_version spell ON spell.start_asset_version_id=asset_member.asset_version_id
       AND spell.start_event_version_id=event.event_version_id
     WHERE release.release_id=$1 AND release.environment=$2 AND release.scope_key=$3
       AND candidate.status='approved' AND candidate.finalized_at IS NOT NULL
       AND candidate.environment::text=$2 AND candidate.scope_key=$3 AND candidate.competition='AFLM'
       AND candidate.finalized_at<=$9::timestamptz AND release.created_at<=$9::timestamptz
       AND release.effective_through<=$9::timestamptz
       AND release.manifest_canonical_json=outcome_afl_trade_canonical_json(release.manifest_json->'content')
       AND event.event_version_id=$4 AND event.event_id=$5 AND root.season_year=$6
       AND event.event_date IS NOT DISTINCT FROM $7::date
       AND event.kind='trade' AND event.status='approved' AND root.competition='AFLM'
       AND event.recorded_at<=$9::timestamptz AND spell.spell_version_id=$8
       AND NOT EXISTS (SELECT 1 FROM outcome_event_version next WHERE next.supersedes_version_id=event.event_version_id)
       AND outcome_acquisition_spell_registration_current(spell.spell_version_id,transaction_timestamp())
       AND outcome_acquisition_registration_review_current($10,'postseason_materialization',$11,
         $12::jsonb,$13::timestamptz,$14::timestamptz,transaction_timestamp())
       AND outcome_acquisition_registration_evidence_exact($15::jsonb,$2,$13::timestamptz,$14::timestamptz)
       AND member.record_sha256=encode(sha256(convert_to(member.record_canonical_json,'UTF8')),'hex')
       AND asset_member.record_sha256=encode(sha256(convert_to(asset_member.record_canonical_json,'UTF8')),'hex')
       AND release.manifest_json#>'{content,canonicalMembers}' @> jsonb_build_array(
         jsonb_build_object('recordKind','transaction','canonicalRecordId',event.event_version_id,
           'canonicalRecordSha256',member.record_sha256),
         jsonb_build_object('recordKind','transfer','canonicalRecordId',spell.start_asset_version_id,
           'canonicalRecordSha256',asset_member.record_sha256))
       AND NOT EXISTS (SELECT 1 FROM outcome_active_release active WHERE active.release_id=release.release_id)
       AND NOT EXISTS (SELECT 1 FROM outcome_record_state_commitment state
         WHERE state.release_id=release.release_id AND state.event_revision=(
           SELECT max(latest.event_revision) FROM outcome_record_state_commitment latest
           WHERE latest.release_id=release.release_id)
         AND state.record_state_json->>'state'<>'approved')
     FOR SHARE OF release,candidate,member,event,root,asset_member,spell`,
    [
      c.releaseId,
      c.environment,
      c.scopeKey,
      c.eventVersionId,
      c.tradeId,
      c.tradeYear,
      c.tradeDate,
      c.spellVersionId,
      request.knowledgeCutoffAt,
      request.reviewDecisionId,
      review.reviewId,
      canonicalizeAflTradeJson(review),
      c.createdAt,
      decision.recorded_at,
      canonicalizeAflTradeJson(reviewArtifacts),
    ]
  );
  if (authority.rows.length !== 1)
    throw new Error('Postseason release, review or spell authority is not current.');
  const release = aflTradePromotionBackedFactualReleaseSchema.parse(
    authority.rows[0]!.manifest_json
  );
  if (
    release.releaseId !== c.releaseId ||
    release.content.environment !== c.environment ||
    release.content.competition !== c.competition ||
    release.content.scopeKey !== c.scopeKey
  ) {
    throw new Error('Postseason release content differs.');
  }
  for (const reference of reviewArtifacts) {
    if (!doesAflTradeArtifactRefMatchBytes(reference, await evidence.read(reference))) {
      throw new Error('Postseason review evidence bytes differ.');
    }
  }
  const acquisitionSpell = await new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    {
      query: transaction.query.bind(transaction),
      transaction: async (work) => work(transaction),
    },
    evidence
  ).loadCurrentExact(c.spellVersionId, { environment: c.environment, competition: c.competition });
  const entry = acquisitionSpell.content.entry;
  if (
    entry.promotionId !== c.promotionId ||
    entry.eventVersionId !== c.eventVersionId ||
    entry.eventDate !== c.tradeDate ||
    Date.parse(acquisitionSpell.content.createdAt) > Date.parse(request.knowledgeCutoffAt)
  ) {
    throw new Error('Postseason reviewed acquisition binding differs.');
  }
  const context = createAflTradePostseasonYearContext({
    schemaVersion: 'afl-trade-postseason-year-context/v1',
    environment: c.environment,
    competition: c.competition,
    tradeId: c.tradeId,
    promotionId: c.promotionId,
    eventVersionId: c.eventVersionId,
    tradeYear: c.tradeYear,
    tradeDate: c.tradeDate,
    period: c.period,
    reviewDecisionId: request.reviewDecisionId,
    reviewEvidence: c.reviewEvidence,
    recordedAt: decision.recorded_at,
    knowledgeCutoffAt: request.knowledgeCutoffAt,
    knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
  });
  return { context, acquisitionSpell, release, review };
}
