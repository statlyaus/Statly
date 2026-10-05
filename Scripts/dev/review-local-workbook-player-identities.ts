import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { doesAflTradeArtifactRefMatchCanonicalJson } from '../../src/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  assertExactLocalWorkbookPlayerIdentityReview,
  prepareLocalWorkbookPlayerIdentityReviews,
} from '../../src/server/aflTradeIntelligence/development/localWorkbookPlayerIdentityReview';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { loadAflOutcomesDevelopmentWorkbook } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';
import { authenticateAflTradePrivateWorkbookTransactionPromotion } from '../../src/server/aflTradeIntelligence/source/postgresPrivateWorkbookTransactionPromotionRepository';
import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '../../src/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';

const REVIEWED_AT = '2026-08-16T14:30:00.000Z';

interface AuthorityRow {
  decision_id: string;
  evidence_bundle_id: string;
  decision_json: unknown;
  bundle_json: unknown;
}

interface PromotionRow {
  promotion_id: string;
  review_set_id: string;
  decision_id: string;
  source_artifact_sha256: string;
  decision_json: unknown;
  receipt_json: unknown;
}

interface EvidenceIdentityRow {
  canonical_player_id: string;
  recorded_name: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertDisposableDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError('Workbook identity review requires loopback statly_outcomes_test PostgreSQL.');
  }
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new TypeError('Workbook identity review is prohibited in production.');
  }
}

async function runtimeNonce(): Promise<string> {
  const configured = process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
  const nonce =
    configured ??
    (
      await readFile(
        resolve(process.cwd(), '.statly-local/afl-trade-outcomes-runtime-nonce'),
        'utf8'
      )
    ).trim();
  if (!/^[a-f0-9]{64}$/u.test(nonce)) {
    throw new TypeError('The disposable outcomes runtime nonce is invalid.');
  }
  return nonce;
}

function parseArguments(): { valuationScopeKey: string; tradeId: string } {
  const args = process.argv.slice(2);
  const scopeIndex = args.indexOf('--scope');
  const tradeIndex = args.indexOf('--trade');
  const valuationScopeKey = scopeIndex >= 0 ? args[scopeIndex + 1]?.trim() : undefined;
  const tradeId = tradeIndex >= 0 ? args[tradeIndex + 1]?.trim() : undefined;
  if (
    !valuationScopeKey ||
    !tradeId ||
    args.length !== 4 ||
    new Set([scopeIndex, tradeIndex]).size !== 2
  ) {
    throw new TypeError('Use --scope <valuation-scope-key> --trade <workbook-trade-id>.');
  }
  return { valuationScopeKey, tradeId };
}

async function main(): Promise<void> {
  const { valuationScopeKey, tradeId } = parseArguments();
  const workbookPath = required('AFL_OUTCOMES_DEV_WORKBOOK_PATH');
  const workbookSha256 = required('AFL_OUTCOMES_DEV_WORKBOOK_SHA256').toLowerCase();
  const workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256: workbookSha256,
    runtimeEnvironment: process.env.NODE_ENV,
  });
  const detail = projectAflOutcomesDevelopmentWorkbookTrades(workbook).detailsById.get(tradeId);
  if (!detail) throw new Error('The requested trade is absent from the pinned workbook.');
  if (valuationScopeKey !== `afl-men:${detail.trade.year}-trades`) {
    throw new Error('The requested valuation scope does not match the workbook trade year.');
  }

  const databaseUrl = required('AFL_OUTCOMES_DATABASE_URL');
  assertDisposableDatabase(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'statly-local-workbook-player-identity-review',
    connectionTimeoutMillis: 30_000,
    max: 1,
  });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, await runtimeNonce());
    await pool.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const authorityResult = await pool.query<AuthorityRow>(
      `SELECT head.decision_id,head.evidence_bundle_id,
              decision.decision_json,bundle.bundle_json
         FROM outcome_private_reviewed_evaluation_head head
         JOIN outcome_private_reviewed_evaluation_decision decision
           ON decision.decision_id=head.decision_id
         JOIN outcome_private_reviewed_evidence_bundle bundle
           ON bundle.evidence_bundle_id=head.evidence_bundle_id
        WHERE head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
          AND head.valuation_scope_key=$1
          AND head.status='authorized'
          AND outcome_private_reviewed_evidence_bundle_is_current(head.evidence_bundle_id)`,
      [valuationScopeKey]
    );
    if (authorityResult.rows.length !== 1) {
      const staleAuthority = await pool.query<{
        decision_id: string;
        evidence_bundle_id: string;
        bundle_current: boolean;
      }>(
        `SELECT head.decision_id,head.evidence_bundle_id,
                outcome_private_reviewed_evidence_bundle_is_current(
                  head.evidence_bundle_id
                ) AS bundle_current
          FROM outcome_private_reviewed_evaluation_head head
          WHERE head.valuation_scope_key=$1
            AND head.status='authorized'`,
        [valuationScopeKey]
      );
      const stale = staleAuthority.rows[0];
      if (staleAuthority.rows.length === 1 && stale && !stale.bundle_current) {
        throw new Error(
          `The private reviewed-evidence authority is stale after provider review. Explicitly refresh ${valuationScopeKey} with --expected-current ${stale.decision_id} through outcomes:modeling:record-private-reviewed-evaluation-authority before retaining workbook identity review.`
        );
      }
      throw new Error('The requested scope requires one exact current reviewed-evidence authority.');
    }
    const parent = authorityResult.rows[0]!;
    const authorityDecision = parseAflTradePrivateReviewedEvidenceEvaluationDecision(
      parent.decision_json
    );
    const evidenceBundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(parent.bundle_json);
    const admission = createAflTradePrivateReviewedEvidenceEvaluationAdmission(authorityDecision);
    if (
      admission.state !== 'authorized' ||
      parent.decision_id !== authorityDecision.decisionId ||
      parent.evidence_bundle_id !== evidenceBundle.evidenceBundleId ||
      authorityDecision.content.valuationScopeKey !== valuationScopeKey ||
      authorityDecision.content.evidenceBundleId !== evidenceBundle.evidenceBundleId ||
      !doesAflTradeArtifactRefMatchCanonicalJson(
        authorityDecision.content.evidenceBundleArtifact,
        evidenceBundle
      )
    ) {
      throw new Error('The private reviewed-evidence authority failed exact authentication.');
    }
    const promotionResult = await pool.query<PromotionRow>(
      `SELECT promotion.promotion_id,promotion.review_set_id,promotion.decision_id,
              review_set.source_artifact_sha256,promotion.decision_json,
              promotion.receipt_json
         FROM outcome_private_workbook_transaction_promotion promotion
         JOIN outcome_workbook_transaction_review_set review_set
           ON review_set.review_set_id=promotion.review_set_id
        WHERE promotion.workbook_trade_id=$1 AND promotion.status='active'`,
      [tradeId]
    );
    if (promotionResult.rows.length !== 1) {
      throw new Error('The requested trade requires one exact active private promotion.');
    }
    const promotion = promotionResult.rows[0]!;
    const { decision: transactionDecision } =
      authenticateAflTradePrivateWorkbookTransactionPromotion({
        workbookTradeId: tradeId,
        reviewSetId: promotion.review_set_id,
        promotionId: promotion.promotion_id,
        decisionId: promotion.decision_id,
        decisionDocument: promotion.decision_json,
        receiptDocument: promotion.receipt_json,
      });
    if (
      promotion.source_artifact_sha256 !== workbookSha256 ||
      promotion.review_set_id !== transactionDecision.content.reviewSetId
    ) {
      throw new Error('The active private promotion does not belong to the pinned workbook.');
    }
    const promotedPlayerAssets = transactionDecision.content.parties.flatMap(({ assets }) =>
      assets.filter(({ assetKind }) => assetKind === 'player')
    );
    const promotedPlayerIds = promotedPlayerAssets.flatMap(({ canonicalPlayerId }) =>
      canonicalPlayerId === null ? [] : [canonicalPlayerId]
    );
    const identityEvidence = await pool.query<EvidenceIdentityRow>(
      `SELECT DISTINCT member.canonical_player_id,candidate.recorded_name
         FROM outcome_hpn_reviewed_season_member member
         JOIN outcome_hpn_reviewed_season_universe season
           ON season.reviewed_season_id=member.reviewed_season_id
         JOIN outcome_provider_identity_candidate candidate
           ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
        WHERE member.identity_state='resolved'
          AND member.canonical_player_id=ANY($1::text[])
          AND season.candidate_json->'content'->>'resolvedReviewSetSha256'=ANY($2::text[])
        ORDER BY member.canonical_player_id,candidate.recorded_name`,
      [
        promotedPlayerIds,
        evidenceBundle.content.reviewSets.map(({ reviewSetId }) => reviewSetId),
      ]
    );
    const reviews = prepareLocalWorkbookPlayerIdentityReviews({
      workbookSha256,
      valuationScopeKey,
      tradeId,
      tradeYear: detail.trade.year,
      tradeTitle: detail.trade.title,
      workbookPlayerAssets: detail.assets.flatMap((asset) =>
        asset.assetType === 'player' && asset.playerName !== null
          ? [
              {
                assetId: asset.id,
                sourcePlayerName: asset.playerName,
                sourceAssetText: asset.assetText,
                receivingClubName: asset.clubName,
              },
            ]
          : []
      ),
      promotedPlayerAssets,
      reviewedProviderIdentities: identityEvidence.rows.map(
        ({ canonical_player_id, recorded_name }) => ({
          canonicalPlayerId: canonical_player_id,
          recordedName: recorded_name,
        })
      ),
      evidenceBundleId: evidenceBundle.evidenceBundleId,
      reviewerId: 'local-workbook-player-identity-reviewer',
      reviewedAt: REVIEWED_AT,
    });
    try {
      for (const review of reviews) {
        await pool.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `local-workbook-player-identity:${workbookSha256}:${review.content.assetId}`,
        ]);
        await pool.query(
          `INSERT INTO outcome_local_workbook_player_identity_review
            (decision_id,workbook_sha256,trade_id,asset_id,source_player_name,
             source_asset_text,receiving_club_name,canonical_player_id,recorded_name,
             evidence_bundle_id,reviewer_id,reviewed_at,decision_content_sha256,decision_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (workbook_sha256,asset_id,evidence_bundle_id) DO NOTHING`,
          [
            review.decisionId,
            workbookSha256,
            tradeId,
            review.content.assetId,
            review.content.sourcePlayerName,
            review.content.sourceAssetText,
            review.content.receivingClubName,
            review.content.canonicalPlayerId,
            review.content.recordedName,
            evidenceBundle.evidenceBundleId,
            review.content.reviewerId,
            review.content.reviewedAt,
            review.decisionId.split(':')[1],
            review,
          ]
        );
        const retained = await pool.query<{ decision_json: unknown }>(
          `SELECT decision_json
             FROM outcome_local_workbook_player_identity_review
            WHERE workbook_sha256=$1 AND asset_id=$2 AND evidence_bundle_id=$3
            FOR SHARE`,
          [workbookSha256, review.content.assetId, evidenceBundle.evidenceBundleId]
        );
        if (retained.rows.length !== 1) {
          throw new Error('The retained local workbook player identity review conflicts.');
        }
        assertExactLocalWorkbookPlayerIdentityReview(retained.rows[0]!.decision_json, review);
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    process.stdout.write(
      `${JSON.stringify({
        status: 'reviewed',
        valuationScopeKey,
        tradeId,
        reviewedPlayerCount: reviews.length,
        identities: reviews.map(({ content }) => ({
          assetId: content.assetId,
          canonicalPlayerId: content.canonicalPlayerId,
          recordedName: content.recordedName,
        })),
        publicationEligible: false,
      })}\n`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
