import { z } from 'zod';

import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import { resolveAflTradeGateEligibility } from '../governance/gateDecisionLedger';
import type {
  AflTradeDecisionEnvironment,
  AflTradeGateDecisionRecord,
} from '../governance/gateDecisionTypes';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceOperation,
  type AflTradeSourceRightsProposal,
  type AflTradeSourceUse,
} from './sourceRights';
import { AFL_TRADE_FITZROY_CAPABILITIES } from './fitzRoyProviderCapabilities';

const gate0aEvaluationTimeSchema = z.iso.datetime({ offset: true });

export interface AflTradeGate0ARequest {
  decisionKey: string;
  environment: AflTradeDecisionEnvironment;
  rightsArtifactId: string;
  evaluatedAt: string;
  competition: string;
  season: number;
  accessMechanism: AflTradeSourceRightsProposal['content']['scope']['accessMechanism'];
  capabilityId: string | null;
  geography: string;
  commercialContext: string;
  audience: string;
  operations: readonly AflTradeSourceOperation[];
  fieldUses: ReadonlyArray<{ sourceField: string; use: AflTradeSourceUse }>;
  rawRetentionDays: number | null;
  metadataRetentionDays: number | null;
  cacheSeconds: number | null;
}

export type AflTradeGate0ABlockerCode =
  | 'invalid_rights_artifact'
  | 'invalid_evaluation_time'
  | 'gate_decision_blocked'
  | 'decision_rights_mismatch'
  | 'decision_scope_mismatch'
  | 'terms_not_current'
  | 'competition_not_permitted'
  | 'season_not_permitted'
  | 'access_not_permitted'
  | 'capability_not_permitted'
  | 'geography_not_permitted'
  | 'commercial_context_not_permitted'
  | 'audience_not_permitted'
  | 'operation_not_permitted'
  | 'field_not_registered'
  | 'field_use_not_permitted'
  | 'retention_not_permitted'
  | 'cache_not_permitted'
  | 'source_condition_unsatisfied'
  | 'duplicate_request';

export interface AflTradeGate0ABlocker {
  code: AflTradeGate0ABlockerCode;
  message: string;
  subject: string;
}

export interface AflTradeGate0AEvaluation {
  status: 'mechanically_eligible' | 'blocked';
  decisionId: string | null;
  rightsArtifactId: string;
  blockers: AflTradeGate0ABlocker[];
}

function addBlocker(
  blockers: AflTradeGate0ABlocker[],
  code: AflTradeGate0ABlockerCode,
  subject: string,
  message: string
) {
  blockers.push({ code, subject, message });
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function withinRetention(
  requestedDays: number | null,
  retention: { disposition: 'prohibited' | 'transient' | 'retained'; maximumDays: number | null }
): boolean {
  if (requestedDays === null) return true;
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) return false;
  if (retention.disposition === 'prohibited') return false;
  return retention.maximumDays === null || requestedDays <= retention.maximumDays;
}

function scopeDimensionValues(
  dimensions: ReadonlyArray<{ name: string; values: readonly string[] }>,
  name: string
): readonly string[] | null {
  return dimensions.find((dimension) => dimension.name === name)?.values ?? null;
}

function collectDecisionScopeBlockers(
  decision: AflTradeGateDecisionRecord,
  request: AflTradeGate0ARequest
): AflTradeGate0ABlocker[] {
  const blockers: AflTradeGate0ABlocker[] = [];
  const scopeChecks: Array<[string, string]> = [
    ['source_rights_artifact', request.rightsArtifactId],
    ['competition', request.competition],
    ['season', String(request.season)],
    ['access_mechanism', request.accessMechanism],
    ['geography', request.geography],
    ['commercial_context', request.commercialContext],
    ['audience', request.audience],
  ];
  if (request.capabilityId !== null) {
    scopeChecks.push(['fitzroy_capability', request.capabilityId]);
  }
  for (const [dimensionName, requestedValue] of scopeChecks) {
    const permittedValues = scopeDimensionValues(decision.content.scope.dimensions, dimensionName);
    if (permittedValues === null || !permittedValues.includes(requestedValue)) {
      addBlocker(
        blockers,
        'decision_scope_mismatch',
        `${dimensionName}:${requestedValue}`,
        `The Gate 0A decision does not include ${requestedValue} in ${dimensionName}.`
      );
    }
  }
  const permittedOperations = scopeDimensionValues(decision.content.scope.dimensions, 'operation');
  for (const operation of request.operations) {
    if (permittedOperations === null || !permittedOperations.includes(operation)) {
      addBlocker(
        blockers,
        'decision_scope_mismatch',
        operation,
        `The Gate 0A decision scope does not include ${operation}.`
      );
    }
  }
  return blockers;
}

function evaluateGateDecisionAuthorization(
  ledger: AflTradeGateDecisionLedger,
  rights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest
): { decision: AflTradeGateDecisionRecord | null; blockers: AflTradeGate0ABlocker[] } {
  const blockers: AflTradeGate0ABlocker[] = [];
  const gateResolution = resolveAflTradeGateEligibility(ledger, {
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey: request.decisionKey,
    environment: request.environment,
    evaluatedAt: request.evaluatedAt,
  });
  const decision = gateResolution.decision;
  if (gateResolution.status === 'blocked' || decision === null) {
    for (const blocker of gateResolution.blockers) {
      addBlocker(blockers, 'gate_decision_blocked', blocker.code, blocker.message);
    }
    return { decision, blockers };
  }
  if (
    !decision.content.affectedArtifacts.some(
      (artifact) =>
        artifact.kind === 'source_rights' && artifact.artifactId === rights.rightsArtifactId
    )
  ) {
    addBlocker(
      blockers,
      'decision_rights_mismatch',
      rights.rightsArtifactId,
      'The effective Gate 0A decision does not pin this source-rights artifact.'
    );
  }
  blockers.push(...collectDecisionScopeBlockers(decision, request));
  return { decision, blockers };
}

function evaluateExactGateDecisionAuthorization(
  decision: AflTradeGateDecisionRecord,
  rights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest,
  evaluatedAt: number
): { decision: AflTradeGateDecisionRecord; blockers: AflTradeGate0ABlocker[] } {
  const blockers: AflTradeGate0ABlocker[] = [];
  const effectiveAt =
    decision.content.effectiveAt === null
      ? Number.NaN
      : Date.parse(decision.content.effectiveAt);
  const revalidateAt =
    decision.content.revalidateAt === null
      ? null
      : Date.parse(decision.content.revalidateAt);
  if (
    decision.content.gate !== 'gate_0a_permission_to_evaluate' ||
    decision.content.decisionKey !== request.decisionKey ||
    decision.content.environment !== request.environment ||
    decision.content.state !== 'approved' ||
    !Number.isFinite(effectiveAt) ||
    (Number.isFinite(evaluatedAt) &&
      (evaluatedAt < effectiveAt || (revalidateAt !== null && evaluatedAt >= revalidateAt)))
  ) {
    addBlocker(
      blockers,
      'gate_decision_blocked',
      decision.decisionId,
      'The embedded Gate 0A decision is not an effective approval for this exact request.'
    );
  }
  if (
    !decision.content.affectedArtifacts.some(
      (artifact) =>
        artifact.kind === 'source_rights' && artifact.artifactId === rights.rightsArtifactId
    )
  ) {
    addBlocker(
      blockers,
      'decision_rights_mismatch',
      rights.rightsArtifactId,
      'The embedded Gate 0A decision does not pin this source-rights artifact.'
    );
  }
  blockers.push(...collectDecisionScopeBlockers(decision, request));
  return { decision, blockers };
}

function collectSourceScopeBlockers(
  rights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest,
  evaluatedAt: number
): AflTradeGate0ABlocker[] {
  const blockers: AflTradeGate0ABlocker[] = [];
  if (Number.isFinite(evaluatedAt)) {
    if (
      rights.content.termsEffectiveAt !== null &&
      evaluatedAt < Date.parse(rights.content.termsEffectiveAt)
    ) {
      addBlocker(
        blockers,
        'terms_not_current',
        rights.rightsArtifactId,
        'The source terms are not yet effective.'
      );
    }
    if (
      rights.content.termsExpireAt !== null &&
      evaluatedAt >= Date.parse(rights.content.termsExpireAt)
    ) {
      addBlocker(
        blockers,
        'terms_not_current',
        rights.rightsArtifactId,
        'The source terms have expired.'
      );
    }
  }
  if (!rights.content.scope.competitions.includes(request.competition)) {
    addBlocker(
      blockers,
      'competition_not_permitted',
      request.competition,
      `Competition ${request.competition} is outside the source-rights scope.`
    );
  }
  const seasonPermitted = rights.content.scope.seasonRanges.some(
    (range) => range.from <= request.season && request.season <= range.to
  );
  if (!seasonPermitted) {
    addBlocker(
      blockers,
      'season_not_permitted',
      String(request.season),
      `Season ${request.season} is outside the source-rights scope.`
    );
  }
  if (rights.content.scope.accessMechanism !== request.accessMechanism) {
    addBlocker(
      blockers,
      'access_not_permitted',
      request.accessMechanism,
      `Access mechanism ${request.accessMechanism} is not permitted by this rights artifact.`
    );
  }
  if (rights.content.acquisition.kind === 'fitzroy') {
    const binding = rights.content.acquisition.capabilities.find(
      (capability) => capability.capabilityId === request.capabilityId
    );
    const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
      (candidate) => candidate.capabilityId === request.capabilityId
    );
    if (
      request.capabilityId === null ||
      binding === undefined ||
      capability === undefined ||
      !(capability.competitions as readonly string[]).includes(request.competition) ||
      (capability.documentedMinimumSeason !== null &&
        request.season < capability.documentedMinimumSeason)
    ) {
      addBlocker(
        blockers,
        'capability_not_permitted',
        request.capabilityId ?? 'missing',
        'The requested fitzRoy capability is not bound to this source scope, competition, and season.'
      );
    }
  } else if (request.capabilityId !== null) {
    addBlocker(
      blockers,
      'capability_not_permitted',
      request.capabilityId,
      'A non-fitzRoy source scope cannot authorize a fitzRoy capability.'
    );
  }
  const restrictionChecks: ReadonlyArray<{
    permitted: readonly string[];
    requested: string;
    code: 'geography_not_permitted' | 'commercial_context_not_permitted' | 'audience_not_permitted';
    subject: string;
  }> = [
    {
      permitted: rights.content.restrictions.geographic,
      requested: request.geography,
      code: 'geography_not_permitted',
      subject: 'geography',
    },
    {
      permitted: rights.content.restrictions.commercial,
      requested: request.commercialContext,
      code: 'commercial_context_not_permitted',
      subject: 'commercial context',
    },
    {
      permitted: rights.content.restrictions.audience,
      requested: request.audience,
      code: 'audience_not_permitted',
      subject: 'audience',
    },
  ];
  for (const restriction of restrictionChecks) {
    if (
      restriction.permitted.length > 0 &&
      !restriction.permitted.includes(restriction.requested)
    ) {
      addBlocker(
        blockers,
        restriction.code,
        restriction.requested,
        `The requested ${restriction.subject} is outside the source-rights restrictions.`
      );
    }
  }
  return blockers;
}

function collectRequestedPermissionBlockers(
  rights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest
): AflTradeGate0ABlocker[] {
  const blockers: AflTradeGate0ABlocker[] = [];
  if (hasDuplicates(request.operations)) {
    addBlocker(blockers, 'duplicate_request', 'operations', 'Requested operations must be unique.');
  }
  const fieldUseKeys = request.fieldUses.map(
    (fieldUse) => `${fieldUse.sourceField}|${fieldUse.use}`
  );
  if (hasDuplicates(fieldUseKeys)) {
    addBlocker(blockers, 'duplicate_request', 'fieldUses', 'Requested field uses must be unique.');
  }
  for (const operation of request.operations) {
    if (rights.content.operations[operation] !== 'allowed') {
      addBlocker(
        blockers,
        'operation_not_permitted',
        operation,
        `Operation ${operation} is not explicitly allowed.`
      );
    }
  }
  const fieldsBySourceName = new Map(
    rights.content.fields.map((field) => [field.sourceField, field])
  );
  for (const fieldUse of request.fieldUses) {
    const field = fieldsBySourceName.get(fieldUse.sourceField);
    if (!field) {
      addBlocker(
        blockers,
        'field_not_registered',
        fieldUse.sourceField,
        `Field ${fieldUse.sourceField} is not registered and is denied by default.`
      );
    } else if (field.uses[fieldUse.use] !== 'allowed') {
      addBlocker(
        blockers,
        'field_use_not_permitted',
        `${fieldUse.sourceField}:${fieldUse.use}`,
        `Field ${fieldUse.sourceField} is not allowed for ${fieldUse.use}.`
      );
    }
  }
  return blockers;
}

function collectStorageAndConditionBlockers(
  rights: AflTradeSourceRightsProposal,
  decision: AflTradeGateDecisionRecord | null,
  request: AflTradeGate0ARequest
): AflTradeGate0ABlocker[] {
  const blockers: AflTradeGate0ABlocker[] = [];
  if (!withinRetention(request.rawRetentionDays, rights.content.retention.rawEvidence)) {
    addBlocker(
      blockers,
      'retention_not_permitted',
      'rawEvidence',
      'Requested raw-evidence retention exceeds the permitted scope.'
    );
  }
  if (!withinRetention(request.metadataRetentionDays, rights.content.retention.hashesAndMetadata)) {
    addBlocker(
      blockers,
      'retention_not_permitted',
      'hashesAndMetadata',
      'Requested metadata retention exceeds the permitted scope.'
    );
  }
  if (request.cacheSeconds !== null) {
    const cache = rights.content.automatedAccess.cache;
    const cachePermitted =
      Number.isInteger(request.cacheSeconds) &&
      request.cacheSeconds >= 0 &&
      cache.permitted &&
      cache.maximumSeconds !== null &&
      request.cacheSeconds <= cache.maximumSeconds;
    if (!cachePermitted) {
      addBlocker(
        blockers,
        'cache_not_permitted',
        String(request.cacheSeconds),
        'Requested caching exceeds the permitted scope.'
      );
    }
  }
  if (decision) {
    const conditionById = new Map(
      decision.content.conditionResults.map((condition) => [condition.conditionId, condition])
    );
    for (const condition of rights.content.conditions) {
      const applies = condition.appliesToOperations.some((operation) =>
        request.operations.includes(operation)
      );
      if (applies && conditionById.get(condition.conditionId)?.status !== 'satisfied') {
        addBlocker(
          blockers,
          'source_condition_unsatisfied',
          condition.conditionId,
          `Source-rights condition ${condition.conditionId} is not satisfied by the decision.`
        );
      }
    }
  }
  return blockers;
}

function evaluateAflTradeGate0AWithAuthorization(
  unparsedRights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest,
  resolveAuthorization: (
    rights: AflTradeSourceRightsProposal,
    evaluatedAt: number
  ) => { decision: AflTradeGateDecisionRecord | null; blockers: AflTradeGate0ABlocker[] }
): AflTradeGate0AEvaluation {
  const blockers: AflTradeGate0ABlocker[] = [];
  const parsedRights = aflTradeSourceRightsProposalSchema.safeParse(unparsedRights);
  if (!parsedRights.success) {
    addBlocker(
      blockers,
      'invalid_rights_artifact',
      request.rightsArtifactId,
      'The source-rights artifact is invalid or does not match its canonical content address.'
    );
    return {
      status: 'blocked',
      decisionId: null,
      rightsArtifactId: request.rightsArtifactId,
      blockers,
    };
  }
  const rights = parsedRights.data;
  if (rights.rightsArtifactId !== request.rightsArtifactId) {
    addBlocker(
      blockers,
      'invalid_rights_artifact',
      request.rightsArtifactId,
      'The request does not reference the evaluated source-rights artifact.'
    );
  }

  const parsedEvaluationTime = gate0aEvaluationTimeSchema.safeParse(request.evaluatedAt);
  const evaluatedAt = parsedEvaluationTime.success
    ? Date.parse(parsedEvaluationTime.data)
    : Number.NaN;
  if (!parsedEvaluationTime.success) {
    addBlocker(
      blockers,
      'invalid_evaluation_time',
      request.evaluatedAt,
      'Gate 0A requires a valid evaluation time.'
    );
  }
  const authorization = resolveAuthorization(rights, evaluatedAt);
  const decision = authorization.decision;
  blockers.push(...authorization.blockers);
  blockers.push(...collectSourceScopeBlockers(rights, request, evaluatedAt));
  blockers.push(...collectRequestedPermissionBlockers(rights, request));
  blockers.push(...collectStorageAndConditionBlockers(rights, decision, request));

  return {
    status: blockers.length === 0 ? 'mechanically_eligible' : 'blocked',
    decisionId: decision?.decisionId ?? null,
    rightsArtifactId: rights.rightsArtifactId,
    blockers,
  };
}

export function evaluateAflTradeGate0A(
  ledger: AflTradeGateDecisionLedger,
  unparsedRights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest
): AflTradeGate0AEvaluation {
  return evaluateAflTradeGate0AWithAuthorization(
    unparsedRights,
    request,
    (rights) => evaluateGateDecisionAuthorization(ledger, rights, request)
  );
}

export function evaluateAflTradeGate0AAgainstDecision(
  decision: AflTradeGateDecisionRecord,
  unparsedRights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest
): AflTradeGate0AEvaluation {
  return evaluateAflTradeGate0AWithAuthorization(
    unparsedRights,
    request,
    (rights, evaluatedAt) =>
      evaluateExactGateDecisionAuthorization(decision, rights, request, evaluatedAt)
  );
}
