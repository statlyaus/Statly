import { z } from 'zod';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  PostgresAflTradeHpnStatisticalAdjudicationRepository,
  type AflTradeHpnAdjudicationEvidenceReader,
} from './postgresHpnStatisticalAdjudicationRepository';
import { authenticateAflTradeHpnStatisticalSources } from './postgresHpnStatisticalSourceAuthentication';

const executionSchema = z
  .object({ environment: z.literal('non_production'), principalRef: z.string().min(1).max(240) })
  .strict();
export const privateClearanceSupportSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-hpn-private-clearance-support/v1'),
    evidenceKind: z.literal('transcribed_official_browser_observation'),
    decisionId: z.string().regex(/^hpn-statistical-decision:[a-f0-9]{64}$/),
    authorityEvidenceId: z.string().regex(/^reviewer-authority-evidence:[a-f0-9]{64}$/),
    reviewerId: z.string().min(1).max(240),
    reviewedAt: z.iso.datetime({ offset: true }),
    artifactBytesBase64: z.string().min(1).max(1400000),
    sourceUrl: z.string().regex(/^https:\/\/www\.afl\.com\.au\/afl\/matches\/[0-9]+#player-stats$/),
    rowIndex: z.number().int().nonnegative().max(1000),
    columnIndex: z.number().int().nonnegative().max(100),
    publicationEligible: z.literal(false),
    independentCollectionEstablished: z.literal(false),
  })
  .strict();

async function lockAuthority(transaction: AflOutcomeSqlTransaction) {
  // A tiny private batch: hold review/head writers until the exact checks and head write finish.
  await transaction.query(`LOCK TABLE outcome_review_decision,outcome_provider_identity_assignment_head,
    outcome_provider_player_resolution_head,outcome_provider_match_resolution_head,
    outcome_provider_club_resolution_head,outcome_hpn_field_map_review_decision IN SHARE MODE`);
}

/** Private factual selections only. Partial selections never authorize an HPN calculation. */
export class PostgresAflTradeHpnPrivateClearanceApplication {
  private readonly custody: PostgresAflTradeHpnStatisticalAdjudicationRepository;
  constructor(private readonly client: AflOutcomeSqlClient) {
    this.custody = new PostgresAflTradeHpnStatisticalAdjudicationRepository(client);
  }

  async approveSupport(
    input: unknown,
    execution: z.input<typeof executionSchema>,
    reader: AflTradeHpnAdjudicationEvidenceReader
  ) {
    const context = executionSchema.parse(execution);
    const review = privateClearanceSupportSchema.parse(input);
    const retained = await this.custody.loadUnverified(review.decisionId, reader);
    if (
      !retained ||
      retained.decision.reviewerId !== context.principalRef ||
      review.reviewerId !== context.principalRef
    )
      throw new Error('Support review requires the authenticated statistical reviewer.');
    const canonical = canonicalizeAflTradeJson(review);
    const reviewId = createAflTradeContentAddress('hpn-statistical-support', review);
    const approvalId = createAflTradeContentAddress('review-decision', {
      reviewId,
      principalRef: context.principalRef,
    });
    await this.client.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
        VALUES ($1,'hpn_statistical_support',$2,'approved',$3,$4::jsonb,$5,$6)
        ON CONFLICT(decision_id) DO NOTHING`,
        [
          approvalId,
          reviewId,
          'Private factual selection review of explicit retained official-page transcription; no provider capture, independent collection or publication authority claimed.',
          canonical,
          context.principalRef,
          review.reviewedAt,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_hpn_statistical_support_review
        (review_id,decision_id,approval_decision_id,review_canonical_json,review_json)
        VALUES($1,$2,$3,$4::text,($4::text)::jsonb) ON CONFLICT(review_id) DO NOTHING`,
        [reviewId, review.decisionId, approvalId, canonical]
      );
      const valid = await transaction.query<{ current: boolean }>(
        'SELECT outcome_hpn_statistical_support_is_current($1) AS current',
        [reviewId]
      );
      if (valid.rows[0]?.current !== true)
        throw new Error(
          'Supporting review does not match current authority and exact explicit evidence.'
        );
      await transaction.query('SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer');
    });
    return { reviewId, approvalId };
  }

  async apply(
    decisionId: string,
    reviewId: string,
    execution: z.input<typeof executionSchema>,
    reader: AflTradeHpnAdjudicationEvidenceReader
  ) {
    const context = executionSchema.parse(execution);
    const retained = await this.custody.loadUnverified(decisionId, reader);
    if (!retained || retained.decision.reviewerId !== context.principalRef)
      throw new Error('Application requires the authenticated statistical reviewer.');
    const scopeKey = createAflTradeContentAddress(
      'hpn-statistical-scope',
      retained.decision.candidate.scope
    );
    return this.client.transaction(async (transaction) => {
      await lockAuthority(transaction);
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scopeKey]);
      const source = await authenticateAflTradeHpnStatisticalSources(
        transaction,
        retained.decision.candidate,
        { decisionId, reviewId }
      );
      const head = await transaction.query<{
        decision_id: string;
        revision: number;
        support_review_id: string;
        current: boolean;
      }>(
        `SELECT decision_id,revision,support_review_id,
          outcome_hpn_statistical_selection_is_current(decision_id,support_review_id,identity_json) AS current
         FROM outcome_hpn_statistical_current_selection WHERE scope_key=$1 FOR UPDATE`,
        [scopeKey]
      );
      if (head.rows[0]?.decision_id === decisionId) {
        if (head.rows[0].support_review_id !== reviewId || head.rows[0].current !== true)
          throw new Error(
            'Exact replay requires the same current supporting review and identities.'
          );
        return {
          decisionId,
          revision: head.rows[0].revision,
          idempotentReplay: true,
          calculationEligible: false as const,
          publicationEligible: false as const,
        };
      }
      if ((head.rows[0]?.decision_id ?? null) !== retained.decision.supersedesDecisionId)
        throw new Error(
          'Statistical selection head changed; a new reviewed supersession is required.'
        );
      const revision = (head.rows[0]?.revision ?? 0) + 1;
      await transaction.query(
        head.rows.length
          ? `UPDATE outcome_hpn_statistical_current_selection SET decision_id=$2,support_review_id=$3,
              revision=$4,supersedes_decision_id=$5,identity_json=$6::jsonb,applied_at=date_trunc('milliseconds',clock_timestamp())
             WHERE scope_key=$1`
          : `INSERT INTO outcome_hpn_statistical_current_selection
              (scope_key,decision_id,support_review_id,revision,supersedes_decision_id,identity_json)
             VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          scopeKey,
          decisionId,
          reviewId,
          revision,
          retained.decision.supersedesDecisionId,
          canonicalizeAflTradeJson(source.identities),
        ]
      );
      return {
        decisionId,
        revision,
        idempotentReplay: false,
        calculationEligible: false as const,
        publicationEligible: false as const,
      };
    });
  }

  async loadCurrent(decisionId: string, reader: AflTradeHpnAdjudicationEvidenceReader) {
    const retained = await this.custody.loadUnverified(decisionId, reader);
    if (!retained) return null;
    return this.client.transaction(async (transaction) => {
      await lockAuthority(transaction);
      const rows = await transaction.query<{ support_review_id: string; revision: number }>(
        `SELECT support_review_id,revision FROM outcome_hpn_statistical_current_selection h
         WHERE decision_id=$1 AND outcome_hpn_statistical_selection_is_current(h.decision_id,h.support_review_id,h.identity_json) FOR SHARE`,
        [decisionId]
      );
      if (rows.rows.length !== 1) return null;
      await authenticateAflTradeHpnStatisticalSources(transaction, retained.decision.candidate, {
        decisionId,
        reviewId: rows.rows[0].support_review_id,
      });
      return {
        decision: retained.decision,
        supportReviewId: rows.rows[0].support_review_id,
        revision: rows.rows[0].revision,
        status: 'current_private_selection' as const,
        calculationEligible: false as const,
        publicationEligible: false as const,
      };
    });
  }
}
