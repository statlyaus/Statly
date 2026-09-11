import {
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradePlayerPavModelProtocol } from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { AflTradeValuationDatasetAdmissionService } from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import {
  aflTradeModelRunAuthorizationSchema,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
  type AflTradeNativePavModelRunEvidence,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradePlayerObservationSetV3 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '@/server/aflTradeIntelligence/valuation/automatedPrivateEvaluationPolicy';
import { admittedPavModelRunFixture } from './admittedPavModelRunFixture';
import { currentAdmittedPavSourceFixture } from './currentAdmittedPavSourceFixture';

/** Synthetic database responses, not SQL/genuine dispatch authority or qualification proof. */
export async function nativePavModelRunSqlFixture(
  readback: 'exact_readback' | 'missing_readback' = 'exact_readback',
  metricDefinitionOverride?: unknown
) {
  const current = await currentAdmittedPavSourceFixture();
  const template = await admittedPavModelRunFixture();
  const { graph } = current;
  const originalGate2 = graph.evidence.gate2Ledger;
  const scope = {
    ...originalGate2.proposals[0]!.content.scope,
    scopeKey: graph.dataset.content.scopeKey,
    dimensions: [
      { name: 'competition', values: ['AFLM'] },
      { name: 'scope', values: [graph.dataset.content.scopeKey] },
    ],
  };
  const proposalContent = { ...originalGate2.proposals[0]!.content, scope };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    ...originalGate2.decisions[0]!.content,
    scope,
    proposalId: proposal.proposalId,
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  const gate2Ledger = { proposals: [proposal], decisions: [decision] };
  const admitted = await new AflTradeValuationDatasetAdmissionService({
    authenticate: async () => ({ ...graph.evidence, gate2Ledger }),
  }).admit({ dataset: graph.dataset, admittedAt: graph.evidence.authenticatedAt });
  if (admitted.status !== 'admitted') throw new Error(JSON.stringify(admitted));
  const admission = admitted.receipt;
  const startedAt = template.startedAt;
  const calibrationConfiguration = {
    schemaVersion: 'afl-trade-native-pav-pre-final-config/v1',
    method: 'empirical_calibration_residual_paths',
    minimumCalibrationObservations: 2,
    intervalCoverage: 0.8,
  };
  const calibrationConfigurationBytes = new TextEncoder().encode(
    canonicalizeAflTradeJson(calibrationConfiguration)
  );
  // Explicit synthetic numerical declarations, not scientific review or production defaults.
  const validationDefinitions = [
    {
      schemaVersion: 'afl-trade-native-pav-baseline-definition/v1',
      definitionKey: 'synthetic-persistence',
      candidate: { kind: 'persistence', historySeasons: 1 },
      fitPartition: 'train',
      evaluatedPartitions: ['validation', 'final_test'],
    },
    {
      schemaVersion: 'afl-trade-native-pav-sensitivity-definition/v1',
      definitionKey: 'synthetic-ridge',
      candidate: { kind: 'ridge', historySeasons: 1, penalty: 2 },
      fitPartition: 'train',
      evaluatedPartition: 'validation',
      purpose: 'sensitivity_not_candidate_selection',
    },
  ].map((document) => ({
    reference: createAflTradeCanonicalJsonArtifactRef(document, startedAt),
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
  }));
  const metricDefinition = metricDefinitionOverride ?? {
    schemaVersion: 'afl-trade-native-pav-metric-definition/v1',
    definitionKey: 'synthetic-explicit-native-h3-metrics',
    target: {
      fixedHorizonSeasons: 3,
      annualValueUnit: 'season_pav',
      aggregation: 'sum',
      valueUnit: 'fixed_horizon_pav',
    },
    evaluationPartitions: ['validation', 'final_test'],
    scopes: ['annual_1', 'annual_2', 'annual_3', 'cumulative_3'],
    metrics: ['bias', 'mae', 'rmse', 'crps', 'intervalCoverage', 'intervalWidth', 'intervalScore'],
    pointError: 'prediction_minus_observed',
    distribution: 'empirical_calibration_paths',
    pointSupport: 'available_forecasts_with_complete_observed_horizon',
    distributionSupport: 'point_support_with_available_calibration_paths',
  };
  const metricDefinitionArtifact = createAflTradeCanonicalJsonArtifactRef(
    metricDefinition,
    startedAt
  );
  const protocol = createAflTradePlayerPavModelProtocol({
    ...template.protocol.content,
    environment: 'non_production',
    datasetId: graph.dataset.datasetId,
    datasetAdmission: {
      schemaVersion: 'afl-trade-dataset-admission/v3',
      admissionId: admission.admissionId,
      admittedAt: admission.content.admittedAt,
    },
    sourceObservationSet: {
      observationSetId: graph.pav.pavObservationSet.observationSetId,
      artifact: graph.dataset.content.pavObservationSet!.artifact,
    },
    pavPolicy: {
      policyId: graph.pav.policy.policyId,
      artifact: createAflTradeCanonicalJsonArtifactRef(
        graph.pav.policy,
        template.protocol.content.preparedAt
      ),
    },
    hpnMethod: {
      methodId: graph.pav.method.methodId,
      artifact: createAflTradeCanonicalJsonArtifactRef(
        graph.pav.method,
        template.protocol.content.preparedAt
      ),
    },
    featureDefinitionArtifact: graph.dataset.content.specification.content.featureDefinitions[0]!,
    validationPlan: {
      ...template.protocol.content.validationPlan,
      metricDefinitionArtifacts: [metricDefinitionArtifact],
      baselineDefinitionArtifacts: [validationDefinitions[0]!.reference],
      sensitivityAnalysisArtifacts: [validationDefinitions[1]!.reference],
      intervalCalibrationArtifact: createAflTradeCanonicalJsonArtifactRef(
        calibrationConfiguration,
        startedAt
      ),
    },
  });
  const observationSet = createAflTradePlayerObservationSetV3({
    candidate: graph.dataset,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    pavObservationSet: graph.pav.pavObservationSet,
  });
  const runStartEvaluationReceipts = graph.evidence.sourceRights.map((source) =>
    createAflTradeGate0AReceipt(
      source.gateLedger,
      source.rightsProposal,
      { ...source.admissionReceipt.content.request, evaluatedAt: startedAt },
      startedAt
    )
  );
  const operationId = createAflTradeContentAddress('private-valuation-model-operation', {
    fixture: 'synthetic adapter operation',
    requestId: graph.pav.requestId,
    datasetId: graph.dataset.datasetId,
  });
  const configuration = {
    schemaVersion: 'afl-trade-admitted-player-pav-fit-config/v1',
    candidate: { kind: 'ridge', historySeasons: 1, penalty: 1 },
  };
  const configurationBytes = new TextEncoder().encode(canonicalizeAflTradeJson(configuration));
  const intent = createAflTradeModelRunIntent({
    ...template.intent.content,
    environment: 'non_production',
    datasetId: graph.dataset.datasetId,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    configurationArtifact: createAflTradeCanonicalJsonArtifactRef(configuration, startedAt),
    job: {
      jobId: operationId,
      attempt: 1,
      initiatedBy: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
      workerIdentity: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
    },
    featureDefinitionArtifacts: graph.dataset.content.specification.content.featureDefinitions,
    modelTrainingEvaluationReceiptIds: runStartEvaluationReceipts
      .map(({ receiptId }) => receiptId)
      .sort(),
  });
  const syntheticId = (prefix: string) =>
    createAflTradeContentAddress(prefix, {
      fixture: 'synthetic adapter dispatch ancestry',
      intentId: intent.intentId,
    });
  const operationalAuthorization = createAflTradePrivateValuationModelRunOperationalAuthorization({
    runIntentId: intent.intentId,
    datasetId: graph.dataset.datasetId,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    dispatchRequestId: graph.pav.requestId,
    substantiveOperationId: operationId,
    dispatchClaimId: syntheticId('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: 1,
    dispatchLeaseTokenSha256: sha256AflTradeCanonicalJson({ fixture: 'synthetic lease' }),
    factualOutputId: syntheticId('private-valuation-factual-output'),
    hpnCalculationId: graph.pav.pavMeasurements[0]!.calculation.calculationId,
    factualValuesSha256: sha256AflTradeCanonicalJson(graph.evidence.factualCandidate),
    hpnValuesSha256: sha256AflTradeCanonicalJson(graph.pav.pavMeasurements[0]!.calculation),
    authorizedAt: startedAt,
    validThrough: '2026-09-02T00:22:30.000Z',
  });
  const gateDecisionLedger = {
    proposals: [
      ...graph.evidence.sourceRights.flatMap((source) => source.gateLedger.proposals),
      ...gate2Ledger.proposals,
    ],
    decisions: [
      ...graph.evidence.sourceRights.flatMap((source) => source.gateLedger.decisions),
      ...gate2Ledger.decisions,
    ],
  };
  const authorizationContent = {
    schemaVersion: 'afl-trade-model-run-authorization/v1',
    authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    runIntentId: intent.intentId,
    datasetId: graph.dataset.datasetId,
    datasetAdmissionId: admission.admissionId,
    datasetRowSetSha256: graph.dataset.content.rowSetSha256,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    operationalAuthorizationReceiptId: operationalAuthorization.receiptId,
    gate2DecisionId: admission.content.gate2Decision.decisionId,
    gateLedgerRevision: gateDecisionLedger.decisions.length,
    authorizedAt: startedAt,
    validThrough: operationalAuthorization.content.validThrough,
    modelTrainingEvaluationReceiptIds: intent.content.modelTrainingEvaluationReceiptIds,
  };
  const authorization = aflTradeModelRunAuthorizationSchema.parse({
    authorizationId: createAflTradeContentAddress('model-run-authorization', authorizationContent),
    content: authorizationContent,
  });
  const artifactRepository = createAflTradeFixtureArtifactRepository();
  const references = [
    ...new Map(
      [
        intent.content.sourceCodeArtifact,
        intent.content.dependencyLockArtifact,
        intent.content.runtimeArtifact,
        intent.content.containerArtifact,
        intent.content.configurationArtifact,
        intent.content.environmentArtifact,
        ...intent.content.featureDefinitionArtifacts,
        protocol.content.sourceObservationSet.artifact,
        protocol.content.pavPolicy.artifact,
        protocol.content.hpnMethod.artifact,
        protocol.content.featureDefinitionArtifact,
        protocol.content.featurePolicy.featureAvailabilityArtifact,
        ...protocol.content.validationPlan.baselineDefinitionArtifacts,
        ...protocol.content.validationPlan.metricDefinitionArtifacts,
        protocol.content.validationPlan.intervalCalibrationArtifact,
        ...protocol.content.validationPlan.sensitivityAnalysisArtifacts,
        protocol.content.validationPlan.acceptanceCriteriaArtifact,
        graph.pav.method.content.sourceArtifact,
      ].map((reference) => [reference.artifactId, reference])
    ).values(),
  ];
  const bytesById = new Map(
    [...graph.artifactBytes, ...template.evidence.executableArtifacts].map((item) => [
      item.artifactId,
      item.bytes,
    ])
  );
  bytesById.set(intent.content.configurationArtifact.artifactId, configurationBytes);
  bytesById.set(
    metricDefinitionArtifact.artifactId,
    new TextEncoder().encode(canonicalizeAflTradeJson(metricDefinition))
  );
  for (const definition of validationDefinitions)
    bytesById.set(definition.reference.artifactId, definition.bytes);
  bytesById.set(
    protocol.content.validationPlan.intervalCalibrationArtifact.artifactId,
    calibrationConfigurationBytes
  );
  bytesById.set(
    protocol.content.pavPolicy.artifact.artifactId,
    new TextEncoder().encode(canonicalizeAflTradeJson(graph.pav.policy))
  );
  bytesById.set(
    protocol.content.hpnMethod.artifact.artifactId,
    new TextEncoder().encode(canonicalizeAflTradeJson(graph.pav.method))
  );
  bytesById.set(graph.pav.method.content.sourceArtifact.artifactId, graph.pav.sourceBytes);
  const executableArtifacts = [];
  for (const reference of references) {
    const bytes = bytesById.get(reference.artifactId);
    if (!bytes) throw new Error(`Missing exact source artifact ${reference.artifactId}`);
    await artifactRepository.putIfAbsent(reference, bytes);
    executableArtifacts.push({ artifactId: reference.artifactId, bytes });
  }
  const evidence: AflTradeNativePavModelRunEvidence = {
    registeredProtocol: protocol,
    admission,
    datasetCandidate: graph.dataset,
    observationSet,
    pavObservationSet: graph.pav.pavObservationSet,
    hpnMethod: graph.pav.method,
    spellMetrics: [],
    admissionEvaluationReceipts: graph.evidence.sourceRights.map(
      (source) => source.admissionReceipt
    ),
    runStartEvaluationReceipts,
    sourceRightsProposals: graph.evidence.sourceRights.map((source) => source.rightsProposal),
    gateLedgerRevision: gateDecisionLedger.decisions.length,
    gateDecisionLedger,
    gate2DecisionKey: graph.evidence.gate2DecisionKey,
    gate2Ledger,
    operationalAuthorization,
    executableArtifacts,
  };
  const retained = new Map<string, unknown>();
  const calls: { sql: string; transaction: number }[] = [];
  let transactionNumber = 0;
  let activeTransaction = 0;
  let consumed = false;
  let checkpoint: unknown;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters: readonly unknown[] = []) {
      if (!activeTransaction) throw new Error('Authority queries escaped transaction.');
      calls.push({ sql: statement, transaction: activeTransaction });
      let rows: unknown[];
      if (statement.includes('pg_advisory_xact_lock')) rows = [];
      else if (statement.includes('SELECT intent.intent_json,authority.authorization_json'))
        rows = [
          {
            intent_json: intent,
            authorization_json: authorization,
            consumed_at: consumed ? startedAt : null,
            receipt_json: operationalAuthorization,
            protocol_json: protocol,
            observation_json: observationSet,
            dataset_json: graph.dataset,
          },
        ];
      else if (
        statement.includes('SELECT checkpoint_json FROM outcome_valuation_model_run_checkpoint')
      )
        rows = [...retained.entries()]
          .filter(([key]) => key.startsWith('outcome_valuation_model_run_checkpoint:'))
          .map(([, document]) => ({ checkpoint_json: document }));
      else if (statement.includes('WHERE previous_intent_id=$1')) rows = [];
      else if (statement.includes('load_outcome_private_valuation_dispatch_request_for_claim'))
        rows = [{ request_id: graph.pav.requestId }];
      else if (statement.includes('FROM outcome_private_valuation_model_request_binding'))
        rows = [{ operation_id: operationId }];
      else if (statement.includes('clock_timestamp()) AS now'))
        rows = [{ now: '2026-09-02T00:22:10.000Z' }];
      else if (statement.includes('SELECT protocol.protocol_json,observation.observation_json'))
        rows = [
          {
            protocol_json: protocol,
            observation_json: observationSet,
            admission_json: admission,
            dataset_json: graph.dataset,
            gate2_decision_key: evidence.gate2DecisionKey,
            operational_authorization_json: operationalAuthorization,
          },
        ];
      else if (
        statement.includes('FROM outcome_valuation_dataset_gate0_evaluation') &&
        statement.includes('ANY')
      ) {
        const ids = parameters[0] as readonly string[];
        rows = [...evidence.admissionEvaluationReceipts, ...runStartEvaluationReceipts]
          .filter((receipt) => ids.includes(receipt.receiptId))
          .map((receipt) => ({ document_json: receipt }));
      } else if (statement.includes('FROM outcome_source_rights_proposal'))
        rows = evidence.sourceRightsProposals.map((proposal) => ({ document_json: proposal }));
      else if (statement.includes('FROM outcome_gate_proposal'))
        rows = gateDecisionLedger.proposals.map((proposal) => ({ proposal_json: proposal }));
      else if (statement.includes('FROM outcome_gate_decision'))
        rows = gateDecisionLedger.decisions.map((decision) => ({ decision_json: decision }));
      else if (statement.includes('SELECT COALESCE(root_intent_id,intent_id)'))
        rows = [{ root_intent_id: intent.intentId }];
      else if (statement.includes('SELECT admission.admission_json'))
        rows = [
          {
            admission_json: admission,
            dataset_json: graph.dataset,
            analytical_authority_receipt_id: graph.evidence.analyticalAuthority.receiptId,
            gate2_decision_key: graph.evidence.gate2DecisionKey,
          },
        ];
      else if (statement.includes('SELECT dataset.factual_candidate_id'))
        rows = [
          {
            factual_candidate_id: graph.evidence.factualCandidate.candidateId,
            lineage_id: graph.evidence.corpusLineage.lineageId,
            protocol_json: protocol,
            observation_json: observationSet,
            admission_json: admission,
            dataset_json: graph.dataset,
          },
        ];
      else if (statement.includes('FROM outcome_valuation_dataset_consumed_field_set'))
        rows = graph.evidence.consumedFieldSets.map((field) => ({ field_set_json: field }));
      else if (
        statement.includes('SELECT lineage_json FROM outcome_valuation_dataset_factual_lineage')
      )
        rows = [{ lineage_json: graph.evidence.corpusLineage }];
      else if (
        statement.includes(
          'SELECT candidate_id,candidate_sha256,status,finalized_at,candidate_json'
        )
      ) {
        const candidate = graph.evidence.factualCandidate;
        rows = [
          {
            candidate_id: candidate.candidateId,
            candidate_sha256: candidate.candidateSha256,
            status: 'approved',
            finalized_at: candidate.content.createdAt,
            candidate_json: candidate.content,
          },
        ];
      } else if (statement.includes('JOIN outcome_external_canonical_promotion promotion')) {
        rows = graph.evidence.corpusLineage.content.domainLineageMappings.map((mapping) => {
          const sourceRow = graph.pav.pavMeasurements[0]!.inputSet.content.rows.filter(
            (row) => row.kind !== 'completed_match_result'
          ).find(
            (row) => row.acquisitionSpell?.spellVersionId === mapping.acquisitionSpellVersionId
          )!;
          const run = graph.pav.pavMeasurements[0]!.inputSet.content.sourceRuns.find(
            (item) => item.normalizationRunId === sourceRow.source.normalizationRunId
          )!;
          return {
            spell_version_id: mapping.acquisitionSpellVersionId,
            spell_id: mapping.acquisitionSpellId,
            player_id: mapping.playerId,
            club_id: mapping.clubId,
            start_event_version_id: mapping.eventVersionId,
            start_asset_version_id: sourceRow.acquisitionSpell!.startAssetVersionId,
            event_id: mapping.eventId,
            event_competition: 'AFLM',
            event_season_year: Number(sourceRow.acquisitionSpell!.startDate.slice(0, 4)),
            source_capture_id: run.captureId,
            asset_source_capture_id: run.captureId,
            promotion_environment: 'non_production',
            promotion_competition: 'AFLM',
          };
        });
      } else if (statement.includes('SELECT edge_id,event_id FROM outcome_pick_lineage_edge'))
        rows = graph.evidence.corpusLineage.content.domainLineageMappings.flatMap((mapping) =>
          mapping.lineageEdgeIds.map((edgeId) => ({
            edge_id: edgeId,
            event_id: mapping.eventId,
          }))
        );
      else if (statement.includes('FROM outcome_gate_ledger_head'))
        rows = [{ revision: gateDecisionLedger.decisions.length }];
      else if (statement.includes('UPDATE outcome_valuation_model_run_authorization')) {
        if (
          JSON.stringify(parameters) !==
          JSON.stringify([authorization.authorizationId, intent.intentId, startedAt])
        )
          throw new Error('Wrong consumption identity');
        rows = consumed ? [] : [{ authorization_id: authorization.authorizationId }];
        consumed = true;
      } else if (statement.includes('SELECT intent.intent_json,operational.receipt_json'))
        rows = [
          {
            intent_json: intent,
            receipt_json: operationalAuthorization,
            recorded_at: startedAt,
          },
        ];
      else if (statement.startsWith('INSERT INTO')) {
        const table = /INSERT INTO (\w+)/u.exec(statement)![1]!;
        const documentParameter =
          table === 'outcome_valuation_model_run_authorization'
            ? parameters[7]
            : [...parameters]
                .reverse()
                .find((value) => typeof value === 'string' && value.startsWith('{'));
        if (typeof documentParameter !== 'string')
          throw new Error(`No canonical document for ${table}`);
        const document: unknown = JSON.parse(documentParameter);
        retained.set(`${table}:${String(parameters[0])}`, document);
        if (table === 'outcome_valuation_model_run_checkpoint') checkpoint = document;
        rows = [{}];
      } else if (statement.includes(' AS document_json')) {
        const table = /FROM (\w+)/u.exec(statement)![1]!;
        const document = retained.get(`${table}:${String(parameters[0])}`);
        rows =
          document &&
          !(table === 'outcome_valuation_model_run_checkpoint' && readback === 'missing_readback')
            ? [{ document_json: document }]
            : [];
      } else return current.client.query<Row>(statement, parameters);
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async transaction(work) {
      activeTransaction = ++transactionNumber;
      try {
        return await work(sql);
      } finally {
        activeTransaction = 0;
      }
    },
  };

  return {
    current,
    graph,
    template,
    admission,
    intent,
    protocol,
    observationSet,
    authorization,
    operationalAuthorization,
    runStartEvaluationReceipts,
    artifactRepository,
    sql,
    calls,
    retained,
    startedAt,
    evidence,
    references,
    configurationBytes,
    get checkpoint() {
      return checkpoint;
    },
  };
}
