import { createHash } from 'node:crypto';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { aflTradePickDistributionModelProtocolSchema } from '../artifacts/modelProtocol';
import {
  aflTradeValuationDatasetAdmissionReceiptSchema,
  aflTradeValuationDatasetCandidateSchema,
} from '../artifacts/valuationDatasetAdmissionContracts';
import { DEFAULT_AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_CONFIG } from '../modeling/pickPavDistributionBenchmark';
import { aflTradeFinalizedHpnPavCalculationSchema } from '../modeling/hpnPavCalculationService';
import {
  findAflTradePickPavReplay,
  loadAflTradePickPavCalculations,
  loadAflTradePickPavPolicy,
  loadAflTradePickPavSelections,
  loadAflTradePickPavTrustedNow,
  persistAflTradePickPavObservationSet,
} from '../modeling/postgresPickPavObservationRepository';
import { materializeAflTradePickPavObservationSet } from '../modeling/pickPavObservationService';
import { PostgresGovernedPickPavModelExecutionRepository } from '../modeling/postgresGovernedPickPavModelExecutionRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  type GenuineDispatchBoundPickPavExecutionInput,
} from './genuineDispatchBoundPickPav';
import { parseAflTradePrivateValuationFactualOutput } from './privateValuationFactualOutput';
import { PostgresGovernedValuationComponentRunRepository } from './internal/postgresGovernedValuationComponentRunRepository';
import { createAflTradeGenuineDispatchBoundGovernedPickExecutor } from './postgresPrivateValuationModelPair';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

interface ExactAuthorityRow {
  readonly output_json: unknown;
  readonly calculation_json: unknown;
  readonly hpn_values_sha256: string;
}

interface ModelAuthorityRow {
  readonly dataset_json: unknown;
  readonly dataset_created_at: Date | string;
  readonly admission_json: unknown;
  readonly admitted_at: Date | string;
  readonly gate_ledger_revision: number;
  readonly protocol_json: unknown;
  readonly prepared_at: Date | string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function assertPostgresGenuineDispatchBoundPickPavClaim(input: {
  readonly client: AflOutcomeSqlClient;
  readonly execution: GenuineDispatchBoundPickPavExecutionInput;
}): Promise<void> {
  await input.client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
    await transaction.query(
      `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
      [
        input.execution.exactInput.requestId,
        input.execution.claim.claimId,
        sha256(input.execution.claim.leaseToken),
      ]
    );
  });
}

function instant(value: Date | string): string {
  return new Date(value).toISOString();
}

function requireMatchingReplay(input: {
  readonly replay: Awaited<ReturnType<typeof findAflTradePickPavReplay>>;
  readonly policy: Awaited<ReturnType<typeof loadAflTradePickPavPolicy>>;
  readonly selections: Awaited<ReturnType<typeof loadAflTradePickPavSelections>>;
  readonly hpnCalculationId: string;
}) {
  const replay = input.replay;
  if (replay === null) return null;
  const selections = new Map(
    input.selections.map((selection) => [
      selection.selectionId,
      canonicalizeAflTradeJson(selection),
    ])
  );
  if (
    canonicalizeAflTradeJson(replay.content.policy) !==
      canonicalizeAflTradeJson(input.policy) ||
    replay.content.observations.length !== selections.size ||
    !replay.content.calculations.some(
      ({ calculationId }) => calculationId === input.hpnCalculationId
    ) ||
    replay.content.observations.some(
      ({ selection }) =>
        selections.get(selection.selectionId) !== canonicalizeAflTradeJson(selection)
    )
  ) {
    throw new TypeError('Retained pick-PAV replay no longer matches exact private authority.');
  }
  return replay;
}

export class PostgresGenuineDispatchBoundPickPavMaterializer {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async materialize(execution: GenuineDispatchBoundPickPavExecutionInput) {
    return this.client.transaction(async (transaction) => {
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [
          execution.exactInput.requestId,
          execution.claim.claimId,
          sha256(execution.claim.leaseToken),
        ]
      );
      const authority = await transaction.query<ExactAuthorityRow>(
        `SELECT factual.output_json,calculation.calculation_json,
                outcome_private_valuation_hpn_substantive_sha256(
                  calculation.calculation_json
                ) AS hpn_values_sha256
           FROM outcome_private_valuation_model_request_binding binding
           JOIN outcome_private_valuation_model_operation operation
             ON operation.operation_id=binding.operation_id
           JOIN outcome_private_valuation_dispatch_attempt attempt
             ON attempt.request_id=binding.request_id
            AND attempt.claim_id=binding.claim_id
            AND attempt.attempt_number=binding.attempt_number
            AND attempt.finished_at IS NULL
           JOIN outcome_private_valuation_factual_output factual
             ON factual.output_id=binding.factual_output_id
            AND factual.request_id=binding.request_id
           JOIN outcome_hpn_pav_calculation calculation
             ON calculation.calculation_id=binding.hpn_calculation_id
            AND calculation.status='finalized'
          WHERE binding.request_id=$1 AND binding.operation_id=$2
            AND binding.factual_output_id=$3 AND binding.hpn_calculation_id=$4
            AND binding.claim_id=$5 AND binding.attempt_number=$6
            AND operation.pick_policy_id=$7 AND operation.pick_protocol_id=$8
            AND operation.pick_dataset_id=$9 AND operation.pick_dataset_admission_id=$10`,
        [
          execution.exactInput.requestId,
          execution.operation.operationId,
          execution.exactInput.factualOutputId,
          execution.exactInput.hpnCalculationId,
          execution.claim.claimId,
          execution.attemptNumber,
          execution.operation.content.pick.policyId,
          execution.operation.content.pick.protocolId,
          execution.operation.content.pick.datasetId,
          execution.operation.content.pick.datasetAdmissionId,
        ]
      );
      if (authority.rows.length !== 1) {
        throw new TypeError('Exact dispatch-bound pick-PAV authority is unavailable.');
      }
      const row = authority.rows[0]!;
      const factual = parseAflTradePrivateValuationFactualOutput(row.output_json);
      const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(row.calculation_json);
      if (
        factual.content.requestId !== execution.exactInput.requestId ||
        factual.outputId !== execution.exactInput.factualOutputId ||
        factual.content.valuationScopeKey !== execution.operation.content.scopeKey ||
        factual.content.candidate.memberSetSha256 !==
          execution.operation.content.factualValuesSha256 ||
        calculation.calculationId !== execution.exactInput.hpnCalculationId ||
        calculation.content.factualRunId !== factual.content.reconciliation.factualRunId ||
        calculation.content.methodId !== execution.operation.content.hpnMethodId ||
        row.hpn_values_sha256 !== execution.operation.content.hpnValuesSha256
      ) {
        throw new TypeError('Dispatch-bound pick-PAV factual or HPN ancestry is inconsistent.');
      }
      const policy = await loadAflTradePickPavPolicy(
        transaction,
        execution.operation.content.pick.policyId,
        'non_production'
      );
      const releaseId = factual.content.factualRelease.releaseId;
      const selections = await loadAflTradePickPavSelections(
        transaction,
        releaseId,
        'non_production',
        policy,
        'exact_retained_release'
      );
      const knowledgeCutoffAt = calculation.content.calculatedAt;
      const replay = requireMatchingReplay({
        replay: await findAflTradePickPavReplay(
          transaction,
          'non_production',
          releaseId,
          policy.policyId,
          knowledgeCutoffAt
        ),
        policy,
        selections,
        hpnCalculationId: calculation.calculationId,
      });
      if (replay !== null) return { observationSet: replay, factual };
      const calculations = await loadAflTradePickPavCalculations(
        transaction,
        policy,
        selections,
        knowledgeCutoffAt
      );
      if (
        !calculations.some(
          ({ calculation: member }) => member.calculationId === calculation.calculationId
        )
      ) {
        throw new TypeError('Exact governed HPN calculation is absent from pick-PAV materialization.');
      }
      const observationSet = materializeAflTradePickPavObservationSet({
        environment: 'non_production',
        competition: 'AFLM',
        createdAt: await loadAflTradePickPavTrustedNow(transaction),
        knowledgeCutoffAt,
        releaseId,
        policy,
        selections,
        calculations,
      });
      await persistAflTradePickPavObservationSet(transaction, observationSet);
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [
          execution.exactInput.requestId,
          execution.claim.claimId,
          sha256(execution.claim.leaseToken),
        ]
      );
      return { observationSet, factual };
    });
  }
}

export function createPostgresGenuineDispatchBoundPickPavAuthorityLoader(input: {
  readonly client: AflOutcomeSqlClient;
  readonly retainAuthorityArtifact: (value: {
    readonly document: unknown;
    readonly createdAt: string;
  }) => Promise<AflTradeArtifactRef>;
  readonly clock?: { readonly now: () => string };
}) {
  const materializer = new PostgresGenuineDispatchBoundPickPavMaterializer(input.client);
  const clock = input.clock ?? { now: () => new Date().toISOString() };
  return async (execution: GenuineDispatchBoundPickPavExecutionInput) => {
    const { observationSet, factual } = await materializer.materialize(execution);
    const target = execution.operation.content.pick;
    const result = await input.client.query<ModelAuthorityRow>(
      `SELECT dataset.dataset_json,dataset.created_at AS dataset_created_at,
              admission.admission_json,admission.admitted_at,
              admission.gate_ledger_revision,protocol.protocol_json,protocol.prepared_at
         FROM outcome_valuation_dataset_candidate dataset
         JOIN outcome_valuation_dataset_admission admission
           ON admission.dataset_id=dataset.dataset_id
          AND admission.admission_id=$2
          AND admission.status='finalized' AND admission.finalized_at IS NOT NULL
         JOIN outcome_valuation_model_protocol protocol
           ON protocol.dataset_id=dataset.dataset_id
          AND protocol.admission_id=admission.admission_id
          AND protocol.protocol_id=$3
        WHERE dataset.dataset_id=$1 AND dataset.environment='non_production'
          AND dataset.status='finalized' AND dataset.finalized_at IS NOT NULL`,
      [target.datasetId, target.datasetAdmissionId, target.protocolId]
    );
    if (result.rows.length !== 1) {
      throw new TypeError('Genuine pick-PAV dataset, admission, or protocol authority is absent.');
    }
    const row = result.rows[0]!;
    const dataset = aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json);
    const admission = aflTradeValuationDatasetAdmissionReceiptSchema.parse(row.admission_json);
    const protocol = aflTradePickDistributionModelProtocolSchema.parse(row.protocol_json);
    if (
      dataset.datasetId !== target.datasetId ||
      admission.admissionId !== target.datasetAdmissionId ||
      admission.content.datasetId !== target.datasetId ||
      dataset.content.factualParent.factualReleaseId !== factual.content.factualRelease.releaseId ||
      dataset.content.factualParent.factualCandidateId !== factual.content.candidate.candidateId ||
      dataset.content.factualParent.sourceMemberSetSha256 !==
        factual.content.candidate.memberSetSha256 ||
      admission.content.factualReleaseId !== factual.content.factualRelease.releaseId ||
      admission.content.factualCandidateId !== factual.content.candidate.candidateId ||
      admission.content.sourceMemberSetSha256 !== factual.content.candidate.memberSetSha256 ||
      protocol.protocolId !== target.protocolId ||
      protocol.content.datasetId !== target.datasetId
    ) {
      throw new TypeError('Genuine pick-PAV model authority ancestry is inconsistent.');
    }
    const [datasetArtifact, datasetAdmissionArtifact, protocolArtifact] = await Promise.all([
      input.retainAuthorityArtifact({
        document: dataset,
        createdAt: instant(row.dataset_created_at),
      }),
      input.retainAuthorityArtifact({
        document: admission,
        createdAt: instant(row.admitted_at),
      }),
      input.retainAuthorityArtifact({
        document: protocol,
        createdAt: instant(row.prepared_at),
      }),
    ]);
    const evaluatedAt = clock.now();
    return {
      observationSet,
      authority: {
        datasetId: target.datasetId,
        datasetArtifact,
        datasetAdmissionId: target.datasetAdmissionId,
        datasetAdmissionArtifact,
        datasetAdmissionGateLedgerRevision: row.gate_ledger_revision,
        protocolId: target.protocolId,
        protocolArtifact,
      },
      benchmarkConfig: DEFAULT_AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_CONFIG,
      validationConfig: {
        schemaVersion: 'afl-trade-pick-pav-validation-config/v1' as const,
        evaluatedAt,
        minimumEligibleObservations: 4,
        minimumPartitionObservations: 1,
        nominalIntervalCoverage: 0.8 as const,
      },
      completedAt: evaluatedAt,
      registeredAt: evaluatedAt,
    };
  };
}

export function createPostgresGenuineDispatchBoundPickPavExecutor(input: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly retainArtifact: (value: {
    readonly document: unknown;
    readonly createdAt: string;
  }) => Promise<AflTradeArtifactRef>;
  readonly clock?: { readonly now: () => string };
}) {
  const custody = {
    client: input.client,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  };
  return createAflTradeGenuineDispatchBoundGovernedPickExecutor({
    loadExactAuthority: createPostgresGenuineDispatchBoundPickPavAuthorityLoader({
      client: input.client,
      retainAuthorityArtifact: input.retainArtifact,
      ...(input.clock === undefined ? {} : { clock: input.clock }),
    }),
    assertClaim: (execution) =>
      assertPostgresGenuineDispatchBoundPickPavClaim({ client: input.client, execution }),
    retainArtifact: input.retainArtifact,
    executionRepository: new PostgresGovernedPickPavModelExecutionRepository(custody),
    componentRepository: new PostgresGovernedValuationComponentRunRepository(custody),
  });
}
