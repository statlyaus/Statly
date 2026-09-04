import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  AFL_TRADE_VALUATION_DATASET_ADMISSION_SCHEMA_VERSION,
  aflTradeDatasetOperationAuthorizationSchema,
  aflTradeConsumedFieldSetSchema,
  aflTradeCorpusFactualLineageSchema,
  aflTradeValuationDatasetCandidateSchema,
  createAflTradeValuationDatasetAdmissionReceipt,
  type AflTradeConsumedFieldSet,
  type AflTradeCorpusFactualLineage,
  type AflTradeDatasetOperationAuthorization,
  type AflTradeValuationDatasetAdmissionReceipt,
  type AflTradeValuationDatasetCandidate,
} from '../artifacts/valuationDatasetAdmissionContracts';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  resolveAflTradeGateEligibility,
  type AflTradeGateDecisionLedger,
} from '../governance/gateDecisionLedger';
import { evaluateAflTradeGate0A } from '../source/gate0aEvaluation';
import { aflTradeGate0AReceiptSchema, type AflTradeGate0AReceipt } from '../source/gate0aReceipt';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceRights';
import {
  aflTradeProviderResolutionDecisionSchema,
  type AflTradeProviderResolutionDecision,
} from '../source/providerResolutionContracts';
import {
  aflTradeFactualReleaseCandidateSchema,
  type AflTradeFactualReleaseCandidate,
} from '../outcomes/factualReleaseCandidateContracts';
import { aflTradeSourceSnapshotManifestSchema } from '../artifacts/sourceSnapshotManifest';
import {
  authenticateAflDraftTradeOutcomeReleaseRegistry,
  type AflDraftTradeOutcomeReleaseRegistry,
} from '../outcomes/outcomeReleaseState';

export const AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION =
  'afl-trade-dataset-admission-evidence/v5' as const;

const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Admission evidence instants must use UTC Z notation.');
const contentAddressSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);

export type AflTradeValuationDatasetAdmissionBlockerCode =
  | 'AUTHENTICATOR_UNAVAILABLE'
  | 'AUTHORITY_EVIDENCE_INVALID'
  | 'DATASET_ARTIFACT_MISMATCH'
  | 'EVIDENCE_CHRONOLOGY_INVALID'
  | 'FACTUAL_ANCESTRY_MISMATCH'
  | 'FACTUAL_MEMBERSHIP_MISMATCH'
  | 'FACTUAL_RELEASE_NOT_ELIGIBLE'
  | 'GATE_2_NOT_ELIGIBLE'
  | 'GATE_2_SCOPE_MISMATCH'
  | 'IDENTITY_OR_LINEAGE_NOT_ELIGIBLE'
  | 'SOURCE_RIGHTS_EXPIRED'
  | 'SOURCE_RIGHTS_INCOMPLETE';

export interface AflTradeValuationDatasetAdmissionBlocker {
  code: AflTradeValuationDatasetAdmissionBlockerCode;
  message: string;
  subject: string;
}

export type AflTradeValuationDatasetAdmissionResult =
  | {
      status: 'admitted';
      blockers: readonly [];
      receipt: AflTradeValuationDatasetAdmissionReceipt;
    }
  | {
      status: 'blocked';
      blockers: readonly AflTradeValuationDatasetAdmissionBlocker[];
    };

export interface AflTradeValuationDatasetAdmissionRequest {
  dataset: AflTradeValuationDatasetCandidate;
  admittedAt: string;
}

/**
 * This seam owns trust acquisition. HTTP/worker callers cannot supply authority summaries to the
 * admission command. A durable adapter must load the exact retained artifacts, registry state,
 * current gate ledgers, and factual records before returning evidence.
 */
export interface AflTradeValuationDatasetAdmissionEvidenceAuthenticator {
  authenticate(input: AflTradeValuationDatasetAdmissionRequest): Promise<unknown>;
}

const resolutionHeadSchema = z
  .object({
    resolutionCaseId: contentAddressSchema,
    revision: z.number().int().positive(),
    resolutionId: z.string().regex(/^provider-resolution-decision:[a-f0-9]{64}$/),
    updatedAt: utcInstantSchema,
  })
  .strict();

const assignmentHeadSchema = z
  .object({
    assignmentCaseId: contentAddressSchema,
    entityKind: z.enum(['player', 'club', 'club_alias']),
    identityId: contentAddressSchema,
    revision: z.number().int().positive(),
    decisionId: z.string().regex(/^provider-resolution-decision:[a-f0-9]{64}$/),
    status: z.literal('active'),
    updatedAt: utcInstantSchema,
  })
  .strict();

const identityAuthorityEvidenceSchema = z
  .object({
    entityKind: z.enum(['player', 'club']),
    entityId: z.string().trim().min(1).max(400),
    decision: aflTradeProviderResolutionDecisionSchema,
    resolutionHead: resolutionHeadSchema,
    assignmentHead: assignmentHeadSchema,
    authenticatedAt: utcInstantSchema,
  })
  .strict();

const rowIdentityEvidenceSchema = z
  .object({
    playerId: z.string().trim().min(1).max(400),
    playerResolutionDecisionId: z.string().regex(/^provider-resolution-decision:[a-f0-9]{64}$/),
    playerAssignmentRevision: z.number().int().positive(),
    clubId: z.string().trim().min(1).max(400),
    clubResolutionDecisionId: z.string().regex(/^provider-resolution-decision:[a-f0-9]{64}$/),
    clubAssignmentRevision: z.number().int().positive(),
  })
  .strict();

const rowAuthorityEvidenceSchema = z
  .object({
    rowId: z.string().regex(/^valuation-dataset-row:[a-f0-9]{64}$/),
    identity: rowIdentityEvidenceSchema,
    eventId: z.string().trim().min(1).max(400),
    eventVersionId: z.string().trim().min(1).max(400),
    acquisitionSpellId: z.string().trim().min(1).max(400),
    acquisitionSpellVersionId: contentAddressSchema,
    lineageEdgeIds: z.array(contentAddressSchema).max(100),
  })
  .strict();

const byteArraySchema = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]' &&
    'length' in value &&
    typeof value.length === 'number' &&
    value.byteLength === value.length,
  'Authenticated artifact bytes must be a Uint8Array.'
);

const retainedBytesSchema = z
  .object({
    artifactId: contentAddressSchema,
    bytes: byteArraySchema,
  })
  .strict();

const domainLineageAuthoritySchema = z
  .object({
    eventVersionId: z.string().trim().min(1).max(400),
    eventId: z.string().trim().min(1).max(400),
    eventRecordSha256: z.string().regex(/^[a-f0-9]{64}$/),
    acquisitionSpellId: z.string().trim().min(1).max(400),
    acquisitionSpellVersionId: contentAddressSchema,
    playerId: z.string().trim().min(1).max(400),
    clubId: z.string().trim().min(1).max(400),
    lineageEdges: z
      .array(
        z
          .object({
            edgeId: z.string().trim().min(1).max(400),
            recordSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .max(100),
    authenticatedAt: utcInstantSchema,
  })
  .strict();

interface SourceRightsEvidence {
  captureId: string;
  sourceSnapshotId: string;
  consumedFieldSetId: string;
  sourceSnapshotManifest: z.infer<typeof modelSourceSnapshotEvidenceSchema>;
  rightsProposal: AflTradeSourceRightsProposal;
  derivationReceipt: AflTradeGate0AReceipt;
  admissionReceipt: AflTradeGate0AReceipt;
  gateLedger: AflTradeGateDecisionLedger;
}

const normalizedModelSourceSnapshotEvidenceSchema = z
  .object({
    snapshotId: z.string().regex(/^source-snapshot:[a-f0-9]{64}$/),
    content: z
      .object({
        capturedFields: z.array(z.string().trim().min(1).max(200)).min(1).max(1000),
        createdAt: utcInstantSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      new Set(snapshot.content.capturedFields).size !== snapshot.content.capturedFields.length ||
      snapshot.content.capturedFields.some(
        (field, index) => index > 0 && snapshot.content.capturedFields[index - 1]! > field
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['content', 'capturedFields'],
        message: 'Model source snapshot fields must be unique and sorted.',
      });
    }
  });

const modelSourceSnapshotEvidenceSchema = z.union([
  aflTradeSourceSnapshotManifestSchema,
  normalizedModelSourceSnapshotEvidenceSchema,
]);

interface AuthenticatedAdmissionEvidence {
  schemaVersion: typeof AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION;
  authenticatedAt: string;
  factualCandidate: AflTradeFactualReleaseCandidate;
  factualCandidateFinalizedAt: string;
  releaseRegistry: AflDraftTradeOutcomeReleaseRegistry;
  corpusLineage: AflTradeCorpusFactualLineage;
  consumedFieldSets: readonly AflTradeConsumedFieldSet[];
  gate2Ledger: AflTradeGateDecisionLedger;
  gate2DecisionKey: string;
  sourceRights: readonly SourceRightsEvidence[];
  identityAuthorities: readonly z.infer<typeof identityAuthorityEvidenceSchema>[];
  domainLineageAuthorities: readonly z.infer<typeof domainLineageAuthoritySchema>[];
  rowAuthorities: readonly z.infer<typeof rowAuthorityEvidenceSchema>[];
  artifactBytes: readonly z.infer<typeof retainedBytesSchema>[];
  analyticalAuthority: AflTradeDatasetOperationAuthorization;
  operationalAuthorization: AflTradeDatasetOperationAuthorization;
}

function time(value: string | null | undefined): number {
  return value == null ? Number.NaN : Date.parse(value);
}

function blocker(
  blockers: AflTradeValuationDatasetAdmissionBlocker[],
  code: AflTradeValuationDatasetAdmissionBlockerCode,
  subject: string,
  message: string
) {
  blockers.push({ code, message, subject });
}

function parseAuthenticatedEvidence(value: unknown): AuthenticatedAdmissionEvidence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const factualCandidate = aflTradeFactualReleaseCandidateSchema.safeParse(
    candidate.factualCandidate
  );
  const corpusLineage = aflTradeCorpusFactualLineageSchema.safeParse(candidate.corpusLineage);
  const consumedFieldSets = z
    .array(aflTradeConsumedFieldSetSchema)
    .safeParse(candidate.consumedFieldSets);
  const identityAuthorities = z
    .array(identityAuthorityEvidenceSchema)
    .safeParse(candidate.identityAuthorities);
  const domainLineageAuthorities = z
    .array(domainLineageAuthoritySchema)
    .safeParse(candidate.domainLineageAuthorities);
  const rowAuthorities = z.array(rowAuthorityEvidenceSchema).safeParse(candidate.rowAuthorities);
  const artifactBytes = z.array(retainedBytesSchema).safeParse(candidate.artifactBytes);
  const analyticalAuthority = aflTradeDatasetOperationAuthorizationSchema.safeParse(
    candidate.analyticalAuthority
  );
  const operationalAuthorization = aflTradeDatasetOperationAuthorizationSchema.safeParse(
    candidate.operationalAuthorization
  );
  let releaseRegistry: AflDraftTradeOutcomeReleaseRegistry;
  try {
    releaseRegistry = authenticateAflDraftTradeOutcomeReleaseRegistry(
      candidate.releaseRegistry as AflDraftTradeOutcomeReleaseRegistry
    );
  } catch {
    return null;
  }
  if (
    candidate.schemaVersion !== AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION ||
    !utcInstantSchema.safeParse(candidate.authenticatedAt).success ||
    !utcInstantSchema.safeParse(candidate.factualCandidateFinalizedAt).success ||
    !factualCandidate.success ||
    !corpusLineage.success ||
    !consumedFieldSets.success ||
    !identityAuthorities.success ||
    !domainLineageAuthorities.success ||
    !rowAuthorities.success ||
    !artifactBytes.success ||
    !analyticalAuthority.success ||
    !operationalAuthorization.success ||
    typeof candidate.gate2DecisionKey !== 'string' ||
    !Array.isArray((candidate.gate2Ledger as { proposals?: unknown })?.proposals) ||
    !Array.isArray((candidate.gate2Ledger as { decisions?: unknown })?.decisions) ||
    !Array.isArray(candidate.sourceRights)
  ) {
    return null;
  }
  const sourceRights: SourceRightsEvidence[] = [];
  for (const raw of candidate.sourceRights) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    const rights = aflTradeSourceRightsProposalSchema.safeParse(entry.rightsProposal);
    const derivation = aflTradeGate0AReceiptSchema.safeParse(entry.derivationReceipt);
    const admission = aflTradeGate0AReceiptSchema.safeParse(entry.admissionReceipt);
    const sourceSnapshotManifest = modelSourceSnapshotEvidenceSchema.safeParse(
      entry.sourceSnapshotManifest
    );
    if (
      typeof entry.captureId !== 'string' ||
      typeof entry.sourceSnapshotId !== 'string' ||
      !entry.sourceSnapshotId.startsWith('source-snapshot:') ||
      typeof entry.consumedFieldSetId !== 'string' ||
      !entry.consumedFieldSetId.startsWith('consumed-field-set:') ||
      !sourceSnapshotManifest.success ||
      !rights.success ||
      !derivation.success ||
      !admission.success ||
      !Array.isArray((entry.gateLedger as { proposals?: unknown })?.proposals) ||
      !Array.isArray((entry.gateLedger as { decisions?: unknown })?.decisions)
    ) {
      return null;
    }
    sourceRights.push({
      captureId: entry.captureId,
      sourceSnapshotId: entry.sourceSnapshotId,
      consumedFieldSetId: entry.consumedFieldSetId,
      sourceSnapshotManifest: sourceSnapshotManifest.data,
      rightsProposal: rights.data,
      derivationReceipt: derivation.data,
      admissionReceipt: admission.data,
      gateLedger: entry.gateLedger as AflTradeGateDecisionLedger,
    });
  }
  return {
    schemaVersion: AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION,
    authenticatedAt: candidate.authenticatedAt as string,
    factualCandidate: factualCandidate.data,
    factualCandidateFinalizedAt: candidate.factualCandidateFinalizedAt as string,
    releaseRegistry,
    corpusLineage: corpusLineage.data,
    consumedFieldSets: consumedFieldSets.data,
    gate2Ledger: candidate.gate2Ledger as AflTradeGateDecisionLedger,
    gate2DecisionKey: candidate.gate2DecisionKey,
    sourceRights,
    identityAuthorities: identityAuthorities.data,
    domainLineageAuthorities: domainLineageAuthorities.data,
    rowAuthorities: rowAuthorities.data,
    artifactBytes: artifactBytes.data,
    analyticalAuthority: analyticalAuthority.data,
    operationalAuthorization: operationalAuthorization.data,
  };
}

function validateFactualAuthority(
  dataset: AflTradeValuationDatasetCandidate,
  evidence: AuthenticatedAdmissionEvidence,
  admittedAt: string,
  blockers: AflTradeValuationDatasetAdmissionBlocker[]
) {
  const parent = dataset.content.factualParent;
  const candidate = evidence.factualCandidate;
  const lineage = evidence.corpusLineage;
  const registry = evidence.releaseRegistry;
  const recordState = registry.releases[parent.factualReleaseId];
  const recordStateId = recordState
    ? createAflTradeContentAddress('outcome-release-record-state', recordState)
    : null;
  const approvalEvent = registry.events.find(
    ({ eventId }) => eventId === parent.releaseApprovalEventId
  );
  const currentCycleRevision =
    recordState?.events.filter(({ action }) => action === 'validate').at(-1)?.revision ?? 0;
  const latestApprovalRecordEvent = recordState?.events
    .filter(({ action, revision }) => action === 'approve' && revision > currentCycleRevision)
    .at(-1);
  const latestApprovalRegistryEvent = latestApprovalRecordEvent
    ? registry.events[latestApprovalRecordEvent.revision - 1]
    : undefined;
  const releaseState = recordState?.state;
  if (releaseState !== 'approved' && releaseState !== 'published') {
    blocker(
      blockers,
      'FACTUAL_RELEASE_NOT_ELIGIBLE',
      parent.factualReleaseId,
      'Only a currently approved or published factual release may supply a valuation dataset.'
    );
  }
  if (
    candidate.candidateId !== parent.factualCandidateId ||
    candidate.content.targetRelease.id !== parent.factualReleaseId ||
    candidate.content.memberSetSha256 !== parent.sourceMemberSetSha256 ||
    candidate.content.archiveDataset.id !== parent.archiveDatasetId ||
    candidate.content.sourceSnapshotSet.id !== parent.sourceSnapshotSetId ||
    candidate.content.metricRegistryVersion !== parent.metricRegistryVersion ||
    candidate.content.acquisitionSpellRule.id !== parent.acquisitionSpellRuleId ||
    candidate.content.effectiveThrough !== parent.factualEffectiveThrough ||
    candidate.content.environment !== dataset.content.environment ||
    candidate.content.scopeKey !== dataset.content.scopeKey ||
    candidate.content.competition !== dataset.content.competition ||
    lineage.lineageId !== parent.corpusToCandidateLineageId ||
    lineage.content.environment !== dataset.content.environment ||
    lineage.content.scopeKey !== dataset.content.scopeKey ||
    lineage.content.competition !== dataset.content.competition ||
    lineage.content.corpusId !== parent.corpusId ||
    lineage.content.factualReleaseId !== parent.factualReleaseId ||
    lineage.content.factualCandidateId !== parent.factualCandidateId ||
    lineage.content.sourceMemberSetSha256 !== parent.sourceMemberSetSha256 ||
    !recordState ||
    recordState.releaseId !== parent.factualReleaseId ||
    recordState.scopeKey !== dataset.content.scopeKey ||
    recordStateId !== parent.releaseRecordStateId ||
    registry.revision !== parent.releaseRegistryRevision ||
    approvalEvent === undefined ||
    approvalEvent.content.action !== 'approve' ||
    approvalEvent.content.releaseId !== parent.factualReleaseId ||
    approvalEvent.content.to !== 'approved' ||
    approvalEvent.eventId !== latestApprovalRegistryEvent?.eventId ||
    approvalEvent.content.revision !== latestApprovalRecordEvent?.revision ||
    approvalEvent.content.gateDecisionId !== recordState.factualReviewDecisionId ||
    latestApprovalRecordEvent?.gateDecisionId !== recordState.factualReviewDecisionId ||
    !approvalEvent.content.affectedRecordStates.some(
      (affected) =>
        affected.releaseId === parent.factualReleaseId && affected.recordState.state === 'approved'
    ) ||
    sha256AflTradeCanonicalJson(recordState.releaseManifest) !==
      sha256AflTradeCanonicalJson(candidate.content.targetReleaseManifest)
  ) {
    blocker(
      blockers,
      'FACTUAL_ANCESTRY_MISMATCH',
      dataset.datasetId,
      'Authenticated factual release, candidate, registry state, and member root must match.'
    );
  }
  if (
    evidence.factualCandidateFinalizedAt !== candidate.content.createdAt ||
    time(evidence.factualCandidateFinalizedAt) > time(dataset.content.createdAt) ||
    time(candidate.content.createdAt) > time(dataset.content.createdAt) ||
    time(lineage.content.createdAt) > time(dataset.content.createdAt) ||
    time(evidence.factualCandidateFinalizedAt) > time(lineage.content.createdAt) ||
    (approvalEvent !== undefined &&
      (time(approvalEvent.content.occurredAt) > time(dataset.content.createdAt) ||
        time(approvalEvent.content.occurredAt) > time(lineage.content.createdAt))) ||
    time(evidence.authenticatedAt) > time(admittedAt)
  ) {
    blocker(
      blockers,
      'EVIDENCE_CHRONOLOGY_INVALID',
      candidate.candidateId,
      'Factual finalization and authority authentication must precede their dependent operation.'
    );
  }
}

type FactualInput =
  AflTradeValuationDatasetCandidate['content']['rows'][number]['content']['featureInputs'][number];

function candidateMemberFor(candidate: AflTradeFactualReleaseCandidate, input: FactualInput) {
  if (input.kind === 'reconciled_achievement') {
    return candidate.content.members.reconciledAchievements.find(
      ({ reconciledAchievementId }) => reconciledAchievementId === input.memberId
    );
  }
  return candidate.content.members.spellMetrics.find(
    ({ spellMetricVersionId }) => spellMetricVersionId === input.memberId
  );
}

function candidateMemberMappings(candidate: AflTradeFactualReleaseCandidate) {
  const members = candidate.content.members;
  return [
    ...members.sourceCaptures.map((member) => ({
      kind: 'source_capture' as const,
      memberId: member.captureId,
      recordSha256: member.recordSha256,
    })),
    ...members.eventVersions.map((member) => ({
      kind: 'event_version' as const,
      memberId: member.eventVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.lineageEdges.map((member) => ({
      kind: 'lineage_edge' as const,
      memberId: member.edgeId,
      recordSha256: member.recordSha256,
    })),
    ...members.acquisitionSpells.map((member) => ({
      kind: 'acquisition_spell' as const,
      memberId: member.spellVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.factualRuns.map((member) => ({
      kind: 'factual_run' as const,
      memberId: member.factualRunId,
      recordSha256: member.recordSha256,
    })),
    ...members.reconciledMetrics.map((member) => ({
      kind: 'reconciled_metric' as const,
      memberId: member.reconciledFactId,
      recordSha256: member.recordSha256,
    })),
    ...members.achievementRuns.map((member) => ({
      kind: 'achievement_run' as const,
      memberId: member.achievementRunId,
      recordSha256: member.recordSha256,
    })),
    ...members.reconciledAchievements.map((member) => ({
      kind: 'reconciled_achievement' as const,
      memberId: member.reconciledAchievementId,
      recordSha256: member.recordSha256,
    })),
    ...members.spellMetrics.map((member) => ({
      kind: 'spell_metric' as const,
      memberId: member.spellMetricVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.reviewDecisions.map((member) => ({
      kind: 'review_decision' as const,
      memberId: member.decisionId,
      recordSha256: member.recordSha256,
    })),
  ].sort((left, right) =>
    `${left.kind}|${left.memberId}`.localeCompare(`${right.kind}|${right.memberId}`)
  );
}

function bytesSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  );
}

function reusableIdentityBinding(
  decision: AflTradeProviderResolutionDecision,
  entityKind: 'player' | 'club'
) {
  if (decision.content.outcome !== 'approved' || decision.content.assignmentRevision === null) {
    return null;
  }
  const proposal = decision.content.proposal.content;
  if (entityKind === 'player') {
    if (proposal.subjectType !== 'provider_player_candidate') return null;
    const target = proposal.proposedTarget;
    if (target?.scope !== 'provider_identity') return null;
    return {
      entityId: target.playerId,
      assignmentCaseId: target.assignmentCaseId,
      assignmentEntityKind: 'player' as const,
      assignmentIdentityId: target.playerIdentityId,
      validFromSeason: proposal.staging.nativeIdNamespace?.validFromSeason ?? null,
      validThroughSeason: proposal.staging.nativeIdNamespace?.validThroughSeason ?? null,
    };
  }
  if (proposal.subjectType !== 'provider_club_candidate') return null;
  const target = proposal.proposedTarget;
  if (target === null) return null;
  return {
    entityId: target.clubId,
    assignmentCaseId: target.assignmentCaseId,
    assignmentEntityKind:
      target.scope === 'provider_identity' ? ('club' as const) : ('club_alias' as const),
    assignmentIdentityId:
      target.scope === 'provider_identity' ? target.clubIdentityId : target.aliasId,
    validFromSeason:
      target.scope === 'provider_identity'
        ? (proposal.staging.nativeIdNamespace?.validFromSeason ?? null)
        : target.validFromSeason,
    validThroughSeason:
      target.scope === 'provider_identity'
        ? (proposal.staging.nativeIdNamespace?.validThroughSeason ?? null)
        : target.validThroughSeason,
  };
}

function identityAuthorityMatches(
  authority: z.infer<typeof identityAuthorityEvidenceSchema>,
  entityKind: 'player' | 'club',
  entityId: string,
  decisionId: string,
  assignmentRevision: number,
  dataset: AflTradeValuationDatasetCandidate,
  row: AflTradeValuationDatasetCandidate['content']['rows'][number]['content']
): boolean {
  const decision = authority.decision;
  const proposal = decision.content.proposal.content;
  const staging = proposal.staging;
  const reviewer = decision.content.reviewerAuthority;
  const namespace = staging.nativeIdNamespace;
  const binding = reusableIdentityBinding(decision, entityKind);
  const assignment = decision.content.assignmentRevision;
  return (
    binding !== null &&
    assignment !== null &&
    authority.entityKind === entityKind &&
    authority.entityId === entityId &&
    decision.decisionId === decisionId &&
    binding.entityId === entityId &&
    assignment.assignmentCaseId === binding.assignmentCaseId &&
    assignment.entityKind === binding.assignmentEntityKind &&
    assignment.identityId === binding.assignmentIdentityId &&
    assignment.nextStatus === 'active' &&
    assignment.expectedRevision + 1 === assignmentRevision &&
    authority.resolutionHead.resolutionCaseId ===
      decision.content.proposal.content.resolutionCaseId &&
    authority.resolutionHead.revision === decision.content.expectedRevision + 1 &&
    authority.resolutionHead.resolutionId === decision.decisionId &&
    authority.resolutionHead.updatedAt === decision.content.decidedAt &&
    authority.assignmentHead.assignmentCaseId === binding.assignmentCaseId &&
    authority.assignmentHead.entityKind === binding.assignmentEntityKind &&
    authority.assignmentHead.identityId === binding.assignmentIdentityId &&
    authority.assignmentHead.revision === assignmentRevision &&
    authority.assignmentHead.decisionId === decision.decisionId &&
    authority.assignmentHead.updatedAt === decision.content.decidedAt &&
    staging.environment === dataset.content.environment &&
    staging.competition === dataset.content.competition &&
    staging.competition === row.competition &&
    staging.seasonYear === row.seasonYear &&
    reviewer.scopeKey === dataset.content.scopeKey &&
    reviewer.competition === row.competition &&
    reviewer.validFromSeason <= row.seasonYear &&
    reviewer.validThroughSeason >= row.seasonYear &&
    binding.validFromSeason !== null &&
    binding.validThroughSeason !== null &&
    binding.validFromSeason <= row.seasonYear &&
    binding.validThroughSeason >= row.seasonYear &&
    (namespace === null ||
      (namespace.environment === dataset.content.environment &&
        namespace.validFromSeason <= row.seasonYear &&
        namespace.validThroughSeason >= row.seasonYear &&
        (namespace.identityScope.kind === 'global' ||
          namespace.identityScope.competition === row.competition))) &&
    time(decision.content.decidedAt) <= time(authority.authenticatedAt) &&
    time(authority.authenticatedAt) <= time(dataset.content.createdAt)
  );
}

function memberMatchesInputAndRow(
  candidate: AflTradeFactualReleaseCandidate,
  row: AflTradeValuationDatasetCandidate['content']['rows'][number]['content'],
  input: FactualInput
): boolean {
  if (input.kind === 'acquisition_spell_metric') {
    const member = candidate.content.members.spellMetrics.find(
      ({ spellMetricVersionId }) => spellMetricVersionId === input.memberId
    );
    const spell = candidate.content.members.acquisitionSpells.find(
      ({ spellVersionId }) => spellVersionId === input.spellVersionId
    );
    return (
      member?.recordSha256 === input.recordSha256 &&
      member.recordedAt === input.recordedAt &&
      member.headRevision === input.headRevision &&
      member.state === input.state &&
      member.effectiveThrough === input.effectiveThrough &&
      member.spellVersionId === input.spellVersionId &&
      member.playerId === input.playerId &&
      member.clubId === input.clubId &&
      member.metricCode === input.metricCode &&
      input.playerId === row.identity.playerId &&
      input.clubId === row.identity.clubId &&
      spell?.spellVersionId === row.lineage.acquisitionSpellVersionId &&
      spell.playerId === row.identity.playerId &&
      spell.clubId === row.identity.clubId &&
      spell.startDate <= input.effectiveFrom &&
      (spell.endDate === null || spell.endDate >= input.effectiveThrough)
    );
  }
  const member = candidate.content.members.reconciledAchievements.find(
    ({ reconciledAchievementId }) => reconciledAchievementId === input.memberId
  );
  if (
    !member ||
    member.recordSha256 !== input.recordSha256 ||
    member.recordedAt !== input.recordedAt ||
    member.headRevision !== input.headRevision ||
    member.state !== input.state ||
    member.effectiveThrough !== input.effectiveThrough ||
    member.playerId !== input.playerId ||
    member.clubId !== input.clubId ||
    member.competition !== input.competition ||
    member.seasonYear !== input.seasonYear ||
    input.competition !== row.competition ||
    input.seasonYear !== row.seasonYear ||
    input.effectiveFrom !== `${input.seasonYear}-01-01` ||
    input.playerId !== row.identity.playerId ||
    (input.clubId !== null && input.clubId !== row.identity.clubId)
  ) {
    return false;
  }
  return (
    'achievementCode' in member &&
    member.achievementCode === input.achievementCode &&
    member.grain === 'season'
  );
}

function validateMembership(
  dataset: AflTradeValuationDatasetCandidate,
  evidence: AuthenticatedAdmissionEvidence,
  blockers: AflTradeValuationDatasetAdmissionBlocker[]
) {
  const candidate = evidence.factualCandidate;
  const inputEntries = dataset.content.rows.flatMap((row) =>
    [...row.content.featureInputs, ...row.content.targetInputs].map((input) => ({ row, input }))
  );
  const invalidMember = inputEntries.some(({ row, input }) => {
    const member = candidateMemberFor(candidate, input);
    return !member || !memberMatchesInputAndRow(candidate, row.content, input);
  });
  if (invalidMember) {
    blocker(
      blockers,
      'FACTUAL_MEMBERSHIP_MISMATCH',
      dataset.datasetId,
      'Every feature and target must match one exact sealed factual member and authenticated record.'
    );
  }
  const expectedMappings = candidateMemberMappings(candidate);
  const lineage = evidence.corpusLineage;
  if (
    sha256AflTradeCanonicalJson(lineage.content.memberMappings) !==
      sha256AflTradeCanonicalJson(expectedMappings) ||
    lineage.content.memberMappingSetSha256 !== sha256AflTradeCanonicalJson(expectedMappings)
  ) {
    blocker(
      blockers,
      'FACTUAL_ANCESTRY_MISMATCH',
      lineage.lineageId,
      'Corpus lineage must map the complete exact typed factual candidate member set.'
    );
  }
  const authorityByRow = new Map(
    evidence.rowAuthorities.map((authority) => [authority.rowId, authority])
  );
  const identityAuthorities = new Map(
    evidence.identityAuthorities.map((authority) => [
      `${authority.entityKind}|${authority.decision.decisionId}`,
      authority,
    ])
  );
  const requiredIdentityAuthorities = new Set(
    dataset.content.rows.flatMap(({ content }) => [
      `player|${content.identity.playerResolutionDecisionId}`,
      `club|${content.identity.clubResolutionDecisionId}`,
    ])
  );
  const eventMembers = new Map(
    candidate.content.members.eventVersions.map((member) => [member.eventVersionId, member])
  );
  const spellMembers = new Map(
    candidate.content.members.acquisitionSpells.map((member) => [member.spellVersionId, member])
  );
  const edgeMembers = new Map(
    candidate.content.members.lineageEdges.map((member) => [member.edgeId, member])
  );
  const domainAuthorities = new Map(
    evidence.domainLineageAuthorities.map((authority) => [
      `${authority.eventVersionId}|${authority.acquisitionSpellVersionId}`,
      authority,
    ])
  );
  const representedEvents = new Set<string>();
  const representedSpells = new Set<string>();
  const representedEdges = new Set<string>();
  const derivedDomainMappings = evidence.domainLineageAuthorities
    .map((authority) => {
      representedEvents.add(authority.eventVersionId);
      representedSpells.add(authority.acquisitionSpellVersionId);
      authority.lineageEdges.forEach(({ edgeId }) => representedEdges.add(edgeId));
      return {
        eventId: authority.eventId,
        eventVersionId: authority.eventVersionId,
        acquisitionSpellId: authority.acquisitionSpellId,
        acquisitionSpellVersionId: authority.acquisitionSpellVersionId,
        playerId: authority.playerId,
        clubId: authority.clubId,
        lineageEdgeIds: authority.lineageEdges.map(({ edgeId }) => edgeId).sort(),
      };
    })
    .sort((left, right) =>
      `${left.eventVersionId}|${left.acquisitionSpellVersionId}`.localeCompare(
        `${right.eventVersionId}|${right.acquisitionSpellVersionId}`
      )
    );
  const invalidDomainAuthority = evidence.domainLineageAuthorities.some((authority) => {
    const event = eventMembers.get(authority.eventVersionId);
    const spell = spellMembers.get(authority.acquisitionSpellVersionId);
    return (
      !event ||
      !spell ||
      event.eventId !== authority.eventId ||
      event.recordSha256 !== authority.eventRecordSha256 ||
      spell.spellId !== authority.acquisitionSpellId ||
      spell.playerId !== authority.playerId ||
      spell.clubId !== authority.clubId ||
      time(authority.authenticatedAt) > time(dataset.content.createdAt) ||
      new Set(authority.lineageEdges.map(({ edgeId }) => edgeId)).size !==
        authority.lineageEdges.length ||
      authority.lineageEdges.some(({ edgeId, recordSha256 }) => {
        const edge = edgeMembers.get(edgeId);
        return !edge || edge.recordSha256 !== recordSha256;
      })
    );
  });
  const invalidDomainClosure =
    domainAuthorities.size !== evidence.domainLineageAuthorities.length ||
    representedEvents.size !== eventMembers.size ||
    [...eventMembers.keys()].some((eventVersionId) => !representedEvents.has(eventVersionId)) ||
    representedSpells.size !== spellMembers.size ||
    [...spellMembers.keys()].some((spellVersionId) => !representedSpells.has(spellVersionId)) ||
    representedEdges.size !== edgeMembers.size ||
    [...edgeMembers.keys()].some((edgeId) => !representedEdges.has(edgeId)) ||
    invalidDomainAuthority ||
    sha256AflTradeCanonicalJson(lineage.content.domainLineageMappings) !==
      sha256AflTradeCanonicalJson(derivedDomainMappings);
  const domainLineage = new Set(
    derivedDomainMappings.map((mapping) => sha256AflTradeCanonicalJson(mapping))
  );
  const invalidRowAuthority = dataset.content.rows.some((row) => {
    const content = row.content;
    const authority = authorityByRow.get(row.rowId);
    if (
      !authority ||
      sha256AflTradeCanonicalJson(authority.identity) !==
        sha256AflTradeCanonicalJson(content.identity) ||
      authority.eventVersionId !== content.lineage.eventVersionId ||
      authority.eventId !== content.lineage.eventId ||
      authority.acquisitionSpellId !== content.lineage.acquisitionSpellId ||
      authority.acquisitionSpellVersionId !== content.lineage.acquisitionSpellVersionId ||
      sha256AflTradeCanonicalJson(authority.lineageEdgeIds) !==
        sha256AflTradeCanonicalJson(content.lineage.lineageEdgeIds)
    )
      return true;
    const playerAuthority = identityAuthorities.get(
      `player|${content.identity.playerResolutionDecisionId}`
    );
    const clubAuthority = identityAuthorities.get(
      `club|${content.identity.clubResolutionDecisionId}`
    );
    const mapping = {
      eventId: content.lineage.eventId,
      eventVersionId: content.lineage.eventVersionId,
      acquisitionSpellId: content.lineage.acquisitionSpellId,
      acquisitionSpellVersionId: content.lineage.acquisitionSpellVersionId,
      playerId: content.identity.playerId,
      clubId: content.identity.clubId,
      lineageEdgeIds: content.lineage.lineageEdgeIds,
    };
    return (
      !playerAuthority ||
      !clubAuthority ||
      !identityAuthorityMatches(
        playerAuthority,
        'player',
        content.identity.playerId,
        content.identity.playerResolutionDecisionId,
        content.identity.playerAssignmentRevision,
        dataset,
        content
      ) ||
      !identityAuthorityMatches(
        clubAuthority,
        'club',
        content.identity.clubId,
        content.identity.clubResolutionDecisionId,
        content.identity.clubAssignmentRevision,
        dataset,
        content
      ) ||
      !domainLineage.has(sha256AflTradeCanonicalJson(mapping))
    );
  });
  if (
    authorityByRow.size !== evidence.rowAuthorities.length ||
    authorityByRow.size !== dataset.content.rows.length ||
    identityAuthorities.size !== evidence.identityAuthorities.length ||
    identityAuthorities.size !== requiredIdentityAuthorities.size ||
    [...requiredIdentityAuthorities].some((key) => !identityAuthorities.has(key)) ||
    invalidDomainClosure ||
    invalidRowAuthority
  ) {
    blocker(
      blockers,
      'IDENTITY_OR_LINEAGE_NOT_ELIGIBLE',
      dataset.datasetId,
      'Every row requires current approved identity and exact sealed event, spell, and lineage evidence.'
    );
  }
}

function validateArtifacts(
  dataset: AflTradeValuationDatasetCandidate,
  evidence: AuthenticatedAdmissionEvidence,
  admittedAt: string,
  blockers: AflTradeValuationDatasetAdmissionBlocker[]
) {
  const specification = dataset.content.specification.content;
  const expectedReferences = [
    dataset.content.datasetArtifact,
    dataset.content.exclusionReport,
    dataset.content.extractor.codeArtifact,
    dataset.content.extractor.configurationArtifact,
    ...specification.featureDefinitions,
    specification.targetDefinition,
    specification.valueUnitDefinition,
    specification.roleTaxonomy,
    specification.eraDefinition,
    specification.censoringDefinition,
    specification.inclusionPolicy,
  ];
  const expectedById = new Map(
    expectedReferences.map((reference) => [reference.artifactId, reference])
  );
  const bytesById = new Map(
    evidence.artifactBytes.map((artifact) => [artifact.artifactId, artifact])
  );
  const invalidBytes = [...expectedById.values()].some((reference) => {
    const retained = bytesById.get(reference.artifactId);
    return (
      !retained ||
      retained.bytes.byteLength !== reference.byteLength ||
      bytesSha256(retained.bytes) !== reference.contentSha256 ||
      time(reference.createdAt) > time(dataset.content.createdAt) ||
      time(reference.createdAt) > time(admittedAt)
    );
  });
  const datasetBytes = bytesById.get(dataset.content.datasetArtifact.artifactId)?.bytes;
  const expectedDatasetBytes = new TextEncoder().encode(
    canonicalizeAflTradeJson(dataset.content.rows)
  );
  const invalid =
    bytesById.size !== evidence.artifactBytes.length ||
    bytesById.size !== expectedById.size ||
    invalidBytes ||
    !datasetBytes ||
    dataset.content.datasetArtifact.mediaType !== 'application/json' ||
    !bytesEqual(datasetBytes, expectedDatasetBytes) ||
    dataset.content.rowSetSha256 !== sha256AflTradeCanonicalJson(dataset.content.rows);
  if (invalid) {
    blocker(
      blockers,
      'DATASET_ARTIFACT_MISMATCH',
      dataset.datasetId,
      'Every retained dataset and executable specification artifact must match its exact bytes and chronology.'
    );
  }
}

function validateGate2(
  dataset: AflTradeValuationDatasetCandidate,
  evidence: AuthenticatedAdmissionEvidence,
  admittedAt: string,
  blockers: AflTradeValuationDatasetAdmissionBlocker[]
) {
  const resolution = resolveAflTradeGateEligibility(evidence.gate2Ledger, {
    gate: 'gate_2_corpus_lineage',
    decisionKey: evidence.gate2DecisionKey,
    environment: dataset.content.environment,
    evaluatedAt: admittedAt,
  });
  const decision = resolution.decision;
  if (resolution.status !== 'mechanically_eligible' || decision === null) {
    blocker(
      blockers,
      'GATE_2_NOT_ELIGIBLE',
      evidence.gate2DecisionKey,
      'Canonical Gate 2 resolution must be current and mechanically eligible at admission.'
    );
    return null;
  }
  const parent = dataset.content.factualParent;
  const requirements = [
    ['corpus_manifest', parent.corpusId],
    ['corpus_factual_lineage', parent.corpusToCandidateLineageId],
    ['factual_release', parent.factualReleaseId],
    ['factual_release_candidate', parent.factualCandidateId],
  ] as const;
  if (
    requirements.some(
      ([kind, artifactId]) =>
        !decision.content.affectedArtifacts.some(
          (artifact) => artifact.kind === kind && artifact.artifactId === artifactId
        )
    )
  ) {
    blocker(
      blockers,
      'GATE_2_SCOPE_MISMATCH',
      decision.decisionId,
      'Gate 2 must pin the exact corpus-to-factual-candidate lineage and release.'
    );
  }
  if (
    time(decision.content.decidedAt) > time(dataset.content.createdAt) ||
    time(decision.content.effectiveAt) > time(dataset.content.createdAt) ||
    time(evidence.corpusLineage.content.createdAt) > time(decision.content.decidedAt)
  ) {
    blocker(
      blockers,
      'EVIDENCE_CHRONOLOGY_INVALID',
      decision.decisionId,
      'Gate 2 and its exact corpus lineage must predate dataset materialization.'
    );
  }
  return decision;
}

function sameGate0ARequestExceptTime(
  left: AflTradeGate0AReceipt['content']['request'],
  right: AflTradeGate0AReceipt['content']['request']
): boolean {
  const { evaluatedAt: _leftTime, ...leftStable } = left;
  const { evaluatedAt: _rightTime, ...rightStable } = right;
  return sha256AflTradeCanonicalJson(leftStable) === sha256AflTradeCanonicalJson(rightStable);
}

function includesRequiredUses(request: AflTradeGate0AReceipt['content']['request']): boolean {
  const operations = new Set(request.operations);
  if (!operations.has('derived_feature_creation') || !operations.has('model_training'))
    return false;
  const usesByField = new Map<string, Set<string>>();
  for (const { sourceField, use } of request.fieldUses) {
    const uses = usesByField.get(sourceField) ?? new Set<string>();
    uses.add(use);
    usesByField.set(sourceField, uses);
  }
  return (
    usesByField.size > 0 &&
    [...usesByField.values()].every(
      (uses) => uses.has('derived_feature') && uses.has('model_training')
    )
  );
}

function canonicalFieldUses(request: AflTradeGate0AReceipt['content']['request']) {
  return request.fieldUses
    .map(({ sourceField, use }) => ({ sourceField, use }))
    .sort((left, right) =>
      `${left.sourceField}|${left.use}`.localeCompare(`${right.sourceField}|${right.use}`)
    );
}

function validateSourceRights(
  dataset: AflTradeValuationDatasetCandidate,
  evidence: AuthenticatedAdmissionEvidence,
  admittedAt: string,
  blockers: AflTradeValuationDatasetAdmissionBlocker[]
) {
  const expected = new Map(
    evidence.factualCandidate.content.members.sourceCaptures.map((source) => [
      source.captureId,
      source,
    ])
  );
  const actual = new Map(evidence.sourceRights.map((source) => [source.captureId, source]));
  const fieldSets = new Map(
    evidence.consumedFieldSets.map((fieldSet) => [fieldSet.fieldSetId, fieldSet])
  );
  const lineageMappings = new Map(
    evidence.corpusLineage.content.sourceMappings.map((mapping) => [mapping.captureId, mapping])
  );
  let incomplete =
    expected.size === 0 ||
    actual.size !== evidence.sourceRights.length ||
    actual.size !== expected.size ||
    fieldSets.size !== evidence.consumedFieldSets.length ||
    fieldSets.size !== expected.size ||
    lineageMappings.size !== expected.size;
  let expired = false;
  for (const [captureId, source] of expected) {
    const proof = actual.get(captureId);
    if (!proof) {
      incomplete = true;
      continue;
    }
    const fieldSet = fieldSets.get(proof.consumedFieldSetId);
    const lineageMapping = lineageMappings.get(captureId);
    const sourceSnapshot = proof.sourceSnapshotManifest;
    const derivation = proof.derivationReceipt.content;
    const admission = proof.admissionReceipt.content;
    const derivationResult = evaluateAflTradeGate0A(
      proof.gateLedger,
      proof.rightsProposal,
      derivation.request
    );
    const admissionRequest = { ...admission.request, evaluatedAt: admittedAt };
    const admissionResult = evaluateAflTradeGate0A(
      proof.gateLedger,
      proof.rightsProposal,
      admissionRequest
    );
    const expectedUses = fieldSet?.content.fields
      .flatMap(({ sourceField, uses }) => uses.map((use) => ({ sourceField, use })))
      .sort((left, right) =>
        `${left.sourceField}|${left.use}`.localeCompare(`${right.sourceField}|${right.use}`)
      );
    if (
      proof.sourceSnapshotId !== source.sourceSnapshotId ||
      sourceSnapshot.snapshotId !== source.sourceSnapshotId ||
      !fieldSet ||
      fieldSet.content.captureId !== captureId ||
      fieldSet.content.sourceSnapshotId !== source.sourceSnapshotId ||
      fieldSet.content.fieldSetSha256 !== source.consumedFieldSetSha256 ||
      fieldSet.content.fields.some(
        ({ sourceField }) => !sourceSnapshot.content.capturedFields.includes(sourceField)
      ) ||
      time(sourceSnapshot.content.createdAt) > time(fieldSet.content.createdAt) ||
      time(fieldSet.content.createdAt) > time(dataset.content.createdAt) ||
      !lineageMapping ||
      lineageMapping.sourceSnapshotId !== source.sourceSnapshotId ||
      lineageMapping.consumedFieldSetId !== fieldSet.fieldSetId ||
      lineageMapping.consumedFieldSetSha256 !== fieldSet.content.fieldSetSha256 ||
      derivation.request.rightsArtifactId !== proof.rightsProposal.rightsArtifactId ||
      admission.request.rightsArtifactId !== proof.rightsProposal.rightsArtifactId ||
      derivation.request.environment !== dataset.content.environment ||
      derivation.request.competition !== dataset.content.competition ||
      !sameGate0ARequestExceptTime(derivation.request, admission.request) ||
      !includesRequiredUses(derivation.request) ||
      sha256AflTradeCanonicalJson(canonicalFieldUses(derivation.request)) !==
        sha256AflTradeCanonicalJson(expectedUses ?? []) ||
      derivation.result.status !== 'mechanically_eligible' ||
      admission.result.status !== 'mechanically_eligible' ||
      derivationResult.status !== 'mechanically_eligible' ||
      admissionResult.status !== 'mechanically_eligible' ||
      derivation.result.decisionId !== derivationResult.decisionId ||
      admission.result.decisionId !== admissionResult.decisionId
    ) {
      incomplete = true;
    }
    if (
      time(derivation.request.evaluatedAt) > time(dataset.content.createdAt) ||
      time(derivation.recordedAt) > time(dataset.content.createdAt) ||
      admission.request.evaluatedAt !== admittedAt ||
      time(admission.recordedAt) > time(admittedAt) ||
      (proof.rightsProposal.content.termsExpireAt !== null &&
        time(proof.rightsProposal.content.termsExpireAt) <= time(admittedAt))
    ) {
      expired = true;
    }
  }
  if (incomplete) {
    blocker(
      blockers,
      'SOURCE_RIGHTS_INCOMPLETE',
      dataset.content.factualParent.factualCandidateId,
      'Every contributing capture and exact consumed field requires derivation and model-training rights.'
    );
  }
  if (expired) {
    blocker(
      blockers,
      'SOURCE_RIGHTS_EXPIRED',
      dataset.content.factualParent.factualCandidateId,
      'Rights must predate extraction, remain current at admission, and be rechecked at run start.'
    );
  }
}

function validateOperationAuthority(
  dataset: AflTradeValuationDatasetCandidate,
  evidence: AuthenticatedAdmissionEvidence,
  admittedAt: string,
  blockers: AflTradeValuationDatasetAdmissionBlocker[]
) {
  const parent = dataset.content.factualParent;
  const receipts = [evidence.analyticalAuthority, evidence.operationalAuthorization];
  const validKinds = new Set(receipts.map(({ content }) => content.authorityKind));
  if (
    validKinds.size !== 2 ||
    receipts.some(
      ({ content }) =>
        content.environment !== dataset.content.environment ||
        content.scopeKey !== dataset.content.scopeKey ||
        content.datasetId !== dataset.datasetId ||
        content.factualReleaseId !== parent.factualReleaseId ||
        content.factualCandidateId !== parent.factualCandidateId ||
        time(content.authorizedAt) > time(dataset.content.createdAt) ||
        time(content.validThrough) <= time(admittedAt)
    )
  ) {
    blocker(
      blockers,
      'AUTHORITY_EVIDENCE_INVALID',
      dataset.datasetId,
      'Current analytical authority and operational authorization must cover this exact command.'
    );
  }
}

export class AflTradeValuationDatasetAdmissionService {
  constructor(
    private readonly evidenceAuthenticator: AflTradeValuationDatasetAdmissionEvidenceAuthenticator
  ) {}

  async admit(
    request: AflTradeValuationDatasetAdmissionRequest
  ): Promise<AflTradeValuationDatasetAdmissionResult> {
    const datasetResult = aflTradeValuationDatasetCandidateSchema.safeParse(request.dataset);
    if (!datasetResult.success || !utcInstantSchema.safeParse(request.admittedAt).success) {
      return {
        status: 'blocked',
        blockers: [
          {
            code: 'FACTUAL_ANCESTRY_MISMATCH',
            message: 'The valuation dataset candidate or admission instant is invalid.',
            subject: 'dataset',
          },
        ],
      };
    }
    const dataset = datasetResult.data;
    let rawEvidence: unknown;
    try {
      rawEvidence = await this.evidenceAuthenticator.authenticate({
        dataset,
        admittedAt: request.admittedAt,
      });
    } catch {
      rawEvidence = null;
    }
    const evidence = parseAuthenticatedEvidence(rawEvidence);
    if (evidence === null) {
      return {
        status: 'blocked',
        blockers: [
          {
            code: 'AUTHENTICATOR_UNAVAILABLE',
            message: 'The admission evidence adapter did not return authenticated domain records.',
            subject: dataset.datasetId,
          },
        ],
      };
    }

    const blockers: AflTradeValuationDatasetAdmissionBlocker[] = [];
    validateFactualAuthority(dataset, evidence, request.admittedAt, blockers);
    validateMembership(dataset, evidence, blockers);
    validateArtifacts(dataset, evidence, request.admittedAt, blockers);
    const gate2 = validateGate2(dataset, evidence, request.admittedAt, blockers);
    validateSourceRights(dataset, evidence, request.admittedAt, blockers);
    validateOperationAuthority(dataset, evidence, request.admittedAt, blockers);
    if (blockers.length > 0 || gate2 === null) return { status: 'blocked', blockers };

    const parent = dataset.content.factualParent;
    return {
      status: 'admitted',
      blockers: [],
      receipt: createAflTradeValuationDatasetAdmissionReceipt({
        schemaVersion: AFL_TRADE_VALUATION_DATASET_ADMISSION_SCHEMA_VERSION,
        authorityBoundary:
          'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership',
        publicationEligible: false,
        environment: dataset.content.environment,
        admittedAt: request.admittedAt,
        datasetCreatedAt: dataset.content.createdAt,
        datasetId: dataset.datasetId,
        datasetSha256: dataset.datasetId.slice('dataset:'.length),
        factualReleaseId: parent.factualReleaseId,
        factualCandidateId: parent.factualCandidateId,
        sourceMemberSetSha256: parent.sourceMemberSetSha256,
        corpusId: parent.corpusId,
        corpusToCandidateLineageId: parent.corpusToCandidateLineageId,
        gate2Decision: {
          decisionId: gate2.decisionId,
          state: 'approved',
          effectiveAt: gate2.content.effectiveAt!,
          evaluatedAt: request.admittedAt,
          revalidateAt: gate2.content.revalidateAt!,
          pinnedCorpusId: parent.corpusId,
          pinnedCorpusToCandidateLineageId: parent.corpusToCandidateLineageId,
          pinnedFactualReleaseId: parent.factualReleaseId,
          pinnedFactualCandidateId: parent.factualCandidateId,
        },
        sourceRightsEvaluations: evidence.sourceRights
          .slice()
          .sort((left, right) => left.captureId.localeCompare(right.captureId))
          .map((proof) => ({
            captureId: proof.captureId,
            sourceSnapshotId: proof.sourceSnapshotId,
            consumedFieldSetId: proof.consumedFieldSetId,
            proposalId: proof.rightsProposal.rightsArtifactId,
            derivationDecisionId: proof.derivationReceipt.content.result.decisionId!,
            derivationEvaluationReceiptId: proof.derivationReceipt.receiptId,
            derivationEvaluatedAt: proof.derivationReceipt.content.request.evaluatedAt,
            admissionDecisionId: proof.admissionReceipt.content.result.decisionId!,
            admissionEvaluationReceiptId: proof.admissionReceipt.receiptId,
            admissionEvaluatedAt: proof.admissionReceipt.content.request.evaluatedAt,
            consumedFieldSetSha256: evidence.consumedFieldSets.find(
              ({ fieldSetId }) => fieldSetId === proof.consumedFieldSetId
            )!.content.fieldSetSha256,
            operations: ['derived_feature_creation', 'model_training'],
            fieldUses: ['derived_feature', 'model_training'],
            status: 'approved',
            termsValidThrough: proof.rightsProposal.content.termsExpireAt,
          })),
        analyticalAuthorityReceiptId: evidence.analyticalAuthority.receiptId,
        operationalAuthorizationReceiptId: evidence.operationalAuthorization.receiptId,
      }),
    };
  }
}
