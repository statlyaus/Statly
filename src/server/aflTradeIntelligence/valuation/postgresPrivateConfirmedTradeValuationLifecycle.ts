import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateConfirmedValuationPlanV2Schema,
  aflTradePrivateConfirmedValuationResultV2Schema,
} from './privateConfirmedTradeValuationContracts';
import type { AflTradePrivateConfirmedValuationLifecycleV2 } from './privateConfirmedTradeValuationConstruction';

interface LifecycleRow extends Record<string, unknown> {
  plan_json?: unknown;
  result_json?: unknown;
  artifact_json: unknown;
  workbook_sha256?: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

export class PostgresAflTradePrivateConfirmedValuationLifecycleV2 implements AflTradePrivateConfirmedValuationLifecycleV2 {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadCurrentPlanForTrade(input: { valuationScopeKey: string; tradeId: string }) {
    const result = await this.client.query<LifecycleRow>(
      `SELECT plan.plan_json,plan.artifact_json
         FROM outcome_private_confirmed_valuation_plan_v2 plan
         JOIN outcome_private_reviewed_evaluation_head authority
           ON authority.valuation_scope_key=plan.valuation_scope_key
          AND authority.decision_id=plan.authority_decision_id
          AND authority.evidence_bundle_id=plan.evidence_bundle_id
         JOIN outcome_private_workbook_transaction_promotion promotion
           ON promotion.promotion_id=plan.transaction_promotion_id
          AND promotion.workbook_trade_id=plan.trade_id
        WHERE plan.valuation_scope_key=$1 AND plan.trade_id=$2
          AND authority.status='authorized'
          AND outcome_private_reviewed_evidence_bundle_is_current(
                authority.evidence_bundle_id
              )
          AND promotion.status='active'
        ORDER BY plan.planned_at DESC,plan.plan_id DESC
        LIMIT 1`,
      [input.valuationScopeKey, input.tradeId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new TypeError('Private valuation current plan selection is not unique.');
    }
    return {
      plan: aflTradePrivateConfirmedValuationPlanV2Schema.parse(result.rows[0]!.plan_json),
      artifact: aflTradeArtifactRefSchema.parse(result.rows[0]!.artifact_json),
    };
  }

  async savePlan(input: Parameters<AflTradePrivateConfirmedValuationLifecycleV2['savePlan']>[0]) {
    const plan = aflTradePrivateConfirmedValuationPlanV2Schema.parse(input.plan);
    const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-confirmed-valuation-plan:${plan.planId}`,
      ]);
      await transaction.query(
        `INSERT INTO outcome_private_confirmed_valuation_plan_v2
          (plan_id,valuation_scope_key,trade_id,transaction_promotion_id,
           authority_decision_id,evidence_bundle_id,
           planned_at,plan_content_sha256,artifact_sha256,plan_json,artifact_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
         ON CONFLICT (plan_id) DO NOTHING`,
        [
          plan.planId,
          plan.content.valuationScopeKey,
          plan.content.tradeId,
          plan.content.transactionPromotionId,
          plan.content.authority.decisionId,
          plan.content.authority.evidenceBundleId,
          plan.content.plannedAt,
          plan.planId.split(':')[1],
          artifact.contentSha256,
          plan,
          artifact,
        ]
      );
      const retained = await transaction.query<LifecycleRow>(
        `SELECT plan_json,artifact_json
           FROM outcome_private_confirmed_valuation_plan_v2
          WHERE plan_id=$1 FOR SHARE`,
        [plan.planId]
      );
      const row = retained.rows[0];
      if (
        retained.rows.length !== 1 ||
        !row ||
        !exact(row.plan_json, plan) ||
        !doAflTradeArtifactRefsExactlyMatch(
          aflTradeArtifactRefSchema.parse(row.artifact_json),
          artifact
        )
      ) {
        throw new TypeError('Private confirmed valuation plan lifecycle conflicts with exact replay.');
      }
    });
  }

  async loadPlan(planId: string) {
    const result = await this.client.query<LifecycleRow>(
      `SELECT plan_json,artifact_json
         FROM outcome_private_confirmed_valuation_plan_v2
        WHERE plan_id=$1`,
      [planId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw new TypeError('Private valuation plan identity is not unique.');
    return {
      plan: aflTradePrivateConfirmedValuationPlanV2Schema.parse(result.rows[0]!.plan_json),
      artifact: aflTradeArtifactRefSchema.parse(result.rows[0]!.artifact_json),
    };
  }

  async saveResult(
    input: Parameters<AflTradePrivateConfirmedValuationLifecycleV2['saveResult']>[0]
  ) {
    const result = aflTradePrivateConfirmedValuationResultV2Schema.parse(input.result);
    const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-confirmed-valuation-result:${result.content.valuationScopeKey}:${result.content.tradeId}`,
      ]);
      await transaction.query(
        `INSERT INTO outcome_private_confirmed_valuation_result_v2
          (result_id,plan_id,valuation_scope_key,trade_id,assembled_at,result_json,artifact_json)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
         ON CONFLICT (result_id) DO NOTHING`,
        [
          result.resultId,
          result.content.planId,
          result.content.valuationScopeKey,
          result.content.tradeId,
          result.content.assembledAt,
          result,
          artifact,
        ]
      );
      const retained = await transaction.query<LifecycleRow>(
        `SELECT result_json,artifact_json
           FROM outcome_private_confirmed_valuation_result_v2
          WHERE result_id=$1 FOR SHARE`,
        [result.resultId]
      );
      const row = retained.rows[0];
      if (
        retained.rows.length !== 1 ||
        !row ||
        !exact(row.result_json, result) ||
        !doAflTradeArtifactRefsExactlyMatch(
          aflTradeArtifactRefSchema.parse(row.artifact_json),
          artifact
        )
      ) {
        throw new TypeError('Private confirmed valuation result lifecycle conflicts with exact replay.');
      }
    });
  }

  async loadResult(resultId: string) {
    const result = await this.client.query<LifecycleRow>(
      `SELECT result_json,artifact_json
         FROM outcome_private_confirmed_valuation_result_v2
        WHERE result_id=$1`,
      [resultId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw new TypeError('Private valuation result identity is not unique.');
    return {
      result: aflTradePrivateConfirmedValuationResultV2Schema.parse(result.rows[0]!.result_json),
      artifact: aflTradeArtifactRefSchema.parse(result.rows[0]!.artifact_json),
    };
  }

  async loadResultForPlan(planId: string) {
    const result = await this.client.query<LifecycleRow>(
      `SELECT result_json,artifact_json
         FROM outcome_private_confirmed_valuation_result_v2
        WHERE plan_id=$1
        ORDER BY assembled_at ASC,result_id ASC
        LIMIT 1`,
      [planId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new TypeError('Private valuation plan result selection is not unique.');
    }
    return {
      result: aflTradePrivateConfirmedValuationResultV2Schema.parse(
        result.rows[0]!.result_json
      ),
      artifact: aflTradeArtifactRefSchema.parse(result.rows[0]!.artifact_json),
    };
  }

  async loadLatestResultForTrade(input: {
    valuationScopeKey: string;
    tradeId: string;
    workbookSha256: string;
  }) {
    if (!SHA256.test(input.workbookSha256)) {
      throw new TypeError('Private valuation result lookup requires an exact workbook digest.');
    }
    const result = await this.client.query<LifecycleRow>(
      `SELECT assembled.result_json,assembled.artifact_json,
              review_set.review_set_json->'content'->>'sourceArtifactSha256' AS workbook_sha256
         FROM outcome_private_confirmed_valuation_result_v2 assembled
         JOIN outcome_private_confirmed_valuation_plan_v2 plan
           ON plan.plan_id=assembled.plan_id
         JOIN outcome_private_reviewed_evaluation_head authority
           ON authority.valuation_scope_key=plan.valuation_scope_key
          AND authority.decision_id=plan.authority_decision_id
          AND authority.evidence_bundle_id=plan.evidence_bundle_id
         JOIN outcome_private_workbook_transaction_promotion promotion
           ON promotion.promotion_id=plan.transaction_promotion_id
          AND promotion.workbook_trade_id=plan.trade_id
         JOIN outcome_workbook_transaction_review_set review_set
           ON review_set.review_set_id=promotion.review_set_id
        WHERE assembled.valuation_scope_key=$1 AND assembled.trade_id=$2
          AND authority.status='authorized'
          AND outcome_private_reviewed_evidence_bundle_is_current(
                authority.evidence_bundle_id
              )
          AND promotion.status='active'
          AND review_set.review_set_json->'content'->>'sourceArtifactSha256'=$3
        ORDER BY assembled.assembled_at DESC,assembled.result_id DESC
        LIMIT 1`,
      [input.valuationScopeKey, input.tradeId, input.workbookSha256]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new TypeError('Private valuation result selection is not unique.');
    }
    const workbookSha256 = result.rows[0]!.workbook_sha256;
    if (workbookSha256 !== input.workbookSha256 || !SHA256.test(workbookSha256)) {
      throw new TypeError('Private valuation result workbook ancestry failed exact authentication.');
    }
    return {
      result: aflTradePrivateConfirmedValuationResultV2Schema.parse(
        result.rows[0]!.result_json
      ),
      artifact: aflTradeArtifactRefSchema.parse(result.rows[0]!.artifact_json),
      workbookSha256,
    };
  }
}
