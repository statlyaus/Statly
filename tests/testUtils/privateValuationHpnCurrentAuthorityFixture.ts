import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const hash = (marker: string) => marker.repeat(64);

/** Synthetic reviewed head only; callers explicitly isolate upstream seven-lane review. */
export async function seedPrivateValuationHpnCurrentAuthorityFixture(
  client: AflOutcomeSqlClient,
  input: { requestId: string; scopeKey: string; trigger: string; captureId: string }
) {
  const bundleId = `private-reviewed-evidence-bundle:${hash('c')}`;
  const decisionId = `private-reviewed-evidence-evaluation-decision:${hash('d')}`;
  const privateCandidateId = `private-factual-candidate:${hash('e')}`;
  const operationId = `current-valuation-factual-refresh-operation:${hash('f')}`;
  const scope = input.scopeKey;
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evidence_bundle
      (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,source_capture_count,
       source_rights_count,created_at,bundle_sha256,bundle_content_canonical_json,bundle_json)
      VALUES ($1,'afl-player-match-reviewed-2021-2026',1,1,1,1,now(),$2,'{}',$3::jsonb)`,
      [
        bundleId,
        hash('c'),
        JSON.stringify({ content: { sourceCaptures: [{ captureId: input.captureId }] } }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evaluation_decision
      (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,reviewer_id,decided_at,
       decision_sha256,decision_content_canonical_json,decision_json)
      VALUES ($1,$2,$3,'authorized',1,'synthetic-fixture',now(),$4,'{}','{}')`,
      [decisionId, scope, bundleId, hash('d')]
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evaluation_head
      (valuation_scope_key,evidence_scope_key,revision,decision_id,evidence_bundle_id,status,updated_at)
      VALUES ($1,'afl-player-match-reviewed-2021-2026',1,$2,$3,'authorized',now())`,
      [scope, decisionId, bundleId]
    );
    await transaction.query(
      `INSERT INTO outcome_private_factual_candidate
      (candidate_id,valuation_scope_key,evidence_scope_key,evidence_bundle_id,review_decision_id,
       normalized_reconciled_custody_sha256,candidate_json,composed_at)
      SELECT $1,$2,'afl-player-match-reviewed-2021-2026',$3,$4,
        encode(sha256(convert_to(outcome_afl_trade_canonical_json(custody),'UTF8')),'hex'),
        jsonb_build_object('content',jsonb_build_object('normalizedReconciledCustody',custody)),now()
      FROM (SELECT outcome_private_factual_custody_for_bundle($3) AS custody) source`,
      [privateCandidateId, scope, bundleId, decisionId]
    );
    await transaction.query(
      `INSERT INTO outcome_current_private_factual_authority
      (valuation_scope_key,candidate_id,revision,advanced_at) VALUES ($1,$2,1,now())`,
      [scope, privateCandidateId]
    );
    await transaction.query(
      `INSERT INTO outcome_current_valuation_factual_refresh_operation
      (operation_id,scope_key,trigger_kind,stable_operation_key,state,factual_stage,candidate_id,
       private_factual_revision,captured_at,completed_at,operation_json,result_json)
      VALUES ($1,$2,$3,$4,'factual_refresh_complete','advanced',$5,1,now(),now(),'{}','{}')`,
      [operationId, scope, input.trigger, input.requestId, privateCandidateId]
    );
    await transaction.query(
      `INSERT INTO outcome_current_valuation_evidence_orchestration_operation
      (operation_id,scope_key,trigger_kind,stable_operation_key,state,stage,downstream_operation_id,
       captured_at,completed_at,operation_json,result_json)
      VALUES ($1,$2,$3,$4,'complete','private_factual_authority',$5,now(),now(),'{}','{}')`,
      [
        `current-valuation-evidence-orchestration-operation:${hash('b')}`,
        scope,
        input.trigger,
        input.requestId,
        operationId,
      ]
    );
  });
  return { operationId, privateCandidateId };
}
