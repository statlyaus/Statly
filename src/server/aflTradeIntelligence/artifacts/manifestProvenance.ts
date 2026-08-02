import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
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
import type { AflTradeCorpusManifest } from './corpusManifest';
import {
  type AflTradeCoverageReport,
  validateAflTradeCoverageAgainstProtocol,
} from './coverageReport';
import type { AflTradeDatasetManifest } from './datasetManifest';
import type { AflTradeEvidenceManifest } from './evidenceManifest';
import type { AflTradeModelRunManifest } from './modelRunManifest';
import type {
  AflTradeProjectionManifest,
  AflTradePublicationManifest,
} from './publicationProjectionManifests';

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
  corpus: AflTradeCorpusManifest;
  dataset: AflTradeDatasetManifest;
  modelRun: AflTradeModelRunManifest;
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

function validateDecision(
  input: AflTradeManifestProvenanceInput,
  issues: AflTradeManifestProvenanceIssue[],
  decisionId: string,
  gate: AflTradeGateCode,
  expectedArtifacts: readonly AflTradeGovernedArtifactRef[]
) {
  const decision = input.ledger.decisions.find((candidate) => candidate.decisionId === decisionId);
  if (!decision || decision.content.gate !== gate) {
    addIssue(issues, 'decision_invalid', decisionId, `Required ${gate} decision is absent.`);
    return;
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
}

function validateChronology(
  issues: AflTradeManifestProvenanceIssue[],
  entries: ReadonlyArray<{ id: string; time: string }>
) {
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
}

export function validateAflTradeManifestProvenance(input: AflTradeManifestProvenanceInput): {
  valid: boolean;
  issues: AflTradeManifestProvenanceIssue[];
} {
  const issues: AflTradeManifestProvenanceIssue[] = [];
  if (!validateAflTradeGateDecisionLedger(input.ledger).valid) {
    addIssue(issues, 'invalid_ledger', 'ledger', 'The gate decision ledger is invalid.');
    return { valid: false, issues };
  }

  const rightsById = new Map(
    input.sourceRights.map((rights) => [rights.rightsArtifactId, rights] as const)
  );
  const receiptsById = new Map(
    input.gate0aReceipts.map((receipt) => [receipt.receiptId, receipt] as const)
  );
  const authorizationById = new Map(
    input.evidence.content.sourceAuthorizations.map((authorization) => [
      authorization.authorizationId,
      authorization,
    ])
  );

  for (const authorization of input.evidence.content.sourceAuthorizations) {
    const rights = rightsById.get(authorization.rightsArtifactId);
    const receipt = receiptsById.get(authorization.gate0aReceiptId);
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
    validateDecision(
      input,
      issues,
      authorization.gate0aDecisionId,
      'gate_0a_permission_to_evaluate',
      [{ kind: 'source_rights', artifactId: authorization.rightsArtifactId }]
    );
  }

  for (const item of input.evidence.content.items) {
    const authorization = authorizationById.get(item.content.authorizationId);
    const receipt = authorization ? receiptsById.get(authorization.gate0aReceiptId) : undefined;
    const permittedFields = new Set(
      receipt?.content.request.fieldUses.map((fieldUse) => fieldUse.sourceField) ?? []
    );
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

  const coverageValidation = validateAflTradeCoverageAgainstProtocol(
    input.dataSufficiencyProtocol,
    input.coverageReport
  );
  for (const issue of coverageValidation.issues) {
    addIssue(issues, 'protocol_report_invalid', issue.subject, issue.message);
  }
  validateDecision(
    input,
    issues,
    input.corpus.content.gate0bDecisionId,
    'gate_0b_data_sufficiency',
    [
      { kind: 'data_sufficiency_protocol', artifactId: input.dataSufficiencyProtocol.protocolId },
      { kind: 'coverage_report', artifactId: input.coverageReport.reportId },
    ]
  );
  validateDecision(input, issues, input.dataset.content.gate2DecisionId, 'gate_2_corpus_lineage', [
    { kind: 'corpus_manifest', artifactId: input.corpus.corpusId },
  ]);
  validateDecision(
    input,
    issues,
    input.publication.content.gate3DecisionId,
    'gate_3_model_validity',
    [{ kind: 'model_run', artifactId: input.modelRun.runId }]
  );

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
      input.dataset.content.corpusId === input.corpus.corpusId,
      input.dataset.datasetId,
      'Dataset must reference the exact corpus.',
    ],
    [
      input.modelRun.content.datasetId === input.dataset.datasetId,
      input.modelRun.runId,
      'Model run must reference the exact dataset.',
    ],
    [
      input.publication.content.datasetId === input.dataset.datasetId &&
        input.publication.content.modelRunId === input.modelRun.runId,
      input.publication.publicationId,
      'Publication must reference the exact dataset and model run.',
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

  const evidenceSources = input.evidence.content.sourceAuthorizations.map(
    (authorization) => authorization.sourceRegisterId
  );
  for (const [subject, sources] of [
    [input.coverageReport.reportId, input.coverageReport.content.sourceRegisterIds],
    [input.corpus.corpusId, input.corpus.content.sourceRegisterIds],
    [input.dataset.datasetId, input.dataset.content.sourceRegisterIds],
    [input.publication.publicationId, input.publication.content.sourceRegisterIds],
  ] as const) {
    if (!sameSet(evidenceSources, sources)) {
      addIssue(
        issues,
        'source_set_mismatch',
        subject,
        'Artifact source set differs from evidence.'
      );
    }
  }

  const environments = [
    input.evidence.content.environment,
    input.dataSufficiencyProtocol.content.environment,
    input.coverageReport.content.environment,
    input.corpus.content.environment,
    input.dataset.content.environment,
    input.modelRun.content.environment,
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
  if (input.modelRun.content.outcome.status !== 'succeeded') {
    addIssue(
      issues,
      'unsuccessful_model_run',
      input.modelRun.runId,
      'A publication cannot descend from an unsuccessful model run.'
    );
  }
  validateChronology(issues, [
    { id: input.evidence.manifestId, time: input.evidence.content.createdAt },
    { id: input.coverageReport.reportId, time: input.coverageReport.content.createdAt },
    { id: input.corpus.corpusId, time: input.corpus.content.createdAt },
    { id: input.dataset.datasetId, time: input.dataset.content.createdAt },
    { id: input.modelRun.runId, time: input.modelRun.content.startedAt },
    { id: input.publication.publicationId, time: input.publication.content.createdAt },
    { id: input.projection.projectionId, time: input.projection.content.createdAt },
  ]);

  return { valid: issues.length === 0, issues };
}
