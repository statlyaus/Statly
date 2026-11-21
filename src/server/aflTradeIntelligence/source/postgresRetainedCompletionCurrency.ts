import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

export type AflTradeRetainedTargetReason =
  | 'decision_superseded'
  | 'decision_revalidation_due'
  | 'raw_retention_expired'
  | 'terms_expired'
  | 'other';

export interface AflTradeRetainedCompletionCurrency {
  completionId: string;
  at: string;
  current: boolean;
  /** Only when not current: each retained target that is not current, and why. */
  staleTargets: {
    targetId: string;
    gateDecisionId: string | null;
    reasons: AflTradeRetainedTargetReason[];
  }[];
}

interface TargetRow extends Record<string, unknown> {
  target_id: string;
  gate_decision_id: string | null;
  decision_superseded: boolean | null;
  decision_revalidation_due: boolean | null;
  raw_retention_expired: boolean | null;
  terms_expired: boolean | null;
}

/**
 * Whether a retained completion is current at `at` (migration 0144's
 * `outcome_external_retained_completion_is_current`), and only when it is not, the 0161 conditions
 * each non-current target fails: a successor on its Gate decision, the decision's revalidation, the
 * raw-retention window, or the source terms. Read-only.
 */
export async function readAflTradeRetainedCompletionCurrency(
  client: AflOutcomeSqlClient,
  completionId: string,
  at: string
): Promise<AflTradeRetainedCompletionCurrency> {
  const current = await client.query<{ current: boolean }>(
    `SELECT outcome_external_retained_completion_is_current($1,$2::timestamptz) AS current`,
    [completionId, at]
  );
  if (current.rows[0]?.current === true) {
    return { completionId, at, current: true, staleTargets: [] };
  }
  const targets = await client.query<TargetRow>(
    `SELECT target.value->>'targetId' AS target_id,
            target.value#>>'{content,gateDecisionId}' AS gate_decision_id,
            EXISTS (SELECT 1 FROM outcome_gate_decision successor
                     WHERE successor.supersedes_decision_id=target.value#>>'{content,gateDecisionId}')
              AS decision_superseded,
            (SELECT decision.revalidate_at<=$2::timestamptz FROM outcome_gate_decision decision
              WHERE decision.decision_id=target.value#>>'{content,gateDecisionId}')
              AS decision_revalidation_due,
            capture.captured_at + make_interval(days=>(capture.manifest_json#>>
              '{executionReceipt,content,admission,rawRetentionDays}')::integer)<=$2::timestamptz
              AS raw_retention_expired,
            (capture.manifest_json#>>
              '{executionReceipt,content,sourceRights,content,termsExpireAt}')::timestamptz
              <=$2::timestamptz AS terms_expired
       FROM outcome_external_historical_capture_completion completion
       JOIN outcome_external_historical_capture_plan plan ON plan.plan_id=completion.plan_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(plan.plan_json#>'{content,targets}','[]'::jsonb))
         AS target(value)
       LEFT JOIN outcome_source_capture capture
         ON capture.capture_id=target.value#>>'{content,captureId}'
      WHERE completion.completion_id=$1
        AND NOT outcome_external_retained_target_is_current(
          target.value,plan.environment::text,plan.competition,$2::timestamptz)
      ORDER BY (target.value#>>'{content,ordinal}')::integer`,
    [completionId, at]
  );
  return {
    completionId,
    at,
    current: false,
    staleTargets: targets.rows.map((row) => {
      const reasons = (
        [
          'decision_superseded',
          'decision_revalidation_due',
          'raw_retention_expired',
          'terms_expired',
        ] as const
      ).filter((reason) => row[reason] === true);
      return {
        targetId: row.target_id,
        gateDecisionId: row.gate_decision_id,
        reasons: reasons.length > 0 ? [...reasons] : ['other'],
      };
    }),
  };
}
