import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  createAflTradeRetainedExternalCapturePlan,
  type AflTradeRetainedExternalCapturePlan,
} from '../source/externalDraftTradeDiscoveryContracts';
import {
  AFL_TRADE_EXTERNAL_CAPTURE_EXECUTION_SCHEMA_VERSION,
  parseAflTradeExternalCaptureExecutionReceipt,
} from '../source/externalDraftTradeIngestion';
import { validateAflTradeRetainedCaptureScope } from '../source/externalDraftTradeProviderIngestion';

/**
 * The pure half of `outcomes:sources:build-retained-plan`: a successor retained plan is the
 * predecessor's targets with each new capture swapped in for the target it re-captures (equal
 * capability, anchor season and source URL), or appended when it re-captures none. See the runbook
 * section "Building a successor retained plan".
 */

export type RetainedPlanTarget = Parameters<
  typeof createAflTradeRetainedExternalCapturePlan
>[0]['targets'][number];

export interface RetainedPlanCapture {
  target: RetainedPlanTarget;
  environment: string;
  batchFinalizedAt: string;
}

export interface RetainedPlanTargetChange {
  capabilityId: string;
  anchorSeasonYear: number;
  sourceUrl: string;
  previousCaptureId: string | null;
  captureId: string;
}

export interface RetainedPlanSuccessor {
  plan: AflTradeRetainedExternalCapturePlan;
  kept: number;
  replaced: RetainedPlanTargetChange[];
  added: RetainedPlanTargetChange[];
}

/** A refusal the command reports with exit code 2; nothing has been written. */
export class RetainedPlanRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetainedPlanRefusal';
  }
}

function refuse(message: string): never {
  throw new RetainedPlanRefusal(message);
}

const captureManifestSchema = z
  .object({ artifact: aflTradeArtifactRefSchema, executionReceipt: z.unknown() })
  .passthrough();

/**
 * The retained target a stored capture supplies: its own receipt names the request, source rights
 * and Gate decision it ran under, and its manifest names the raw artifact.
 */
export function retainedTargetFromCapture(input: {
  captureId: string;
  evidenceBatchId: string;
  manifest: unknown;
}): RetainedPlanTarget {
  const manifest = captureManifestSchema.safeParse(input.manifest);
  let receipt: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt> | null = null;
  try {
    if (manifest.success) {
      receipt = parseAflTradeExternalCaptureExecutionReceipt(manifest.data.executionReceipt);
    }
  } catch {
    receipt = null;
  }
  if (
    !manifest.success ||
    receipt === null ||
    receipt.content.schemaVersion !== AFL_TRADE_EXTERNAL_CAPTURE_EXECUTION_SCHEMA_VERSION ||
    receipt.content.outcome.status !== 'captured' ||
    receipt.content.gate0aReceipt.content.result.decisionId === null
  ) {
    refuse(`Capture ${input.captureId} has no captured v2 execution receipt.`);
  }
  return {
    captureId: input.captureId,
    evidenceBatchId: input.evidenceBatchId,
    executionReceiptId: receipt.receiptId,
    rightsArtifactId: receipt.content.sourceRights.rightsArtifactId,
    gateDecisionId: receipt.content.gate0aReceipt.content.result.decisionId,
    sourceArtifact: manifest.data.artifact,
    request: receipt.content.request,
  };
}

function targetKey(target: RetainedPlanTarget): string {
  const { capabilityId, anchorSeasonYear, sourceUrl } = target.request;
  return JSON.stringify([capabilityId, anchorSeasonYear, sourceUrl]);
}

function change(target: RetainedPlanTarget, previousCaptureId: string | null) {
  const { capabilityId, anchorSeasonYear, sourceUrl } = target.request;
  return {
    capabilityId,
    anchorSeasonYear,
    sourceUrl,
    previousCaptureId,
    captureId: target.captureId,
  };
}

function after(instant: string, plannedAt: string): boolean {
  return Date.parse(instant) > Date.parse(plannedAt);
}

/** Refuses a capture that cannot join the plan as of `plannedAt`. */
function checkCapture(
  capture: RetainedPlanCapture,
  environment: string,
  plannedAt: string,
  seenCaptures: Set<string>,
  seenBatches: Set<string>
) {
  const { captureId, evidenceBatchId } = capture.target;
  if (seenCaptures.has(captureId)) {
    refuse(`Capture ${captureId} is already in the plan or given twice.`);
  }
  if (seenBatches.has(evidenceBatchId)) {
    refuse(`Evidence batch ${evidenceBatchId} is already in the plan or given twice.`);
  }
  seenCaptures.add(captureId);
  seenBatches.add(evidenceBatchId);
  if (capture.environment !== environment) {
    refuse(`Capture ${captureId} is ${capture.environment}, not ${environment}.`);
  }
  try {
    validateAflTradeRetainedCaptureScope(capture.target.request);
  } catch (error) {
    refuse(
      `Capture ${captureId} is outside its reviewed capture scope: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    after(capture.batchFinalizedAt, plannedAt) ||
    after(capture.target.request.capturedAt, plannedAt) ||
    after(capture.target.sourceArtifact.createdAt, plannedAt)
  ) {
    refuse(`Capture ${captureId} or its batch was created after plannedAt ${plannedAt}.`);
  }
}

export function planRetainedPlanSuccessor(input: {
  predecessor: AflTradeRetainedExternalCapturePlan;
  captures: readonly RetainedPlanCapture[];
  scopeEvidence: readonly AflTradeArtifactRef[];
  plannedAt: string;
}): RetainedPlanSuccessor {
  const { predecessor, plannedAt } = input;
  if (input.captures.length === 0) refuse('Give at least one capture.');
  const previous = predecessor.content.targets.map(({ content }) => {
    const { ordinal: _ordinal, ...target } = content;
    return target;
  });
  const targets = [...previous];
  const seenCaptures = new Set(previous.map((target) => target.captureId));
  const seenBatches = new Set(previous.map((target) => target.evidenceBatchId));
  const claimedKeys = new Map<string, string>();
  const replaced: RetainedPlanTargetChange[] = [];
  const added: RetainedPlanTargetChange[] = [];
  const appended: RetainedPlanTarget[] = [];
  for (const capture of input.captures) {
    checkCapture(capture, predecessor.content.environment, plannedAt, seenCaptures, seenBatches);
    const key = targetKey(capture.target);
    const { captureId } = capture.target;
    const prior = claimedKeys.get(key);
    if (prior !== undefined) {
      refuse(`Captures ${prior} and ${captureId} re-capture the same page.`);
    }
    claimedKeys.set(key, captureId);
    const matches = previous.flatMap((target, index) => (targetKey(target) === key ? [index] : []));
    if (matches.length > 1) {
      refuse(`Capture ${captureId} matches more than one target of the plan.`);
    }
    const index = matches[0];
    if (index === undefined) {
      appended.push(capture.target);
      added.push(change(capture.target, null));
    } else {
      targets[index] = capture.target;
      replaced.push(change(capture.target, previous[index]!.captureId));
    }
  }
  const carried = new Set(predecessor.content.scopeEvidence.map((ref) => ref.artifactId));
  for (const reference of input.scopeEvidence) {
    if (carried.has(reference.artifactId)) {
      refuse(`Scope evidence ${reference.artifactId} is already carried or given twice.`);
    }
    carried.add(reference.artifactId);
  }
  const scopeEvidence = [...predecessor.content.scopeEvidence, ...input.scopeEvidence];
  const late = scopeEvidence.find((reference) => after(reference.createdAt, plannedAt));
  if (late !== undefined) {
    refuse(`Scope evidence ${late.artifactId} was created after plannedAt ${plannedAt}.`);
  }
  let plan: AflTradeRetainedExternalCapturePlan;
  try {
    plan = createAflTradeRetainedExternalCapturePlan({
      environment: predecessor.content.environment,
      competition: predecessor.content.competition,
      plannedAt,
      scopeEvidence,
      targets: [...targets, ...appended],
    });
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0]?.message : undefined;
    refuse(`The successor plan fails its contract: ${issue ?? String(error)}`);
  }
  return { plan, kept: previous.length - replaced.length, replaced, added };
}
