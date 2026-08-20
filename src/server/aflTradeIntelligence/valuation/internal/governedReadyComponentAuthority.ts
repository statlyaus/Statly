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
}>;

export class GovernedReadyComponentAuthorityError extends Error {
  constructor(
    readonly code: 'ANCESTRY_MISMATCH' | 'NOT_CURRENT' | 'NOT_APPROVED' | 'EXPIRED',
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
    decision.authorityKind !== 'external_human_record' ||
    decision.effectiveAt === null ||
    decision.revalidateAt === null ||
    !decision.affectedArtifacts.some(
      ({ kind, artifactId }) => kind === 'model_run' && artifactId === input.runId
    )
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'NOT_APPROVED',
      'Ready component authority requires an external human Gate 3 approval for the exact run.'
    );
  }
  if (
    Date.parse(decision.effectiveAt) > Date.parse(input.capturedAt) ||
    Date.parse(decision.revalidateAt) <= Date.parse(input.capturedAt)
  ) {
    throw new GovernedReadyComponentAuthorityError(
      'EXPIRED',
      'Gate 3 component authority is outside its current revalidation window.'
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
}): GovernedReadyComponentAuthority {
  const gate3Decision = aflTradeGateDecisionRecordSchema.parse(input.gate3Decision);
  requireExactAncestry({ ...input, gate3Decision });
  requireCurrentGate3({
    runId: input.run.manifest.runId,
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
  };
}
