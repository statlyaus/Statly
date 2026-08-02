import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import { resolveAflTradeGateEligibility } from '../governance/gateDecisionLedger';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceOperation,
  type AflTradeSourceRightsProposal,
  type AflTradeSourceUse,
} from './sourceRights';

export interface AflTradeGate0ARequest {
  decisionKey: string;
  environment: AflTradeDecisionEnvironment;
  rightsArtifactId: string;
  evaluatedAt: string;
  competition: string;
  season: number;
  accessMechanism: AflTradeSourceRightsProposal['content']['scope']['accessMechanism'];
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

export function evaluateAflTradeGate0A(
  ledger: AflTradeGateDecisionLedger,
  unparsedRights: AflTradeSourceRightsProposal,
  request: AflTradeGate0ARequest
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

  const evaluatedAt = Date.parse(request.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) {
    addBlocker(
      blockers,
      'invalid_evaluation_time',
      request.evaluatedAt,
      'Gate 0A requires a valid evaluation time.'
    );
  }

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
  } else {
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

    const scopeChecks: ReadonlyArray<[string, string]> = [
      ['source_rights_artifact', rights.rightsArtifactId],
      ['competition', request.competition],
      ['season', String(request.season)],
      ['access_mechanism', request.accessMechanism],
      ['geography', request.geography],
      ['commercial_context', request.commercialContext],
      ['audience', request.audience],
    ];
    for (const [dimensionName, requestedValue] of scopeChecks) {
      const permittedValues = scopeDimensionValues(
        decision.content.scope.dimensions,
        dimensionName
      );
      if (permittedValues === null || !permittedValues.includes(requestedValue)) {
        addBlocker(
          blockers,
          'decision_scope_mismatch',
          `${dimensionName}:${requestedValue}`,
          `The Gate 0A decision does not include ${requestedValue} in ${dimensionName}.`
        );
      }
    }
    const permittedOperations = scopeDimensionValues(
      decision.content.scope.dimensions,
      'operation'
    );
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
  }

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
  if (
    !rights.content.scope.seasonRanges.some(
      (range) => range.from <= request.season && request.season <= range.to
    )
  ) {
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
  for (const fieldUse of request.fieldUses) {
    const field = rights.content.fields.find(
      (candidate) => candidate.sourceField === fieldUse.sourceField
    );
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
    if (
      !Number.isInteger(request.cacheSeconds) ||
      request.cacheSeconds < 0 ||
      !cache.permitted ||
      cache.maximumSeconds === null ||
      request.cacheSeconds > cache.maximumSeconds
    ) {
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
      if (
        condition.appliesToOperations.some((operation) => request.operations.includes(operation)) &&
        conditionById.get(condition.conditionId)?.status !== 'satisfied'
      ) {
        addBlocker(
          blockers,
          'source_condition_unsatisfied',
          condition.conditionId,
          `Source-rights condition ${condition.conditionId} is not satisfied by the decision.`
        );
      }
    }
  }

  return {
    status: blockers.length === 0 ? 'mechanically_eligible' : 'blocked',
    decisionId: decision?.decisionId ?? null,
    rightsArtifactId: rights.rightsArtifactId,
    blockers,
  };
}
