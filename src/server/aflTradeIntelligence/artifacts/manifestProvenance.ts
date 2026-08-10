import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import {
  validateAflTradeArchitecturePackageContext,
  type AflTradeArchitectureDecisionPackage,
} from '../governance/architectureDecisionPackage';
import type { AflTradeArchitectureCurrentState } from '../governance/architectureCurrentState';
import {
  resolveAflTradeGateEligibility,
  validateAflTradeGateDecisionLedger,
} from '../governance/gateDecisionLedger';
import type {
  AflTradeDecisionEnvironment,
  AflTradeGateCode,
  AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import type { AflTradeDataSufficiencyProtocol } from '../governance/dataSufficiencyProtocol';
import type { AflTradeGate0AReceipt } from '../source/gate0aReceipt';
import type { AflTradeSourceRightsProposal } from '../source/sourceRights';
import { canonicalizeAflTradeJson } from './contentAddress';
import type { AflTradeCorpusManifest } from './corpusManifest';
import {
  type AflTradeCoverageReport,
  validateAflTradeCoverageAgainstProtocol,
} from './coverageReport';
import type { AflTradeDatasetManifest } from './datasetManifest';
import type { AflTradeEvidenceManifest } from './evidenceManifest';
import type { AflTradeModelProtocol } from './modelProtocol';
import type { AflTradeModelRunManifest } from './modelRunManifest';
import type {
  AflTradeProjectionManifest,
  AflTradePublicationManifest,
} from './publicationProjectionManifests';
import type { AflTradeValuationBundleManifest } from './valuationBundleManifest';

export type AflTradeManifestProvenanceIssueCode =
  | 'invalid_ledger'
  | 'artifact_missing'
  | 'decision_invalid'
  | 'decision_artifact_mismatch'
  | 'environment_mismatch'
  | 'parent_mismatch'
  | 'source_set_mismatch'
  | 'chronology_invalid'
  | 'authorization_mismatch'
  | 'field_not_authorized'
  | 'protocol_report_invalid'
  | 'data_sufficiency_not_met'
  | 'architecture_context_invalid'
  | 'cohort_mismatch'
  | 'unsuccessful_model_run';

export interface AflTradeManifestProvenanceIssue {
  code: AflTradeManifestProvenanceIssueCode;
  subject: string;
  message: string;
}

export interface AflTradeManifestProvenanceInput {
  ledger: AflTradeGateDecisionLedger;
  environment: AflTradeDecisionEnvironment;
  evaluatedAt: string;
  sourceRights: readonly AflTradeSourceRightsProposal[];
  gate0aReceipts: readonly AflTradeGate0AReceipt[];
  evidence: AflTradeEvidenceManifest;
  dataSufficiencyProtocol: AflTradeDataSufficiencyProtocol;
  coverageReport: AflTradeCoverageReport;
  architectureCurrentState: AflTradeArchitectureCurrentState;
  architectureDecisionPackage: AflTradeArchitectureDecisionPackage;
  corpus: AflTradeCorpusManifest;
  datasets: readonly AflTradeDatasetManifest[];
  modelProtocols: readonly AflTradeModelProtocol[];
  modelRuns: readonly AflTradeModelRunManifest[];
  valuationBundle: AflTradeValuationBundleManifest;
  publication: AflTradePublicationManifest;
  projection: AflTradeProjectionManifest;
}

function addIssue(
  issues: AflTradeManifestProvenanceIssue[],
  code: AflTradeManifestProvenanceIssueCode,
  subject: string,
  message: string
) {
  issues.push({ code, subject, message });
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function sameArtifactReferences(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return sameSet(
      left.map((reference) => canonicalizeAflTradeJson(reference)),
      right.map((reference) => canonicalizeAflTradeJson(reference))
    );
  }
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function decisionPins(
  artifacts: readonly AflTradeGovernedArtifactRef[],
  expected: readonly AflTradeGovernedArtifactRef[]
): boolean {
  return expected.every((reference) =>
    artifacts.some(
      (artifact) => artifact.kind === reference.kind && artifact.artifactId === reference.artifactId
    )
  );
}

function collectChronologyIssues(
  entries: ReadonlyArray<{ id: string; time: string }>
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  for (let index = 1; index < entries.length; index += 1) {
    if (Date.parse(entries[index].time) < Date.parse(entries[index - 1].time)) {
      addIssue(
        issues,
        'chronology_invalid',
        entries[index].id,
        `${entries[index].id} predates ${entries[index - 1].id}.`
      );
    }
  }
  return issues;
}

function buildProvenanceLookupContext(input: AflTradeManifestProvenanceInput) {
  return {
    input,
    rightsById: new Map(
      input.sourceRights.map((rights) => [rights.rightsArtifactId, rights] as const)
    ),
    receiptsById: new Map(
      input.gate0aReceipts.map((receipt) => [receipt.receiptId, receipt] as const)
    ),
    permittedFieldsByReceiptId: new Map(
      input.gate0aReceipts.map((receipt) => [
        receipt.receiptId,
        new Set(receipt.content.request.fieldUses.map((fieldUse) => fieldUse.sourceField)),
      ])
    ),
    authorizationById: new Map(
      input.evidence.content.sourceAuthorizations.map((authorization) => [
        authorization.authorizationId,
        authorization,
      ])
    ),
    datasetById: new Map(input.datasets.map((dataset) => [dataset.datasetId, dataset] as const)),
    protocolById: new Map(
      input.modelProtocols.map((protocol) => [protocol.protocolId, protocol] as const)
    ),
    runById: new Map(input.modelRuns.map((run) => [run.runId, run] as const)),
  };
}

type ProvenanceLookupContext = ReturnType<typeof buildProvenanceLookupContext>;

function collectComponentInventoryIssues(
  context: ProvenanceLookupContext
): AflTradeManifestProvenanceIssue[] {
  const { input } = context;
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const expectedDatasetIds = [
    ...new Set(input.valuationBundle.content.components.map((component) => component.datasetId)),
  ];
  const inventories: ReadonlyArray<{
    label: string;
    expected: readonly string[];
    actual: readonly string[];
  }> = [
    {
      label: 'dataset',
      expected: expectedDatasetIds,
      actual: input.datasets.map((dataset) => dataset.datasetId),
    },
    {
      label: 'model protocol',
      expected: input.valuationBundle.content.components.map((component) => component.protocolId),
      actual: input.modelProtocols.map((protocol) => protocol.protocolId),
    },
    {
      label: 'model run',
      expected: input.valuationBundle.content.components.map((component) => component.runId),
      actual: input.modelRuns.map((run) => run.runId),
    },
  ];
  for (const inventory of inventories) {
    if (!sameSet(inventory.expected, inventory.actual)) {
      addIssue(
        issues,
        'artifact_missing',
        input.valuationBundle.valuationBundleId,
        `Valuation bundle ${inventory.label} inventory must match its exact component references.`
      );
    }
  }

  for (const component of input.valuationBundle.content.components) {
    const dataset = context.datasetById.get(component.datasetId);
    const protocol = context.protocolById.get(component.protocolId);
    const run = context.runById.get(component.runId);
    if (!dataset || !protocol || !run) {
      addIssue(
        issues,
        'artifact_missing',
        component.runId,
        `Valuation component ${component.role} is missing its exact dataset, protocol, or run.`
      );
      continue;
    }
    if (protocol.content.modelKind !== component.modelKind) {
      addIssue(
        issues,
        'parent_mismatch',
        component.protocolId,
        `Valuation component ${component.role} does not match its protocol model kind.`
      );
    }
  }
  return issues;
}

interface DecisionRequirement {
  decisionId: string;
  gate: AflTradeGateCode;
  expectedArtifacts: readonly AflTradeGovernedArtifactRef[];
}

function collectDecisionRequirementIssues(
  context: ProvenanceLookupContext,
  requirement: DecisionRequirement
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const { input } = context;
  const { decisionId, expectedArtifacts, gate } = requirement;
  const decision = input.ledger.decisions.find((candidate) => candidate.decisionId === decisionId);
  if (!decision || decision.content.gate !== gate) {
    addIssue(issues, 'decision_invalid', decisionId, `Required ${gate} decision is absent.`);
    return issues;
  }

  const resolution = resolveAflTradeGateEligibility(input.ledger, {
    gate,
    decisionKey: decision.content.decisionKey,
    environment: input.environment,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    resolution.status !== 'mechanically_eligible' ||
    resolution.decision?.decisionId !== decisionId
  ) {
    addIssue(
      issues,
      'decision_invalid',
      decisionId,
      `Decision ${decisionId} is not the effective ${gate} approval.`
    );
  }
  if (!decisionPins(decision.content.affectedArtifacts, expectedArtifacts)) {
    addIssue(
      issues,
      'decision_artifact_mismatch',
      decisionId,
      `Decision ${decisionId} does not pin every required artifact.`
    );
  }
  return issues;
}

function collectSourceAuthorizationIssues(
  context: ProvenanceLookupContext
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  for (const authorization of context.input.evidence.content.sourceAuthorizations) {
    const rights = context.rightsById.get(authorization.rightsArtifactId);
    const receipt = context.receiptsById.get(authorization.gate0aReceiptId);
    if (!rights || !receipt) {
      addIssue(
        issues,
        'artifact_missing',
        authorization.authorizationId,
        'Source authorization is missing its rights artifact or Gate 0A receipt.'
      );
      continue;
    }
    if (
      rights.content.registerId !== authorization.sourceRegisterId ||
      receipt.content.request.rightsArtifactId !== authorization.rightsArtifactId ||
      receipt.content.result.decisionId !== authorization.gate0aDecisionId ||
      receipt.content.result.status !== 'mechanically_eligible'
    ) {
      addIssue(
        issues,
        'authorization_mismatch',
        authorization.authorizationId,
        'Source authorization does not match its rights artifact, receipt, and decision.'
      );
    }
    issues.push(
      ...collectDecisionRequirementIssues(context, {
        decisionId: authorization.gate0aDecisionId,
        gate: 'gate_0a_permission_to_evaluate',
        expectedArtifacts: [
          { kind: 'source_rights', artifactId: authorization.rightsArtifactId },
        ],
      })
    );
  }
  return issues;
}

function collectEvidenceAuthorizationIssues(
  context: ProvenanceLookupContext
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  for (const item of context.input.evidence.content.items) {
    const authorization = context.authorizationById.get(item.content.authorizationId);
    const receipt = authorization
      ? context.receiptsById.get(authorization.gate0aReceiptId)
      : undefined;
    const permittedFields = receipt
      ? (context.permittedFieldsByReceiptId.get(receipt.receiptId) ?? new Set<string>())
      : new Set<string>();
    if (
      !receipt ||
      !receipt.content.request.operations.includes('bounded_evaluation_capture') ||
      Date.parse(receipt.content.recordedAt) > Date.parse(item.content.retrievedAt)
    ) {
      addIssue(
        issues,
        'authorization_mismatch',
        item.evidenceItemId,
        'Evidence capture is not preceded by a matching eligible Gate 0A receipt.'
      );
    }
    for (const field of item.content.capturedFields) {
      if (!permittedFields.has(field)) {
        addIssue(
          issues,
          'field_not_authorized',
          `${item.evidenceItemId}:${field}`,
          `Captured field ${field} is absent from the Gate 0A receipt.`
        );
      }
    }
  }
  return issues;
}

function collectGatePolicyIssues(
  context: ProvenanceLookupContext
): AflTradeManifestProvenanceIssue[] {
  const { input } = context;
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const coverageValidation = validateAflTradeCoverageAgainstProtocol(
    input.dataSufficiencyProtocol,
    input.coverageReport
  );
  for (const issue of coverageValidation.issues) {
    addIssue(issues, 'protocol_report_invalid', issue.subject, issue.message);
  }
  if (!coverageValidation.approvalEligible) {
    addIssue(
      issues,
      'data_sufficiency_not_met',
      input.coverageReport.reportId,
      'Required Gate 0B coverage outcomes are not approval-eligible.'
    );
  }
  const architectureContext = validateAflTradeArchitecturePackageContext(
    input.architectureCurrentState,
    input.architectureDecisionPackage
  );
  for (const issue of architectureContext.issues) {
    addIssue(
      issues,
      'architecture_context_invalid',
      input.architectureDecisionPackage.packageId,
      issue.message
    );
  }
  const requirements: DecisionRequirement[] = [
    {
      decisionId: input.corpus.content.gate0bDecisionId,
      gate: 'gate_0b_data_sufficiency',
      expectedArtifacts: [
        { kind: 'data_sufficiency_protocol', artifactId: input.dataSufficiencyProtocol.protocolId },
        { kind: 'coverage_report', artifactId: input.coverageReport.reportId },
      ],
    },
    {
      decisionId: input.corpus.content.gate1DecisionId,
      gate: 'gate_1_architecture_authority',
      expectedArtifacts: [
        {
          kind: 'architecture_current_state',
          artifactId: input.architectureCurrentState.snapshotId,
        },
        {
          kind: 'architecture_decision_package',
          artifactId: input.architectureDecisionPackage.packageId,
        },
      ],
    },
  ];
  for (const dataset of input.datasets) {
    requirements.push({
      decisionId: dataset.content.gate2DecisionId,
      gate: 'gate_2_corpus_lineage',
      expectedArtifacts: [{ kind: 'corpus_manifest', artifactId: input.corpus.corpusId }],
    });
  }
  for (const component of input.valuationBundle.content.components) {
    requirements.push({
      decisionId: component.gate3DecisionId,
      gate: 'gate_3_model_validity',
      expectedArtifacts: [
        { kind: 'model_protocol', artifactId: component.protocolId },
        { kind: 'model_run', artifactId: component.runId },
      ],
    });
  }
  requirements.push({
    decisionId: input.publication.content.gate3DecisionId,
    gate: 'gate_3_model_validity',
    expectedArtifacts: [
      { kind: 'valuation_bundle', artifactId: input.valuationBundle.valuationBundleId },
    ],
  });
  for (const requirement of requirements) {
    issues.push(...collectDecisionRequirementIssues(context, requirement));
  }
  return issues;
}

function collectParentRelationshipIssues(
  context: ProvenanceLookupContext
): AflTradeManifestProvenanceIssue[] {
  const { input } = context;
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const parentChecks: ReadonlyArray<[boolean, string, string]> = [
    [
      input.corpus.content.evidenceManifestId === input.evidence.manifestId,
      input.corpus.corpusId,
      'Corpus must reference the exact evidence manifest.',
    ],
    [
      input.corpus.content.dataSufficiencyProtocolId === input.dataSufficiencyProtocol.protocolId &&
        input.corpus.content.coverageReportId === input.coverageReport.reportId,
      input.corpus.corpusId,
      'Corpus must reference the exact Gate 0B protocol and report.',
    ],
    [
      input.corpus.content.architectureCurrentStateId ===
        input.architectureCurrentState.snapshotId &&
        input.corpus.content.architectureDecisionPackageId ===
          input.architectureDecisionPackage.packageId,
      input.corpus.corpusId,
      'Corpus must reference the exact Gate 1 architecture snapshot and package.',
    ],
    [
      input.publication.content.valuationBundleId === input.valuationBundle.valuationBundleId,
      input.publication.publicationId,
      'Publication must reference the exact valuation bundle.',
    ],
    [
      input.publication.content.scopeKey === input.valuationBundle.content.scopeKey &&
        input.publication.content.valueUnitId === input.valuationBundle.content.valueUnitId &&
        sameSet(
          input.publication.content.supportedViews,
          input.valuationBundle.content.viewContexts.map((viewContext) => viewContext.view)
        ),
      input.publication.publicationId,
      'Publication scope, value unit, and views must match the valuation bundle.',
    ],
    [
      sameArtifactReferences(
        input.publication.content.validationReportArtifact,
        input.valuationBundle.content.outputs.validationReportArtifact
      ) &&
        sameArtifactReferences(
          input.publication.content.modelCardArtifact,
          input.valuationBundle.content.outputs.modelCardArtifact
        ),
      input.publication.publicationId,
      'Publication validation report and model card must come from its valuation bundle.',
    ],
    [
      input.projection.content.publicationId === input.publication.publicationId,
      input.projection.projectionId,
      'Projection must reference the exact publication.',
    ],
  ];
  for (const [valid, subject, message] of parentChecks) {
    if (!valid) addIssue(issues, 'parent_mismatch', subject, message);
  }

  for (const dataset of input.datasets) {
    if (dataset.content.corpusId !== input.corpus.corpusId) {
      addIssue(
        issues,
        'parent_mismatch',
        dataset.datasetId,
        'Every component dataset must reference the exact corpus.'
      );
    }
  }
  for (const component of input.valuationBundle.content.components) {
    const dataset = context.datasetById.get(component.datasetId);
    const protocol = context.protocolById.get(component.protocolId);
    const run = context.runById.get(component.runId);
    if (!dataset || !protocol || !run) continue;

    const protocolValueUnitId =
      protocol.content.modelKind === 'player_contribution_and_availability'
        ? protocol.content.valueUnit.valueUnitId
        : protocol.content.valueAlignment.valueUnitId;
    const componentChecks: ReadonlyArray<[boolean, string]> = [
      [
        protocol.content.datasetId === dataset.datasetId &&
          run.content.datasetId === dataset.datasetId &&
          run.content.modelProtocolId === protocol.protocolId,
        'Component protocol and run must reference the exact dataset and each other.',
      ],
      [
        canonicalizeAflTradeJson(run.content.windows) ===
          canonicalizeAflTradeJson(protocol.content.windows),
        'Component run windows must exactly match the prespecified protocol.',
      ],
      [
        sameArtifactReferences(
          dataset.content.featureDefinitionArtifacts,
          run.content.featureDefinitionArtifacts
        ),
        'Component run feature definitions must exactly match its dataset.',
      ],
      [
        protocolValueUnitId === input.valuationBundle.content.valueUnitId,
        'Component value unit must match the valuation bundle.',
      ],
    ];
    for (const [valid, message] of componentChecks) {
      if (!valid) addIssue(issues, 'parent_mismatch', component.runId, message);
    }
  }
  return issues;
}

function collectCohortBoundaryIssues(
  input: AflTradeManifestProvenanceInput
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const coverageUnsupportedCohorts = input.coverageReport.content.unsupportedCohorts.map(
    (cohort) => cohort.cohortId
  );
  const corpusUnsupportedCohorts = input.corpus.content.unsupportedCohortIds;
  if (!sameSet(coverageUnsupportedCohorts, corpusUnsupportedCohorts)) {
    addIssue(
      issues,
      'cohort_mismatch',
      input.corpus.corpusId,
      'Corpus unsupported cohorts must exactly match the approved coverage report.'
    );
  }

  for (const dataset of input.datasets) {
    const includedCohorts = new Set(dataset.content.includedCohorts);
    const excludedCohorts = new Set(dataset.content.excludedCohorts);
    for (const cohortId of corpusUnsupportedCohorts) {
      if (includedCohorts.has(cohortId) || !excludedCohorts.has(cohortId)) {
        addIssue(
          issues,
          'cohort_mismatch',
          `${dataset.datasetId}:${cohortId}`,
          'A corpus-unsupported cohort must be explicitly excluded from every component dataset.'
        );
      }
    }
  }
  return issues;
}

function collectSourceSetIssues(
  input: AflTradeManifestProvenanceInput
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const evidenceSources = [
    ...new Set(
      input.evidence.content.sourceAuthorizations.map(
        (authorization) => authorization.sourceRegisterId
      )
    ),
  ];
  const sourceSets: ReadonlyArray<readonly [string, readonly string[]]> = [
    [input.coverageReport.reportId, input.coverageReport.content.sourceRegisterIds],
    [input.corpus.corpusId, input.corpus.content.sourceRegisterIds],
    ...input.datasets.map(
      (dataset) => [dataset.datasetId, dataset.content.sourceRegisterIds] as const
    ),
    [input.publication.publicationId, input.publication.content.sourceRegisterIds],
  ];
  for (const [subject, sources] of sourceSets) {
    if (!sameSet(evidenceSources, sources)) {
      addIssue(
        issues,
        'source_set_mismatch',
        subject,
        'Artifact source set differs from evidence.'
      );
    }
  }
  return issues;
}

function collectEnvironmentAndOutcomeIssues(
  input: AflTradeManifestProvenanceInput
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const environments = [
    input.evidence.content.environment,
    input.dataSufficiencyProtocol.content.environment,
    input.coverageReport.content.environment,
    input.architectureCurrentState.content.environment,
    input.architectureDecisionPackage.content.environment,
    input.corpus.content.environment,
    ...input.datasets.map((dataset) => dataset.content.environment),
    ...input.modelProtocols.map((protocol) => protocol.content.environment),
    ...input.modelRuns.map((run) => run.content.environment),
    input.valuationBundle.content.environment,
    input.publication.content.environment,
    input.projection.content.environment,
  ];
  if (environments.some((environment) => environment !== input.environment)) {
    addIssue(
      issues,
      'environment_mismatch',
      input.environment,
      'Artifact environments must match.'
    );
  }
  for (const run of input.modelRuns) {
    if (run.content.outcome.status !== 'succeeded') {
      addIssue(
        issues,
        'unsuccessful_model_run',
        run.runId,
        'A publication cannot descend from an unsuccessful component model run.'
      );
    }
  }
  return issues;
}

function collectManifestChronologyIssues(
  input: AflTradeManifestProvenanceInput
): AflTradeManifestProvenanceIssue[] {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  const commonPrefix = [
    { id: input.evidence.manifestId, time: input.evidence.content.createdAt },
    { id: input.coverageReport.reportId, time: input.coverageReport.content.createdAt },
    { id: input.corpus.corpusId, time: input.corpus.content.createdAt },
  ];
  for (const component of input.valuationBundle.content.components) {
    const dataset = input.datasets.find((candidate) => candidate.datasetId === component.datasetId);
    const protocol = input.modelProtocols.find(
      (candidate) => candidate.protocolId === component.protocolId
    );
    const run = input.modelRuns.find((candidate) => candidate.runId === component.runId);
    if (!dataset || !protocol || !run) continue;
    issues.push(
      ...collectChronologyIssues([
        ...commonPrefix,
        { id: dataset.datasetId, time: dataset.content.createdAt },
        { id: protocol.protocolId, time: protocol.content.preparedAt },
        { id: run.runId, time: run.content.startedAt },
        { id: `${run.runId}:finished`, time: run.content.finishedAt },
        {
          id: `${input.valuationBundle.valuationBundleId}:started`,
          time: input.valuationBundle.content.execution.startedAt,
        },
      ])
    );
  }
  issues.push(
    ...collectChronologyIssues([
      {
        id: `${input.valuationBundle.valuationBundleId}:started`,
        time: input.valuationBundle.content.execution.startedAt,
      },
      {
        id: `${input.valuationBundle.valuationBundleId}:finished`,
        time: input.valuationBundle.content.execution.finishedAt,
      },
      {
        id: input.valuationBundle.valuationBundleId,
        time: input.valuationBundle.content.createdAt,
      },
      { id: input.publication.publicationId, time: input.publication.content.createdAt },
      { id: input.projection.projectionId, time: input.projection.content.createdAt },
    ])
  );
  if (
    Date.parse(input.architectureCurrentState.content.capturedAt) >
      Date.parse(input.architectureDecisionPackage.content.preparedAt) ||
    Date.parse(input.architectureDecisionPackage.content.preparedAt) >
      Date.parse(input.corpus.content.createdAt)
  ) {
    addIssue(
      issues,
      'chronology_invalid',
      input.architectureDecisionPackage.packageId,
      'Gate 1 snapshot and package must exist before corpus materialization.'
    );
  }
  return issues;
}

export function validateAflTradeManifestProvenance(input: AflTradeManifestProvenanceInput): {
  valid: boolean;
  issues: AflTradeManifestProvenanceIssue[];
} {
  if (!validateAflTradeGateDecisionLedger(input.ledger).valid) {
    return {
      valid: false,
      issues: [
        {
          code: 'invalid_ledger',
          subject: 'ledger',
          message: 'The gate decision ledger is invalid.',
        },
      ],
    };
  }

  const context = buildProvenanceLookupContext(input);
  const issues = [
    ...collectComponentInventoryIssues(context),
    ...collectSourceAuthorizationIssues(context),
    ...collectEvidenceAuthorizationIssues(context),
    ...collectGatePolicyIssues(context),
    ...collectParentRelationshipIssues(context),
    ...collectCohortBoundaryIssues(input),
    ...collectSourceSetIssues(input),
    ...collectEnvironmentAndOutcomeIssues(input),
    ...collectManifestChronologyIssues(input),
  ];
  return { valid: issues.length === 0, issues };
}
