import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import {
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionRecord,
} from '../../governance/gateDecisionTypes';
import type { GovernedPrivateEvaluationInputTrace } from './governedPrivateEvaluationInputTrace';
import {
  governedValuationModelQualificationSchema,
  type GovernedValuationModelQualification,
} from './governedValuationModelQualification';
import type { RetainedGovernedValuationComponentRun } from './postgresGovernedValuationComponentRunRepository';

type TraceComponent = GovernedPrivateEvaluationInputTrace['content']['components'][number];

export type GovernedReadyComponentAuthority = Readonly<{
  role: TraceComponent['role'];
  runId: string;
  protocolId: string;
  datasetId: string;
  datasetAdmissionId: string;
  datasetAdmissionGateLedgerRevision: number;
  gate3DecisionId: string;
  gate3DecisionVersion: number;
  qualificationId: string;
  qualificationPolicyVersion: string;
}>;

export class GovernedReadyComponentAuthorityError extends Error {
  constructor(
    readonly code:
      | 'ANCESTRY_MISMATCH'
      | 'NOT_CURRENT'
      | 'NOT_APPROVED'
      | 'NOT_QUALIFIED'
      | 'QUALIFICATION_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'GovernedReadyComponentAuthorityError';
  }
}

function requireExactAncestry(input: {
  readonly traceComponent: TraceComponent;
  readonly run: RetainedGovernedValuationComponentRun;
  readonly gate3Decision: AflTradeGateDecisionRecord;
  readonly gate3DecisionArtifact: AflTradeArtifactRef;
}): void {
  const trace = input.traceComponent;
  const run = input.run;
  const content = run.manifest.content;
  const nativeExecutionIsEligible =
    trace.role === 'player_contribution_and_availability'
      ? content.nativeExecution.kind === 'admitted_player_model_run'
      : content.nativeExecution.kind === 'governed_pick_pav_model_execution';
  if (
    !nativeExecutionIsEligible ||
    trace.role !== content.role ||
    trace.runId !== run.manifest.runId ||
    trace.protocolId !== content.protocolId ||
    trace.datasetId !== content.datasetId ||
    trace.datasetAdmissionId !== content.datasetAdmissionId ||
    trace.gate3DecisionId !== input.gate3Decision.decisionId ||
    !doAflTradeArtifactRefsExactlyMatch(trace.evidence.runManifest, run.artifact) ||
    !doAflTradeArtifactRefsExactlyMatch(trace.evidence.protocol, content.protocolArtifact) ||
    !doAflTradeArtifactRefsExactlyMatch(
      trace.evidence.datasetAdmission,
      content.datasetAdmissionArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      trace.evidence.gate3Decision,
      input.gate3DecisionArtifact
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      input.gate3DecisionArtifact,
      input.gate3Decision
    )
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'ANCESTRY_MISMATCH',
      'Component trace, governed native execution eligibility, or Gate 3 evidence ancestry disagrees.'
    );
  }
}

function requireCurrentGate3(input: {
  readonly runId: string;
  readonly qualificationId: string;
  readonly qualificationScopeKey: string;
  readonly decision: AflTradeGateDecisionRecord;
  readonly isCurrent: boolean;
  readonly capturedAt: string;
}): void {
  const decision = input.decision.content;
  if (!input.isCurrent) {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_CURRENT',
      'Gate 3 component authority is not the current decision.'
    );
  }
  if (
    decision.gate !== 'gate_3_model_validity' ||
    decision.environment !== 'non_production' ||
    decision.state !== 'approved' ||
    decision.authorityKind !== 'automated_validation_record' ||
    decision.effectiveAt === null ||
    decision.revalidateAt !== null ||
    decision.scope.scopeKey !== input.qualificationScopeKey ||
    !decision.affectedArtifacts.some(
      ({ kind, artifactId }) => kind === 'model_run' && artifactId === input.runId
    ) ||
    !decision.affectedArtifacts.some(
      ({ kind, artifactId }) =>
        kind === 'model_qualification' && artifactId === input.qualificationId
    )
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_APPROVED',
      'Ready component authority requires the automated Gate 3 decision for the exact run and qualification.'
    );
  }
  if (Date.parse(decision.effectiveAt) > Date.parse(input.capturedAt)) {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_CURRENT',
      'Gate 3 component authority is not yet effective at the captured authority time.'
    );
  }
}

function requireExactQualification(input: {
  readonly qualification: GovernedValuationModelQualification;
  readonly qualificationArtifact: AflTradeArtifactRef;
  readonly currentQualificationId: string;
  readonly traceComponent: TraceComponent;
  readonly run: RetainedGovernedValuationComponentRun;
}): void {
  const qualification = input.qualification;
  if (qualification.content.outcome !== 'qualified') {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_QUALIFIED',
      'Ready component authority requires a passing retained model-pair qualification.'
    );
  }
  if (
    qualification.qualificationId !== input.currentQualificationId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.qualificationArtifact, qualification)
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_CURRENT',
      'Retained model-pair qualification is not the exact current qualification.'
    );
  }
  const component =
    input.traceComponent.role === 'player_contribution_and_availability'
      ? qualification.content.player
      : qualification.content.pick;
  if (
    !component.passed ||
    component.runId !== input.run.manifest.runId ||
    component.protocolId !== input.run.manifest.content.protocolId ||
    !doAflTradeArtifactRefsExactlyMatch(component.runArtifact, input.run.artifact) ||
    !doAflTradeArtifactRefsExactlyMatch(
      component.protocolArtifact,
      input.run.manifest.content.protocolArtifact
    )
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'QUALIFICATION_MISMATCH',
      'Current model-pair qualification does not authenticate this exact component run and protocol.'
    );
  }
}

export function authenticateGovernedReadyComponentAuthority(input: {
  readonly traceComponent: TraceComponent;
  readonly run: RetainedGovernedValuationComponentRun;
  readonly gate3Decision: unknown;
  readonly gate3DecisionArtifact: AflTradeArtifactRef;
  readonly gate3IsCurrent: boolean;
  readonly gateLedgerRevision: number;
  readonly capturedAt: string;
  readonly qualification: unknown;
  readonly qualificationArtifact: AflTradeArtifactRef;
  readonly currentQualificationId: string;
}): GovernedReadyComponentAuthority {
  const gate3Decision = aflTradeGateDecisionRecordSchema.parse(input.gate3Decision);
  const qualification = governedValuationModelQualificationSchema.parse(input.qualification);
  requireExactAncestry({ ...input, gate3Decision });
  requireExactQualification({ ...input, qualification });
  requireCurrentGate3({
    runId: input.run.manifest.runId,
    qualificationId: qualification.qualificationId,
    qualificationScopeKey: qualification.content.scopeKey,
    decision: gate3Decision,
    isCurrent: input.gate3IsCurrent,
    capturedAt: input.capturedAt,
  });
  const admissionRevision = input.run.manifest.content.datasetAdmissionGateLedgerRevision;
  if (
    !Number.isSafeInteger(input.gateLedgerRevision) ||
    input.gateLedgerRevision <= 0 ||
    admissionRevision > input.gateLedgerRevision
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_CURRENT',
      'Component dataset admission cannot postdate the observed Gate ledger head.'
    );
  }
  return {
    role: input.traceComponent.role,
    runId: input.traceComponent.runId,
    protocolId: input.traceComponent.protocolId,
    datasetId: input.traceComponent.datasetId,
    datasetAdmissionId: input.traceComponent.datasetAdmissionId,
    datasetAdmissionGateLedgerRevision: admissionRevision,
    gate3DecisionId: gate3Decision.decisionId,
    gate3DecisionVersion: gate3Decision.content.version,
    qualificationId: qualification.qualificationId,
    qualificationPolicyVersion: qualification.content.policy.policyVersion,
  };
}
