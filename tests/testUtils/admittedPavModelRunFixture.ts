import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  AFL_TRADE_PLAYER_MODEL_SUBGROUPS,
  createAflTradePlayerPavModelProtocol,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  createAflTradeModelRunOperationalAuthorization,
  type AflTradeNativePavModelRunEvidence,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradePlayerObservationSetV3 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import { AflTradeValuationDatasetAdmissionService } from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { fullPlayerPavDatasetAdmissionFixture } from './playerPavDatasetAdmissionFixture';

/** Synthetic run-start authority only; no fitted model, execution or genuine approval. */
export async function admittedPavModelRunFixture() {
  const base = await fullPlayerPavDatasetAdmissionFixture();
  const parent = base.evidence;
  const scope = {
    ...parent.gate2Ledger.proposals[0]!.content.scope,
    scopeKey: base.dataset.content.scopeKey,
    dimensions: [
      { name: 'competition', values: [base.dataset.content.competition] },
      { name: 'scope', values: [base.dataset.content.scopeKey] },
    ],
  };
  const proposalContent = { ...parent.gate2Ledger.proposals[0]!.content, scope };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    ...parent.gate2Ledger.decisions[0]!.content,
    scope,
    proposalId: proposal.proposalId,
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  const admissionEvidence = {
    ...parent,
    gate2Ledger: { proposals: [proposal], decisions: [decision] },
  };
  const admitted = await new AflTradeValuationDatasetAdmissionService({
    authenticate: async () => admissionEvidence,
  }).admit({ dataset: base.dataset, admittedAt: '2026-09-02T00:20:00.000Z' });
  if (admitted.status !== 'admitted') throw new Error(JSON.stringify(admitted));
  const admission = admitted.receipt;
  const preparedAt = '2026-09-02T00:21:00.000Z';
  const startedAt = '2026-09-02T00:22:00.000Z';
  const bytesById = new Map(base.artifactBytes.map(({ artifactId, bytes }) => [artifactId, bytes]));
  bytesById.set(base.pav.method.content.sourceArtifact.artifactId, base.pav.sourceBytes);
  const artifact = (document: unknown) => {
    const reference = createAflTradeCanonicalJsonArtifactRef(document, preparedAt);
    bytesById.set(
      reference.artifactId,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
    return reference;
  };
  const reviewArtifact = artifact({
    fixture: 'Native protocol review artifact shape; no execution approval.',
  });
  const windows = {
    train: { from: '2005-01-01T00:00:00.000Z', to: '2006-01-01T00:00:00.000Z' },
    calibration: { from: '2009-01-01T00:00:00.000Z', to: '2010-01-01T00:00:00.000Z' },
    validation: { from: '2013-01-01T00:00:00.000Z', to: '2014-01-01T00:00:00.000Z' },
    finalTest: { from: '2017-01-01T00:00:00.000Z', to: '2018-01-01T00:00:00.000Z' },
    embargoDays: 0,
  };
  const specification = base.dataset.content.specification.content;
  const protocol = createAflTradePlayerPavModelProtocol({
    schemaVersion: 'afl-trade-model-protocol/v3',
    environment: 'test_fixture',
    protocolKey: 'fixture-native-pav-authority',
    version: 1,
    modelKind: 'player_contribution_and_availability',
    datasetId: base.dataset.datasetId,
    datasetAdmission: {
      schemaVersion: 'afl-trade-dataset-admission/v3',
      admissionId: admission.admissionId,
      admittedAt: admission.content.admittedAt,
    },
    preparedAt,
    preparedBy: 'fixture-native-model-owner',
    proposalOrigin: 'agent_assisted',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    observationGrain: 'player_acquisition_spell_prediction',
    sourceObservationSet: {
      observationSetId: parent.pavObservationSet.observationSetId,
      artifact: base.dataset.content.pavObservationSet!.artifact,
    },
    pavPolicy: {
      policyId: parent.pavObservationSet.content.policy.policyId,
      artifact: artifact(parent.pavObservationSet.content.policy),
    },
    hpnMethod: { methodId: base.pav.method.methodId, artifact: artifact(base.pav.method) },
    target: {
      fixedHorizonSeasons: 3,
      annualValueUnit: 'season_pav',
      aggregation: 'sum',
      valueUnit: 'fixed_horizon_pav',
    },
    featureDefinitionArtifact: specification.featureDefinitions[0]!,
    featurePolicy: {
      ...specification.featurePolicy,
      correctionAvailability: 'only_after_known_from',
      unknownAndZero: 'distinct',
      targetDerivedFeatures: 'prohibited',
      postOutcomeFeatures: 'prohibited',
      featureAvailabilityArtifact: reviewArtifact,
    },
    windows,
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only',
      finalTestUse: 'single_evaluation_after_candidate_lock',
      finalTestRetuning: 'prohibited',
    },
    validationPlan: {
      baselineDefinitionArtifacts: [reviewArtifact],
      metricDefinitionArtifacts: [reviewArtifact],
      intervalCalibrationArtifact: reviewArtifact,
      subgroupDimensions: [...AFL_TRADE_PLAYER_MODEL_SUBGROUPS],
      sensitivityAnalysisArtifacts: [reviewArtifact],
      acceptanceCriteriaArtifact: reviewArtifact,
    },
    limitations: ['Synthetic run-start fixture; not a model qualification or genuine admission.'],
  });
  const observationSet = createAflTradePlayerObservationSetV3({
    candidate: base.dataset,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    pavObservationSet: parent.pavObservationSet,
  });
  const runStartEvaluationReceipts = parent.sourceRights.map((source) =>
    createAflTradeGate0AReceipt(
      source.gateLedger,
      source.rightsProposal,
      { ...source.admissionReceipt.content.request, evaluatedAt: startedAt },
      startedAt
    )
  );
  const runtimeArtifact = artifact({ fixture: 'runtime custody, not executable model' });
  const intent = createAflTradeModelRunIntent({
    environment: 'test_fixture',
    modelId: 'fixture-native-pav',
    modelVersion: 'fixture-v1',
    datasetId: base.dataset.datasetId,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    codeCommitSha: 'a'.repeat(64),
    cleanWorktree: true,
    seed: 17,
    job: {
      jobId: 'fixture-native-pav-job',
      attempt: 1,
      initiatedBy: 'fixture-native-model-owner',
      workerIdentity: 'fixture-native-worker',
    },
    startedAt,
    windows,
    sourceCodeArtifact: runtimeArtifact,
    dependencyLockArtifact: runtimeArtifact,
    runtimeArtifact,
    containerArtifact: runtimeArtifact,
    configurationArtifact: runtimeArtifact,
    environmentArtifact: runtimeArtifact,
    featureDefinitionArtifacts: [...specification.featureDefinitions],
    modelTrainingEvaluationReceiptIds: runStartEvaluationReceipts
      .map(({ receiptId }) => receiptId)
      .sort(),
  });
  const operationalAuthorization = createAflTradeModelRunOperationalAuthorization({
    environment: 'test_fixture',
    runIntentId: intent.intentId,
    datasetId: base.dataset.datasetId,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    authorizedAt: startedAt,
    validThrough: '2026-09-02T00:22:30.000Z',
    principalRef: 'fixture-native-model-operator',
    role: 'afl_trade_model_run_operator',
    authorityEvidence: {
      id: `reviewer-authority-evidence:${'e'.repeat(64)}`,
      sha256: 'e'.repeat(64),
    },
  });
  const references = [
    runtimeArtifact,
    base.pav.method.content.sourceArtifact,
    ...specification.featureDefinitions,
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
  ];
  const gateDecisionLedger = {
    proposals: [
      ...new Map(
        parent.sourceRights
          .flatMap((source) => source.gateLedger.proposals)
          .map((proposal) => [proposal.proposalId, proposal])
      ).values(),
    ],
    decisions: [
      ...new Map(
        parent.sourceRights
          .flatMap((source) => source.gateLedger.decisions)
          .map((decision) => [decision.decisionId, decision])
      ).values(),
    ],
  };
  const evidence: AflTradeNativePavModelRunEvidence = {
    registeredProtocol: protocol,
    admission,
    datasetCandidate: base.dataset,
    observationSet,
    pavObservationSet: parent.pavObservationSet,
    hpnMethod: base.pav.method,
    spellMetrics: [] as const,
    admissionEvaluationReceipts: parent.sourceRights.map((source) => source.admissionReceipt),
    runStartEvaluationReceipts,
    sourceRightsProposals: parent.sourceRights.map((source) => source.rightsProposal),
    gateLedgerRevision: gateDecisionLedger.decisions.length,
    gateDecisionLedger,
    gate2DecisionKey: parent.gate2DecisionKey,
    gate2Ledger: admissionEvidence.gate2Ledger,
    operationalAuthorization,
    executableArtifacts: [
      ...new Map(references.map((reference) => [reference.artifactId, reference])).values(),
    ].map((reference) => {
      const bytes = bytesById.get(reference.artifactId);
      if (!bytes) throw new Error(`Missing fixture artifact ${reference.artifactId}`);
      return { artifactId: reference.artifactId, bytes };
    }),
  };
  return { base, admission, protocol, observationSet, intent, evidence, startedAt };
}
