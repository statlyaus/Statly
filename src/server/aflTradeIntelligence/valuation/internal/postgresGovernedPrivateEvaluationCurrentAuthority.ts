import {
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import {
  authenticateAflDraftTradeOutcomeReleaseRegistry,
  type AflDraftTradeOutcomeReleaseRegistry,
} from '../../outcomes/outcomeReleaseState';
import type { AflOutcomeSqlTransaction } from '../../outcomes/postgresOutcomeReleaseRepository';
import { loadPostgresAflTradePrivateCurrentValuationCohortAuthority } from '../postgresCurrentValuationCohortPreparation';
import {
  parseAflTradePrivateValuationEvaluationDecision,
  type AflTradePrivateValuationEvaluationDecision,
} from '../privateValuationEvaluationDecision';
import type { GovernedPrivateEvaluationInputTrace } from './governedPrivateEvaluationInputTrace';
import type { GovernedPrivateEvaluationCapturedCalculationAuthority } from './postgresGovernedPrivateEvaluationInspectionRepository';
import { loadCurrentGovernedComponentAuthority } from './postgresGovernedPrivateEvaluationComponentAuthority';

export { loadCurrentGovernedComponentAuthority } from './postgresGovernedPrivateEvaluationComponentAuthority';
export { loadPostgresAflTradePrivateCurrentValuationCohortAuthority };

interface FactualHeadRow {
  readonly revision: number | string;
  readonly last_event_id: string | null;
  readonly registry_json: unknown;
  readonly active_release_id: string | null;
  readonly active_revision: number | string | null;
  readonly activated_at: Date | string | null;
}

interface PrivateDecisionRow {
  readonly head_revision: number | string;
  readonly head_decision_id: string;
  readonly head_status: 'authorized' | 'withdrawn';
  readonly decision_id: string;
  readonly valuation_scope_key: string;
  readonly factual_release_scope_key: string;
  readonly factual_release_id: string;
  readonly decision_status: 'authorized' | 'withdrawn';
  readonly decision_revision: number | string;
  readonly decision_json: unknown;
}

type CurrentAuthorityInput = Readonly<{
  transaction: AflOutcomeSqlTransaction;
  selector: { valuationScopeKey: string; tradeId: string };
  capturedAt: string;
  prepared: {
    factualReleaseScopeKey: string;
    factualReleaseId: string;
    factualReleaseArtifact: AflTradeArtifactRef;
    releaseMembershipArtifact: AflTradeArtifactRef;
    sourceQualificationEvidenceRefs: readonly AflTradeArtifactRef[];
  };
  trace: GovernedPrivateEvaluationInputTrace;
  materializationManifestId: string;
  materializationManifestArtifact: AflTradeArtifactRef;
  valuationInputBundleId: string;
  valuationInputBundleArtifact: AflTradeArtifactRef;
  preparedInputHeadRevision: number;
  preparedInputSetId: string;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}>;

type PrivateCurrentAuthorityInput = Omit<CurrentAuthorityInput, 'prepared'> &
  Readonly<{
    prepared: Pick<
      CurrentAuthorityInput['prepared'],
      | 'factualReleaseScopeKey'
      | 'factualReleaseId'
      | 'factualReleaseArtifact'
      | 'releaseMembershipArtifact'
    > &
      Readonly<{
        preparationAuthority: 'dispatch_bound_private_factual_output';
        privateAuthority: Parameters<
          typeof loadPostgresAflTradePrivateCurrentValuationCohortAuthority
        >[1]['privateAuthority'];
      }>;
  }>;

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Current factual authority contains malformed database time.');
  }
  return parsed.toISOString();
}

function authenticateRegistry(value: unknown): AflDraftTradeOutcomeReleaseRegistry {
  return authenticateAflDraftTradeOutcomeReleaseRegistry(
    structuredClone(value) as AflDraftTradeOutcomeReleaseRegistry
  );
}

type PreparedFactualAuthority = CurrentAuthorityInput['prepared'] & {
  readonly valuationScopeKey: string;
};

export async function loadCurrentPrivateValuationDecision(
  transaction: AflOutcomeSqlTransaction,
  prepared: PreparedFactualAuthority
): Promise<
  | { readonly state: 'ready'; readonly decision: AflTradePrivateValuationEvaluationDecision }
  | Extract<GovernedPrivateEvaluationCapturedCalculationAuthority, { state: 'unavailable' }>
> {
  const result = await transaction.query<PrivateDecisionRow>(
    `SELECT head.revision AS head_revision,head.decision_id AS head_decision_id,
       head.status AS head_status,decision.decision_id,decision.valuation_scope_key,
       decision.factual_release_scope_key,decision.factual_release_id,
       decision.status AS decision_status,decision.revision AS decision_revision,
       decision.decision_json
       FROM outcome_private_valuation_evaluation_head head
       JOIN outcome_private_valuation_evaluation_decision decision
         ON decision.decision_id=head.decision_id
      WHERE head.valuation_scope_key=$1 AND head.factual_release_id=$2`,
    [prepared.valuationScopeKey, prepared.factualReleaseId]
  );
  if (result.rows.length === 0) {
    return {
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message:
            'No current authorized private derived-calculation decision covers this release.',
        },
      ],
    };
  }
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) {
    throw new TypeError('The private valuation decision head is ambiguous.');
  }
  const decision = parseAflTradePrivateValuationEvaluationDecision(row.decision_json);
  const headRevision = Number(row.head_revision);
  const decisionRevision = Number(row.decision_revision);
  if (
    decision.decisionId !== row.decision_id ||
    row.head_decision_id !== row.decision_id ||
    headRevision !== decisionRevision ||
    decision.content.revision !== decisionRevision ||
    decision.content.valuationScopeKey !== row.valuation_scope_key ||
    decision.content.factualReleaseScopeKey !== row.factual_release_scope_key ||
    decision.content.factualReleaseId !== row.factual_release_id ||
    decision.content.status !== row.decision_status ||
    row.head_status !== row.decision_status ||
    row.valuation_scope_key !== prepared.valuationScopeKey ||
    row.factual_release_scope_key !== prepared.factualReleaseScopeKey ||
    row.factual_release_id !== prepared.factualReleaseId ||
    !doAflTradeArtifactRefsExactlyMatch(
      decision.content.factualReleaseArtifact,
      prepared.factualReleaseArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      decision.content.releaseMembershipArtifact,
      prepared.releaseMembershipArtifact
    ) ||
    canonicalizeAflTradeJson(decision.content.sourceRightsEvidenceRefs) !==
      canonicalizeAflTradeJson(prepared.sourceQualificationEvidenceRefs)
  ) {
    throw new TypeError('The private valuation head disagrees with exact prepared ancestry.');
  }
  if (decision.content.status !== 'authorized') {
    return {
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message:
            'No current authorized private derived-calculation decision covers this release.',
        },
      ],
    };
  }
  return { state: 'ready', decision };
}

export async function capturePostgresGovernedPrivateEvaluationCurrentAuthority(
  input: CurrentAuthorityInput
): Promise<GovernedPrivateEvaluationCapturedCalculationAuthority> {
  const result = await input.transaction.query<FactualHeadRow>(
    `SELECT head.revision,head.last_event_id,head.registry_json,
       active.release_id AS active_release_id,active.revision AS active_revision,
       active.activated_at
       FROM outcome_registry_head head
       LEFT JOIN outcome_active_release active ON active.scope_key=$1
      WHERE head.singleton_id=1`,
    [input.prepared.factualReleaseScopeKey]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) {
    throw new TypeError('The factual registry head is unavailable or ambiguous.');
  }
  const registry = authenticateRegistry(row.registry_json);
  const revision = Number(row.revision);
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    registry.revision !== revision ||
    (registry.events.at(-1)?.eventId ?? null) !== row.last_event_id
  ) {
    throw new TypeError('The factual registry head disagrees with its authenticated bytes.');
  }
  const pointer = registry.activeByScope[input.prepared.factualReleaseScopeKey];
  if (pointer === undefined) {
    if (
      row.active_release_id !== null ||
      row.active_revision !== null ||
      row.activated_at !== null
    ) {
      throw new TypeError('The active factual projection disagrees with the registry head.');
    }
    return {
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message: 'The exact prepared factual release is not the current active release.',
        },
      ],
    };
  }
  const activeRevision = Number(row.active_revision);
  if (
    row.active_release_id !== pointer.releaseId ||
    activeRevision !== pointer.revision ||
    row.activated_at === null ||
    instant(row.activated_at) !== pointer.activatedAt
  ) {
    throw new TypeError('The active factual projection disagrees with the registry head.');
  }
  if (pointer.releaseId !== input.prepared.factualReleaseId) {
    return {
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message: 'The exact prepared factual release is not the current active release.',
        },
      ],
    };
  }
  const privateAuthority = await loadCurrentPrivateValuationDecision(input.transaction, {
    ...input.prepared,
    valuationScopeKey: input.selector.valuationScopeKey,
  });
  if (privateAuthority.state === 'unavailable') return privateAuthority;
  const componentAuthority = await loadCurrentGovernedComponentAuthority({
    transaction: input.transaction,
    trace: input.trace,
    capturedAt: input.capturedAt,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  if (componentAuthority.state === 'unavailable') return componentAuthority;
  return {
    state: 'ready',
    preparedInputHeadRevision: input.preparedInputHeadRevision,
    preparedInputSetId: input.preparedInputSetId,
    factualRegistryRevision: revision,
    factualReleaseId: input.prepared.factualReleaseId,
    activeFactualReleaseRevision: pointer.revision,
    privateValuationDecisionId: privateAuthority.decision.decisionId,
    privateValuationDecisionRevision: privateAuthority.decision.content.revision,
    materializationManifestId: input.materializationManifestId,
    materializationManifestArtifact: input.materializationManifestArtifact,
    valuationInputBundleId: input.valuationInputBundleId,
    valuationInputBundleArtifact: input.valuationInputBundleArtifact,
    gateLedgerRevision: componentAuthority.gateLedgerRevision,
    components: componentAuthority.components,
  };
}

export async function capturePostgresGovernedPrivateEvaluationPrivateCurrentAuthority(
  input: PrivateCurrentAuthorityInput
): Promise<GovernedPrivateEvaluationCapturedCalculationAuthority> {
  const authorityIsCurrent = await loadPostgresAflTradePrivateCurrentValuationCohortAuthority(
    input.transaction,
    {
      scopeKey: input.selector.valuationScopeKey,
      factualReleaseScopeKey: input.prepared.factualReleaseScopeKey,
      factualReleaseId: input.prepared.factualReleaseId,
      privateAuthority: input.prepared.privateAuthority,
    }
  );
  if (!authorityIsCurrent) {
    return {
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message:
            'The exact dispatch-bound factual output and qualified model pair are no longer current.',
        },
      ],
    };
  }
  const componentAuthority = await loadCurrentGovernedComponentAuthority({
    transaction: input.transaction,
    trace: input.trace,
    capturedAt: input.capturedAt,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  if (componentAuthority.state === 'unavailable') return componentAuthority;
  const player = componentAuthority.components.find(
    ({ role }) => role === 'player_contribution_and_availability'
  );
  const pick = componentAuthority.components.find(
    ({ role }) => role === 'draft_pick_and_future_pick_distribution'
  );
  if (
    player?.runId !== input.prepared.privateAuthority.playerRunId ||
    pick?.runId !== input.prepared.privateAuthority.pickRunId ||
    player.qualificationId !== input.prepared.privateAuthority.modelQualificationId ||
    pick.qualificationId !== input.prepared.privateAuthority.modelQualificationId
  ) {
    return {
      state: 'unavailable',
      blockers: [
        {
          code: 'model_not_approved',
          message:
            'The exact current automated qualification is unavailable for both governed model components.',
        },
      ],
    };
  }
  return {
    state: 'ready',
    preparationAuthority: input.prepared.preparationAuthority,
    privateAuthority: input.prepared.privateAuthority,
    preparedInputHeadRevision: input.preparedInputHeadRevision,
    preparedInputSetId: input.preparedInputSetId,
    factualReleaseId: input.prepared.factualReleaseId,
    materializationManifestId: input.materializationManifestId,
    materializationManifestArtifact: input.materializationManifestArtifact,
    valuationInputBundleId: input.valuationInputBundleId,
    valuationInputBundleArtifact: input.valuationInputBundleArtifact,
    gateLedgerRevision: componentAuthority.gateLedgerRevision,
    components: componentAuthority.components,
  };
}
