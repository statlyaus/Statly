import { createHash } from 'node:crypto';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';
import { createAflTradeDispatchBoundQualificationRegistrar } from '../valuation/postgresPrivateValuationModelPair';
import { aflTradePrivateValuationModelOperationSchema } from '../valuation/privateValuationModelPair';
import { PostgresGovernedValuationComponentRunRepository } from '../valuation/internal/postgresGovernedValuationComponentRunRepository';
import { PostgresGovernedValuationModelQualificationRepository } from '../valuation/internal/postgresGovernedValuationModelQualificationRepository';
import { loadGovernedNativeComponentValidationReport } from '../valuation/internal/governedNativeComponentExecution';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '../valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import {
  createGovernedValuationModelQualificationGateRecords,
  deriveGovernedPlayerModelQualificationEvidence,
  deriveGovernedPickModelQualificationEvidence,
  governedValuationModelQualificationPolicySchema,
} from '../valuation/internal/governedValuationModelQualification';

function instant(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime()))
    throw new TypeError('Qualification trusted time is unavailable.');
  return parsed.toISOString();
}

export function createLocalAflTradePrivateValuationQualificationRegistrar(input: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly policyArtifactId: string;
}) {
  aflTradeContentAddressedIdSchema('artifact').parse(input.policyArtifactId);
  const components = new PostgresGovernedValuationComponentRunRepository(input);
  const repository = new PostgresGovernedValuationModelQualificationRepository(input);
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository(input);
  const ledgerRepository = createPostgresAflTradeGateDecisionLedgerRepository(input.client);

  async function loadReference(artifactId: string) {
    const result = await input.client.query<{ reference: unknown }>(
      `SELECT jsonb_build_object('artifactId',artifact_id,'contentSha256',content_sha256,
        'storageUri',storage_uri,'mediaType',media_type,'byteLength',byte_length,
        'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS reference
       FROM outcome_artifact_custody WHERE artifact_id=$1 AND artifact_class='derived_private'`,
      [artifactId]
    );
    if (result.rows.length > 1) throw new TypeError('Qualification artifact custody is ambiguous.');
    return result.rows[0] ? aflTradeArtifactRefSchema.parse(result.rows[0].reference) : null;
  }

  async function retainArtifact({ document, createdAt }: { document: unknown; createdAt: string }) {
    const proposed = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
    const reference = (await loadReference(proposed.artifactId)) ?? proposed;
    if (Date.parse(reference.createdAt) > Date.parse(createdAt)) {
      throw new TypeError('Qualification cannot use future artifact custody.');
    }
    return staging.retainArtifact({
      reference,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
    });
  }

  return createAflTradeDispatchBoundQualificationRegistrar({
    repository,
    retainArtifact,
    async prepareQualification(execution) {
      const operation = aflTradePrivateValuationModelOperationSchema.parse(execution.operation);
      const accepted = await input.client.transaction(async (transaction) => {
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query(
          'SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)',
          [
            execution.exactInput.requestId,
            execution.claim.claimId,
            createHash('sha256').update(execution.claim.leaseToken).digest('hex'),
          ]
        );
        return transaction.query<{ accepted_at: unknown; operation_json: unknown }>(
          `SELECT operation.pair_accepted_at AS accepted_at, operation.operation_json
           FROM outcome_private_valuation_model_request_binding binding
           JOIN outcome_private_valuation_model_operation operation USING(operation_id)
           WHERE binding.request_id=$1 AND binding.claim_id=$2 AND operation.operation_id=$3
             AND operation.player_run_id=$4 AND operation.pick_run_id=$5
             AND operation.pair_accepted_at IS NOT NULL`,
          [
            execution.exactInput.requestId,
            execution.claim.claimId,
            operation.operationId,
            execution.playerRunId,
            execution.pickRunId,
          ]
        );
      });
      if (
        accepted.rows.length !== 1 ||
        canonicalizeAflTradeJson(accepted.rows[0]?.operation_json) !==
          canonicalizeAflTradeJson(operation)
      ) {
        throw new TypeError('Qualification requires the exact accepted dispatch-bound pair.');
      }
      // The immutable accepted-pair instant keeps retry identity stable and is after both native reports.
      const evaluatedAt = instant(accepted.rows[0]!.accepted_at);
      const policyArtifact = await loadReference(input.policyArtifactId);
      if (policyArtifact === null)
        throw new TypeError('Selected qualification policy artifact is unavailable.');
      const loaded = await input.artifactRepository.loadExact(
        policyArtifact,
        input.maximumArtifactBytes
      );
      if (
        loaded === null ||
        !doAflTradeArtifactRefsExactlyMatch(loaded.reference, policyArtifact) ||
        !doesAflTradeArtifactRefMatchBytes(policyArtifact, loaded.bytes)
      ) {
        throw new TypeError('Selected qualification policy failed immutable readback.');
      }
      const policy = governedValuationModelQualificationPolicySchema.parse(
        JSON.parse(new TextDecoder().decode(loaded.bytes))
      );
      if (
        policy.policyVersion !== operation.content.qualificationPolicyId ||
        Date.parse(policyArtifact.createdAt) > Date.parse(evaluatedAt)
      ) {
        throw new TypeError(
          'Selected qualification policy does not match accepted operation authority.'
        );
      }
      const [player, pick] = await Promise.all([
        components.loadExact(execution.playerRunId),
        components.loadExact(execution.pickRunId),
      ]);
      for (const [run, target] of [
        [player, operation.content.player],
        [pick, operation.content.pick],
      ] as const) {
        const content = run.manifest.content;
        if (
          content.protocolId !== target.protocolId ||
          content.datasetId !== target.datasetId ||
          content.datasetAdmissionId !== target.datasetAdmissionId ||
          Date.parse(content.registeredAt) > Date.parse(evaluatedAt)
        ) {
          throw new TypeError('Qualification component ancestry differs from the accepted target.');
        }
      }
      const [playerNative, pickNative] = await Promise.all(
        [player, pick].map((run) =>
          loadGovernedNativeComponentValidationReport({
            manifest: run.manifest,
            artifactRepository: input.artifactRepository,
            maximumArtifactBytes: input.maximumArtifactBytes,
          })
        )
      );
      if (playerNative?.kind === 'player_pav_final_evidence') {
        throw new TypeError(
          'Native player-PAV evidence is authenticated but unevaluated; qualification requires a reviewed native-PAV policy.'
        );
      }
      if (
        playerNative?.kind !== 'player_contribution_and_availability' ||
        pickNative?.kind !== 'draft_pick_and_future_pick_distribution'
      ) {
        throw new TypeError('Qualification requires one native player and one native pick report.');
      }
      if (
        playerNative.execution.content.modelId !== operation.content.player.modelId ||
        playerNative.execution.content.modelVersion !== operation.content.player.modelVersion ||
        pickNative.execution.content.policyId !== operation.content.pick.policyId
      ) {
        throw new TypeError(
          'Qualification native model identities differ from the accepted target.'
        );
      }
      const playerEvidence = deriveGovernedPlayerModelQualificationEvidence(
        playerNative.validationReport
      );
      const pickEvidence = deriveGovernedPickModelQualificationEvidence(
        pickNative.validationReport
      );
      return {
        environment: 'non_production',
        scopeKey: operation.content.scopeKey,
        evaluatedAt,
        policy,
        policyArtifact,
        components: {
          player: {
            role: 'player_contribution_and_availability',
            runId: player.manifest.runId,
            runArtifact: player.artifact,
            protocolId: player.manifest.content.protocolId,
            protocolArtifact: player.manifest.content.protocolArtifact,
            criteriaArtifact: await retainArtifact({
              document: policy.player,
              createdAt: evaluatedAt,
            }),
            validationEvidence: playerEvidence,
            validationEvidenceArtifact: await retainArtifact({
              document: playerEvidence,
              createdAt: evaluatedAt,
            }),
          },
          pick: {
            role: 'draft_pick_and_future_pick_distribution',
            runId: pick.manifest.runId,
            runArtifact: pick.artifact,
            protocolId: pick.manifest.content.protocolId,
            protocolArtifact: pick.manifest.content.protocolArtifact,
            criteriaArtifact: await retainArtifact({
              document: policy.pick,
              createdAt: evaluatedAt,
            }),
            validationEvidence: pickEvidence,
            validationEvidenceArtifact: await retainArtifact({
              document: pickEvidence,
              createdAt: evaluatedAt,
            }),
          },
        },
      };
    },
    async prepareRegistration({ qualification, qualificationArtifact }) {
      const [stored, current] = await Promise.all([
        ledgerRepository.load(),
        repository.loadCurrent(qualification.content.scopeKey),
      ]);
      const expected = {
        expectedGateLedgerRevision: stored.revision,
        expectedCurrentRevision: current?.revision ?? 0,
      };
      if (qualification.content.outcome === 'failed') return expected;
      const heads = (['player', 'pick'] as const).map(
        (role) =>
          stored.ledger.decisions
            .filter(
              ({ content }) =>
                content.gate === 'gate_3_model_validity' &&
                content.environment === 'non_production' &&
                content.decisionKey === `${qualification.content.scopeKey}:${role}-model-validity`
            )
            .sort((left, right) => right.content.version - left.content.version)[0]
      );
      const time = await input.client.query<{ now: unknown }>(
        `SELECT date_trunc('milliseconds',clock_timestamp()) AS now`
      );
      if (time.rows.length !== 1)
        throw new TypeError('Qualification decision time is unavailable.');
      // Mechanical private validation only: no human review, new source rights or model-spend permission.
      const gateRecords = createGovernedValuationModelQualificationGateRecords({
        qualification,
        qualificationArtifact,
        decidedAt: instant(time.rows[0]!.now),
        automationPrincipal: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
        accountableOwner: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
        versions: {
          player: (heads[0]?.content.version ?? 0) + 1,
          pick: (heads[1]?.content.version ?? 0) + 1,
        },
        supersedes: { player: heads[0]?.decisionId ?? null, pick: heads[1]?.decisionId ?? null },
      });
      return { ...expected, gateRecords };
    },
  });
}
