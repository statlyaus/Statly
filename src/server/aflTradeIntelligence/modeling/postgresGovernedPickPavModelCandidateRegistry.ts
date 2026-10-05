import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeGovernedPickPavModelCandidateSchema,
  type AflTradeGovernedPickPavModelCandidate,
} from './governedPickPavModelCandidate';
import {
  aflTradePickPavModelRunAuthorizationSchema,
  aflTradePickPavModelRunIntentSchema,
  aflTradePickPavObservationAdmissionSchema,
  type AflTradePickPavModelRunAuthorization,
  type AflTradePickPavModelRunIntent,
  type AflTradePickPavObservationAdmission,
} from './pickPavModelCandidateAuthority';
import {
  aflTradePickPavModelRunConsumptionSchema,
  type AflTradePickPavModelRunConsumption,
} from './pickPavModelRunConsumption';

export interface AflTradeGovernedPickPavCandidateChain {
  admission: AflTradePickPavObservationAdmission;
  intent: AflTradePickPavModelRunIntent;
  authorization: AflTradePickPavModelRunAuthorization;
  candidate: AflTradeGovernedPickPavModelCandidate;
  consumption: AflTradePickPavModelRunConsumption;
}

interface StoredChainRow {
  admission_json: unknown;
  intent_json: unknown;
  authorization_json: unknown;
  candidate_json: unknown;
  consumption_json: unknown;
  consumption_id: string;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function authenticateChain(input: AflTradeGovernedPickPavCandidateChain) {
  const chain: AflTradeGovernedPickPavCandidateChain = {
    admission: aflTradePickPavObservationAdmissionSchema.parse(
      structuredClone(input.admission)
    ),
    intent: aflTradePickPavModelRunIntentSchema.parse(structuredClone(input.intent)),
    authorization: aflTradePickPavModelRunAuthorizationSchema.parse(
      structuredClone(input.authorization)
    ),
    candidate: aflTradeGovernedPickPavModelCandidateSchema.parse(
      structuredClone(input.candidate)
    ),
    consumption: aflTradePickPavModelRunConsumptionSchema.parse(
      structuredClone(input.consumption)
    ),
  };
  const { admission, intent, authorization, candidate, consumption } = chain;
  const candidateContent = candidate.content;
  if (
    intent.content.observationAdmissionId !== admission.observationAdmissionId ||
    intent.content.observationSetId !== admission.content.observationSetId ||
    authorization.content.runIntentId !== intent.runIntentId ||
    authorization.content.observationAdmissionId !== admission.observationAdmissionId ||
    authorization.content.observationSetId !== admission.content.observationSetId ||
    candidateContent.observationAdmissionId !== admission.observationAdmissionId ||
    candidateContent.runIntentId !== intent.runIntentId ||
    candidateContent.runAuthorizationId !== authorization.runAuthorizationId ||
    candidateContent.observationSetId !== admission.content.observationSetId ||
    candidateContent.observationSetSha256 !== admission.content.observationSetSha256 ||
    candidateContent.releaseId !== admission.content.releaseId ||
    candidateContent.policyId !== admission.content.policyId ||
    candidateContent.sourceQualificationReportId !==
      admission.content.sourceQualificationReportId ||
    candidateContent.modelId !== intent.content.modelId ||
    candidateContent.modelVersion !== intent.content.modelVersion ||
    candidateContent.codeCommitSha !== intent.content.codeCommitSha ||
    candidateContent.seed !== intent.content.seed ||
    candidateContent.runAuthorizedAt !== authorization.content.authorizedAt ||
    candidateContent.runAuthorizationValidThrough !==
      authorization.content.validThrough ||
    candidateContent.operationalPrincipalAuthorityId !==
      authorization.content.operationalPrincipalAuthorityId ||
    candidateContent.gateLedgerRevision !== authorization.content.gateLedgerRevision ||
    !exact(
      candidateContent.modelTrainingEvaluationReceiptIds,
      authorization.content.modelTrainingEvaluationReceiptIds
    ) ||
    consumption.content.runAuthorizationId !== authorization.runAuthorizationId ||
    consumption.content.candidateId !== candidate.candidateId
  ) {
    throw new TypeError('Governed pick candidate chain has mixed or incomplete ancestry.');
  }
  const consumedAt = Date.parse(consumption.content.consumedAt);
  if (
    consumedAt < Date.parse(candidateContent.completedAt) ||
    consumedAt < Date.parse(authorization.content.authorizedAt) ||
    consumedAt > Date.parse(authorization.content.validThrough)
  ) {
    throw new TypeError('Governed pick candidate consumption is outside its authority window.');
  }
  return chain;
}

async function requireObservationSet(
  transaction: AflOutcomeSqlTransaction,
  chain: AflTradeGovernedPickPavCandidateChain
): Promise<void> {
  const { admission, candidate } = chain;
  const result = await transaction.query(
    `SELECT observation_set_id FROM outcome_pick_pav_observation_set
      WHERE observation_set_id=$1 AND observation_set_sha256=$2
        AND environment='non_production' AND release_id=$3 AND policy_id=$4
        AND status='finalized' AND finalized_at IS NOT NULL
        AND observation_set_json=$5::jsonb
      FOR KEY SHARE`,
    [
      admission.content.observationSetId,
      admission.content.observationSetSha256,
      admission.content.releaseId,
      admission.content.policyId,
      canonicalizeAflTradeJson(candidate.content.observationSet),
    ]
  );
  if (result.rows.length !== 1) {
    throw new Error('The exact finalized pick-PAV observation set is unavailable.');
  }
}

async function insertParents(
  transaction: AflOutcomeSqlTransaction,
  chain: AflTradeGovernedPickPavCandidateChain
): Promise<void> {
  const { admission, intent, authorization } = chain;
  await transaction.query(
    `INSERT INTO outcome_pick_pav_observation_admission
      (observation_admission_id,observation_set_id,observation_set_sha256,release_id,
       policy_id,source_qualification_report_id,gate2_decision_id,admitted_at,
       admission_content_canonical_json,admission_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT DO NOTHING`,
    [
      admission.observationAdmissionId,
      admission.content.observationSetId,
      admission.content.observationSetSha256,
      admission.content.releaseId,
      admission.content.policyId,
      admission.content.sourceQualificationReportId,
      admission.content.gate2DecisionId,
      admission.content.admittedAt,
      canonicalizeAflTradeJson(admission.content),
      canonicalizeAflTradeJson(admission),
    ]
  );
  await transaction.query(
    `INSERT INTO outcome_pick_pav_model_run_intent
      (run_intent_id,observation_admission_id,observation_set_id,model_id,model_version,
       started_at,intent_content_canonical_json,intent_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING`,
    [
      intent.runIntentId,
      intent.content.observationAdmissionId,
      intent.content.observationSetId,
      intent.content.modelId,
      intent.content.modelVersion,
      intent.content.startedAt,
      canonicalizeAflTradeJson(intent.content),
      canonicalizeAflTradeJson(intent),
    ]
  );
  await transaction.query(
    `INSERT INTO outcome_pick_pav_model_run_authorization
      (run_authorization_id,run_intent_id,observation_admission_id,observation_set_id,
       operational_principal_authority_id,gate_ledger_revision,authorized_at,valid_through,
       authorization_content_canonical_json,authorization_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT DO NOTHING`,
    [
      authorization.runAuthorizationId,
      authorization.content.runIntentId,
      authorization.content.observationAdmissionId,
      authorization.content.observationSetId,
      authorization.content.operationalPrincipalAuthorityId,
      authorization.content.gateLedgerRevision,
      authorization.content.authorizedAt,
      authorization.content.validThrough,
      canonicalizeAflTradeJson(authorization.content),
      canonicalizeAflTradeJson(authorization),
    ]
  );
  const parents = await transaction.query<{
    admission_json: unknown;
    intent_json: unknown;
    authorization_json: unknown;
  }>(
    `SELECT a.admission_json,i.intent_json,r.authorization_json
       FROM outcome_pick_pav_observation_admission a
       JOIN outcome_pick_pav_model_run_intent i
         ON i.observation_admission_id=a.observation_admission_id
       JOIN outcome_pick_pav_model_run_authorization r
         ON r.run_intent_id=i.run_intent_id
      WHERE a.observation_admission_id=$1 AND i.run_intent_id=$2
        AND r.run_authorization_id=$3 FOR UPDATE`,
    [admission.observationAdmissionId, intent.runIntentId, authorization.runAuthorizationId]
  );
  const row = parents.rows[0];
  if (
    parents.rows.length !== 1 ||
    !row ||
    !exact(row.admission_json, admission) ||
    !exact(row.intent_json, intent) ||
    !exact(row.authorization_json, authorization)
  ) {
    throw new Error('Conflicting governed pick candidate authority parent exists.');
  }
}

async function loadChain(
  transaction: AflOutcomeSqlTransaction,
  authorizationId: string
): Promise<StoredChainRow | null> {
  const result = await transaction.query<StoredChainRow>(
    `SELECT a.admission_json,i.intent_json,r.authorization_json,
            c.candidate_json,x.consumption_json,c.consumption_id
       FROM outcome_governed_pick_pav_model_candidate c
       JOIN outcome_pick_pav_model_run_consumption x
         ON x.consumption_id=c.consumption_id
       JOIN outcome_pick_pav_model_run_authorization r
         ON r.run_authorization_id=c.run_authorization_id
       JOIN outcome_pick_pav_model_run_intent i ON i.run_intent_id=c.run_intent_id
       JOIN outcome_pick_pav_observation_admission a
         ON a.observation_admission_id=c.observation_admission_id
      WHERE c.run_authorization_id=$1 FOR UPDATE`,
    [authorizationId]
  );
  if (result.rows.length > 1) throw new Error('Duplicate governed pick candidate chain.');
  return result.rows[0] ?? null;
}

async function loadChainByCandidateId(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string
): Promise<StoredChainRow | null> {
  const result = await transaction.query<StoredChainRow>(
    `SELECT a.admission_json,i.intent_json,r.authorization_json,
            c.candidate_json,x.consumption_json,c.consumption_id
       FROM outcome_governed_pick_pav_model_candidate c
       JOIN outcome_pick_pav_model_run_consumption x
         ON x.consumption_id=c.consumption_id
        AND x.candidate_id=c.candidate_id
        AND x.run_authorization_id=c.run_authorization_id
       JOIN outcome_pick_pav_model_run_authorization r
         ON r.run_authorization_id=c.run_authorization_id
       JOIN outcome_pick_pav_model_run_intent i
         ON i.run_intent_id=c.run_intent_id
        AND i.observation_admission_id=c.observation_admission_id
       JOIN outcome_pick_pav_observation_admission a
         ON a.observation_admission_id=c.observation_admission_id
        AND a.observation_set_id=c.observation_set_id
      WHERE c.candidate_id=$1
      FOR KEY SHARE OF a,i,r,c,x`,
    [candidateId]
  );
  if (result.rows.length > 1) throw new Error('Duplicate governed pick candidate chain.');
  return result.rows[0] ?? null;
}

function parseStoredChain(row: StoredChainRow): AflTradeGovernedPickPavCandidateChain {
  return authenticateChain({
    admission: aflTradePickPavObservationAdmissionSchema.parse(row.admission_json),
    intent: aflTradePickPavModelRunIntentSchema.parse(row.intent_json),
    authorization: aflTradePickPavModelRunAuthorizationSchema.parse(row.authorization_json),
    candidate: aflTradeGovernedPickPavModelCandidateSchema.parse(row.candidate_json),
    consumption: aflTradePickPavModelRunConsumptionSchema.parse(row.consumption_json),
  });
}

export async function loadAuthenticatedAflTradeGovernedPickPavCandidateChain(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string
): Promise<AflTradeGovernedPickPavCandidateChain | null> {
  const stored = await loadChainByCandidateId(transaction, candidateId);
  if (stored === null) return null;
  const chain = parseStoredChain(stored);
  if (
    chain.candidate.candidateId !== candidateId ||
    stored.consumption_id !== chain.consumption.consumptionId
  ) {
    throw new Error('Governed pick candidate identity failed exact readback.');
  }
  return chain;
}

export class PostgresAflTradeGovernedPickPavModelCandidateRegistry {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistCandidateChain(raw: AflTradeGovernedPickPavCandidateChain): Promise<{
    chain: AflTradeGovernedPickPavCandidateChain;
    idempotentReplay: boolean;
  }> {
    const chain = authenticateChain(raw);
    return this.client.transaction(
      async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `governed-pick-candidate:${chain.authorization.runAuthorizationId}`,
        ]);
        await requireObservationSet(transaction, chain);
        await insertParents(transaction, chain);
        const existing = await loadChain(transaction, chain.authorization.runAuthorizationId);
        if (existing) {
          const stored = parseStoredChain(existing);
          if (!exact(stored, chain) || existing.consumption_id !== chain.consumption.consumptionId) {
            throw new Error('Conflicting exactly-once governed pick candidate replay.');
          }
          return { chain: stored, idempotentReplay: true };
        }
        const { candidate, consumption } = chain;
        await transaction.query(
          `INSERT INTO outcome_governed_pick_pav_model_candidate
            (candidate_id,observation_set_id,observation_admission_id,run_intent_id,
             run_authorization_id,consumption_id,model_id,model_version,started_at,
             candidate_locked_at,final_test_evaluated_at,completed_at,
             candidate_content_canonical_json,candidate_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            candidate.candidateId,
            candidate.content.observationSetId,
            candidate.content.observationAdmissionId,
            candidate.content.runIntentId,
            candidate.content.runAuthorizationId,
            consumption.consumptionId,
            candidate.content.modelId,
            candidate.content.modelVersion,
            candidate.content.startedAt,
            candidate.content.candidateLockedAt,
            candidate.content.finalTestEvaluatedAt,
            candidate.content.completedAt,
            canonicalizeAflTradeJson(candidate.content),
            canonicalizeAflTradeJson(candidate),
          ]
        );
        await transaction.query(
          `INSERT INTO outcome_pick_pav_model_run_consumption
            (consumption_id,run_authorization_id,candidate_id,consumed_at,
             consumption_content_canonical_json,consumption_json)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            consumption.consumptionId,
            consumption.content.runAuthorizationId,
            consumption.content.candidateId,
            consumption.content.consumedAt,
            canonicalizeAflTradeJson(consumption.content),
            canonicalizeAflTradeJson(consumption),
          ]
        );
        const stored = await loadChain(transaction, chain.authorization.runAuthorizationId);
        if (!stored) throw new Error('Governed pick candidate exact readback failed.');
        const readback = parseStoredChain(stored);
        if (!exact(readback, chain)) throw new Error('Governed pick candidate readback drifted.');
        return { chain: readback, idempotentReplay: false };
      },
      { isolationLevel: 'serializable', accessMode: 'read_write' }
    );
  }
}
