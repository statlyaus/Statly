import type { AflTradeArtifactRef } from '../../artifacts/artifactReference';
import type { AflTradeLineageGraph } from '../../domain/lineageTypes';
import type { AflTradePickPavDistributionBenchmark } from '../../modeling/pickPavDistributionBenchmark';
import type { AflTradePlayerPavObservation } from '../../modeling/playerPavObservationContracts';
import type { AflTradeComponentDrawSet } from '../componentDrawSet';
import type { AflTradeConstructionCompatibilityRequest } from '../constructionCompatibility';
import { constructAflTradeCompatibleCurrentValuationTrade } from '../authenticatedCurrentValuationTradeConstruction';
import type { AflTradePackagePolicy } from '../packagePolicy';
import type { AflTradeRealizedContributionLedger } from '../realizedContributionLedger';
import type { AflTradeValuationCase } from '../valuationCaseContracts';
import type { GovernedPrivateEvaluationExplanationPolicy } from './governedPrivateEvaluationExplanationPolicy';
import type { GovernedPrivateEvaluationInputTrace } from './governedPrivateEvaluationInputTrace';
import {
  planPrivateValuationTradeConstruction,
  type PrivateValuationTradeConstructionBinding,
  type PrivateValuationTradeConstructionDerivedInput,
  type PrivateValuationTradeConstructionSuppliedRole,
} from './privateValuationTradeConstructionPlan';

type ComponentAuthority = GovernedPrivateEvaluationInputTrace['content']['components'][number];

/** A document the caller has already retained, with the reference and bytes that prove it. */
export type PrivateValuationTradeRetained<T> = Readonly<{
  value: T;
  reference: AflTradeArtifactRef;
  bytes: Uint8Array;
}>;

/**
 * What one trade's construction actually resolved. Every document the caller could not resolve stays
 * `null` rather than being omitted, so the plan reports it by name instead of the assembler silently
 * valuing a different trade than the release sealed.
 */
export interface PrivateValuationTradeResolvedEvidence {
  readonly createdAt: string | null;
  readonly factualReleaseId: string | null;
  readonly valuationInputBundleId: string | null;
  readonly components: readonly ComponentAuthority[];
  readonly trace: PrivateValuationTradeRetained<GovernedPrivateEvaluationInputTrace> | null;
  readonly explanationPolicy: PrivateValuationTradeRetained<GovernedPrivateEvaluationExplanationPolicy> | null;
  readonly valuationCase: AflTradeValuationCase | null;
  readonly componentDrawSet: AflTradeComponentDrawSet | null;
  readonly realizedContributionLedger: AflTradeRealizedContributionLedger | null;
  readonly packagePolicy: AflTradePackagePolicy | null;
  readonly lineageGraph: PrivateValuationTradeRetained<AflTradeLineageGraph> | null;
  readonly pickBenchmarks: readonly PrivateValuationTradeRetained<AflTradePickPavDistributionBenchmark>[];
  readonly playerObservations: readonly PrivateValuationTradeRetained<AflTradePlayerPavObservation>[];
}

export type PrivateValuationTradeConstructionCompatibility = Pick<
  AflTradeConstructionCompatibilityRequest,
  'environment' | 'policyReference' | 'repository'
>;

export type PrivateValuationTradeConstructionOutcome = Awaited<
  ReturnType<typeof constructAflTradeCompatibleCurrentValuationTrade>
>;

export type PrivateValuationTradeConstructor = (
  input: Parameters<typeof constructAflTradeCompatibleCurrentValuationTrade>[0],
  compatibility: PrivateValuationTradeConstructionCompatibility
) => Promise<PrivateValuationTradeConstructionOutcome>;

/**
 * The construction boundary refuses unplanned evidence, so the assembler only reports which documents
 * resolved. Resolving them is the caller's job and is where genuine evidence enters.
 */
function resolvedSuppliedRoles(evidence: PrivateValuationTradeResolvedEvidence): readonly {
  role: PrivateValuationTradeConstructionSuppliedRole;
  reference: AflTradeArtifactRef;
}[] {
  const supplied: {
    role: PrivateValuationTradeConstructionSuppliedRole;
    reference: AflTradeArtifactRef;
  }[] = [];
  if (evidence.trace !== null) {
    supplied.push({ role: 'input_trace', reference: evidence.trace.reference });
  }
  if (evidence.explanationPolicy !== null) {
    supplied.push({ role: 'explanation_policy', reference: evidence.explanationPolicy.reference });
  }
  if (evidence.lineageGraph !== null) {
    supplied.push({ role: 'lineage_graph', reference: evidence.lineageGraph.reference });
  }
  for (const benchmark of evidence.pickBenchmarks) {
    supplied.push({ role: 'pick_benchmark', reference: benchmark.reference });
  }
  for (const observation of evidence.playerObservations) {
    supplied.push({ role: 'player_observation', reference: observation.reference });
  }
  return supplied;
}

function resolvedDerivedInputs(
  evidence: PrivateValuationTradeResolvedEvidence
): readonly PrivateValuationTradeConstructionDerivedInput[] {
  const derived: PrivateValuationTradeConstructionDerivedInput[] = [];
  if (evidence.valuationCase !== null) derived.push('valuation_case');
  if (evidence.componentDrawSet !== null) derived.push('component_draw_set');
  if (evidence.realizedContributionLedger !== null) derived.push('realized_contribution_ledger');
  if (evidence.packagePolicy !== null) derived.push('package_policy');
  return derived;
}

/**
 * The two component roles are the release's admitted model evidence, so a set that does not carry
 * exactly one of each is a selection gap rather than a plan the assembler may repair.
 */
function resolvedBindings(
  evidence: PrivateValuationTradeResolvedEvidence
): readonly PrivateValuationTradeConstructionBinding[] {
  const bindings: PrivateValuationTradeConstructionBinding[] = [];
  if (
    evidence.createdAt !== null &&
    evidence.factualReleaseId !== null &&
    evidence.valuationInputBundleId !== null
  ) {
    bindings.push('release_binding');
  }
  const roles = new Set(evidence.components.map((component) => component.role));
  if (evidence.components.length === 2 && roles.size === 2) {
    bindings.push('selected_component_authority');
  }
  return bindings;
}

/** A planner `ready` verdict is a proof, so reaching here without the document is a defect, not a gap. */
function required<T>(value: T | null, name: string): T {
  if (value === null) throw new TypeError(`Trade construction planned ready without ${name}.`);
  return value;
}

/**
 * Assembles one cohort member's construction input from evidence a caller actually resolved, then
 * hands it to the compatibility-checked construction boundary.
 *
 * The plan is computed from the same evidence object that is assembled, and it runs *before* the
 * boundary is called, so a trade whose release, model authority, or retained documents did not resolve
 * returns named blockers instead of an outcome that reads like a valuation.
 */
export async function assemblePrivateValuationTradeConstruction(input: {
  readonly tradeId: string;
  readonly sealedCohortTradeIds: readonly string[];
  readonly inspectedEvidenceRefs: readonly AflTradeArtifactRef[];
  readonly evidence: PrivateValuationTradeResolvedEvidence;
  readonly compatibility: PrivateValuationTradeConstructionCompatibility;
  /** Injected so a caller can prove the assembled input without holding a signed release. */
  readonly construct?: PrivateValuationTradeConstructor;
}): Promise<PrivateValuationTradeConstructionOutcome> {
  const evidence = input.evidence;
  const plan = planPrivateValuationTradeConstruction({
    tradeId: input.tradeId,
    sealedCohortTradeIds: input.sealedCohortTradeIds,
    supplied: resolvedSuppliedRoles(evidence),
    derived: resolvedDerivedInputs(evidence),
    bindings: resolvedBindings(evidence),
    inspectedEvidenceRefs: input.inspectedEvidenceRefs,
  });
  if (plan.state === 'blocked') return { state: 'blocked', blockers: plan.blockers };

  const construct = input.construct ?? constructAflTradeCompatibleCurrentValuationTrade;
  return construct(
    {
      state: 'ready',
      createdAt: required(evidence.createdAt, 'createdAt'),
      factualReleaseId: required(evidence.factualReleaseId, 'factualReleaseId'),
      valuationInputBundleId: required(evidence.valuationInputBundleId, 'valuationInputBundleId'),
      components: evidence.components,
      trace: required(evidence.trace, 'trace'),
      explanationPolicy: required(evidence.explanationPolicy, 'explanationPolicy'),
      valuationCase: required(evidence.valuationCase, 'valuationCase'),
      componentDrawSet: required(evidence.componentDrawSet, 'componentDrawSet'),
      realizedContributionLedger: required(
        evidence.realizedContributionLedger,
        'realizedContributionLedger'
      ),
      packagePolicy: required(evidence.packagePolicy, 'packagePolicy'),
      lineageGraph: required(evidence.lineageGraph, 'lineageGraph'),
      pickBenchmarks: evidence.pickBenchmarks,
      playerObservations: evidence.playerObservations,
    },
    input.compatibility
  );
}
