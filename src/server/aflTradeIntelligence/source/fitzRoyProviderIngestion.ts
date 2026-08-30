import { createAflTradeSourceSnapshotManifest } from '../artifacts/sourceSnapshotManifest';
import {
  captureAuthorizedAflTradeFitzRoyEvidence,
  type AflTradeFitzRoyCaptureCommand,
  type AflTradeFitzRoyCaptureDependencies,
} from './fitzRoyCaptureRuntime';
import {
  stageAflTradeFitzRoySourceSnapshot,
  type AflTradeFitzRoyStagingDependencies,
  type AflTradeFitzRoyStagingResult,
} from './fitzRoyCaptureToStaging';
import type { AflTradeFitzRoyCaptureReceipt } from './fitzRoyCaptureReceipt';
import type { AflTradeFitzRoyFieldMap } from './fitzRoyObservationContracts';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import { evaluateAflTradeGate0A, type AflTradeGate0ARequest } from './gate0aEvaluation';
import type { AflTradeSourceRightsProposal } from './sourceRights';

export interface AflTradeFitzRoyProviderIngestionCommand {
  capture: AflTradeFitzRoyCaptureCommand;
  fieldMapId: string;
  fieldMap: AflTradeFitzRoyFieldMap;
  effectiveAt: string;
}

export interface AflTradeFitzRoyProviderIngestionDependencies {
  capture: AflTradeFitzRoyCaptureDependencies;
  staging: AflTradeFitzRoyStagingDependencies;
  clock: { now(): string };
}

export interface AflTradeFitzRoyProviderIngestionResult {
  receipt: AflTradeFitzRoyCaptureReceipt;
  snapshotId: string;
  staging: AflTradeFitzRoyStagingResult;
}

export interface AflTradeFitzRoyProviderCaptureResult {
  receipt: AflTradeFitzRoyCaptureReceipt;
  snapshot: ReturnType<typeof createAflTradeSourceSnapshotManifest>;
}

function requireExactInstant(value: string, name: string): void {
  if (new Date(value).toISOString() !== value) {
    throw new TypeError(`${name} must be an exact UTC instant.`);
  }
}

export function requireCurrentAflTradeFitzRoyCaptureAuthority(input: {
  ledger: AflTradeGateDecisionLedger;
  sourceRights: AflTradeSourceRightsProposal;
  request: AflTradeGate0ARequest;
  capturedDecisionId: string;
  evaluatedAt: string;
}): void {
  requireExactInstant(input.evaluatedAt, 'authority evaluatedAt');
  const currentAuthorization = evaluateAflTradeGate0A(input.ledger, input.sourceRights, {
    ...input.request,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    currentAuthorization.status !== 'mechanically_eligible' ||
    currentAuthorization.decisionId !== input.capturedDecisionId
  ) {
    throw new TypeError(
      'The captured Gate authority is no longer the current effective decision at staging time.'
    );
  }
}

export async function captureAuthorizedAflTradeFitzRoyProviderSeason(
  command: AflTradeFitzRoyProviderIngestionCommand,
  dependencies: AflTradeFitzRoyProviderIngestionDependencies
): Promise<AflTradeFitzRoyProviderCaptureResult> {
  requireExactInstant(command.effectiveAt, 'effectiveAt');
  const receipt = await captureAuthorizedAflTradeFitzRoyEvidence(
    command.capture,
    dependencies.capture
  );
  const request = receipt.content.authorizationReceipt.content.request;
  const resolved =
    request.environment === 'test_fixture'
      ? { ledger: command.capture.ledger, sourceRights: command.capture.sourceRights }
      : await dependencies.capture.authorizationResolver!.resolveAuthorization(
          request.rightsArtifactId
        );
  const decisionId = receipt.content.authorizationReceipt.content.result.decisionId;
  const decision = resolved.ledger.decisions.find(
    (candidate) => candidate.decisionId === decisionId
  );
  const proposal = resolved.ledger.proposals.find(
    (candidate) => candidate.proposalId === decision?.content.proposalId
  );
  if (
    decisionId === null ||
    decision === undefined ||
    proposal === undefined ||
    resolved.sourceRights.rightsArtifactId !== request.rightsArtifactId
  ) {
    throw new TypeError('The captured Gate authority is absent from the resolved durable ledger.');
  }
  const createdAt = dependencies.clock.now();
  requireExactInstant(createdAt, 'snapshot createdAt');
  requireCurrentAflTradeFitzRoyCaptureAuthority({
    ledger: resolved.ledger,
    sourceRights: resolved.sourceRights,
    request,
    capturedDecisionId: decisionId,
    evaluatedAt: createdAt,
  });
  const accessMechanism = resolved.sourceRights.content.scope.accessMechanism;
  if (
    resolved.sourceRights.content.acquisition.kind !== 'fitzroy' ||
    (accessMechanism !== 'provider_api' && accessMechanism !== 'automated_web')
  ) {
    throw new TypeError('The resolved authority is not an automated fitzRoy source lane.');
  }
  const rate = resolved.sourceRights.content.automatedAccess.rateLimit;
  const snapshot = createAflTradeSourceSnapshotManifest({
    schemaVersion: 'afl-trade-source-snapshot/v3',
    sourceArtifact: receipt.content.sourceCustody.artifact,
    readbackReceipt: receipt.content.sourceCustody.readback,
    capture: {
      kind: 'fitzroy',
      sourceRegisterId: resolved.sourceRights.content.registerId,
      upstreamProvider: resolved.sourceRights.content.provider,
      upstreamDataset: resolved.sourceRights.content.dataset,
      upstreamDatasetVersion: resolved.sourceRights.content.datasetVersion,
      capabilityId: receipt.content.invocation.capabilityId,
      packageVersion: receipt.content.invocation.fitzRoyVersion,
      functionName: receipt.content.invocation.directFunction,
      argumentsArtifact: receipt.content.invocationCustody.artifact,
      accessMechanism,
      rateLimitContext:
        rate === null
          ? 'No automated provider request rate was authorized.'
          : `${rate.requests} request(s) per ${rate.perSeconds} second(s), burst ${rate.burst}.`,
      cacheContext:
        request.cacheSeconds === null
          ? 'No provider cache interval was authorized.'
          : `Provider request cache interval ${request.cacheSeconds} seconds.`,
    },
    sourceRightsProposal: resolved.sourceRights,
    gate0aProposal: proposal,
    gate0aDecision: decision,
    gate0aReceipt: receipt.content.authorizationReceipt,
    fitzRoyCaptureReceipt: receipt,
    capturedFields: receipt.content.diagnostics.fields.map(({ name }) => name).sort(),
    retrievedAt: receipt.content.capturedAt,
    effectiveAt: command.effectiveAt,
    retention: {
      rawRetentionDays: request.rawRetentionDays,
      deleteOnWithdrawal: resolved.sourceRights.content.retention.rawEvidence.deleteOnWithdrawal,
    },
    createdAt,
  });
  return { receipt, snapshot };
}

export async function ingestAuthorizedAflTradeFitzRoyProviderSeason(
  command: AflTradeFitzRoyProviderIngestionCommand,
  dependencies: AflTradeFitzRoyProviderIngestionDependencies
): Promise<AflTradeFitzRoyProviderIngestionResult> {
  const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(command, dependencies);
  const staging = await stageAflTradeFitzRoySourceSnapshot(
    {
      snapshot: captured.snapshot,
      fieldMapId: command.fieldMapId,
      fieldMap: command.fieldMap,
    },
    dependencies.staging
  );
  return { receipt: captured.receipt, snapshotId: captured.snapshot.snapshotId, staging };
}
