import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import {
  aflTradePickPavDistributionBenchmarkSchema,
  type AflTradePickPavDistributionBenchmark,
} from '../modeling/pickPavDistributionBenchmark';
import {
  aflTradePlayerPavObservationSchema,
  type AflTradePlayerPavObservation,
} from '../modeling/playerPavObservationContracts';
import type { AflTradeComponentDrawSet } from './componentDrawSet';
import type { AflTradeConstructedCurrentValuationTrade } from './currentValuationTradePreparation';
import {
  createGovernedPrivateEvaluationMaterializationManifest,
  type GovernedPrivateEvaluationMaterializationManifest,
} from './internal/governedPrivateEvaluationMaterializationManifest';
import type { GovernedPrivateEvaluationExplanationPolicy } from './internal/governedPrivateEvaluationExplanationPolicy';
import type { GovernedPrivateEvaluationInputTrace } from './internal/governedPrivateEvaluationInputTrace';
import { replayGovernedPrivateEvaluationMaterialization } from './internal/governedPrivateEvaluationMaterializer';
import type { AflTradePackagePolicy } from './packagePolicy';
import {
  aflTradeValuationInputBlockerSchema,
  aflTradeValuationInputBlockersSchema,
  type AflTradeValuationInputBlocker,
} from './preparedValuationInputSet';
import type { AflTradeRealizedContributionLedger } from './realizedContributionLedger';
import {
  createAflTradeValuationCalculationInputPackage,
  type AflTradeValuationCalculationInputPackage,
} from './valuationCalculationInputPackage';
import { createAflTradeLineageGraphId, type AflTradeValuationCase } from './valuationCaseContracts';

type ComponentAuthority = GovernedPrivateEvaluationInputTrace['content']['components'][number];

type RetainedEvidence<T> = Readonly<{
  value: T;
  reference: AflTradeArtifactRef;
  bytes: Uint8Array;
}>;

type ReadyConstructionInput = Readonly<{
  state: 'ready';
  createdAt: string;
  factualReleaseId: string;
  valuationInputBundleId: string;
  /** Exact components selected by the caller's retained run/Gate authority, independently of trace. */
  components: readonly ComponentAuthority[];
  trace: RetainedEvidence<GovernedPrivateEvaluationInputTrace>;
  explanationPolicy: RetainedEvidence<GovernedPrivateEvaluationExplanationPolicy>;
  valuationCase: AflTradeValuationCase;
  componentDrawSet: AflTradeComponentDrawSet;
  realizedContributionLedger: AflTradeRealizedContributionLedger;
  packagePolicy: AflTradePackagePolicy;
  lineageGraph: RetainedEvidence<AflTradeLineageGraph>;
  pickBenchmarks: readonly RetainedEvidence<AflTradePickPavDistributionBenchmark>[];
  playerObservations: readonly RetainedEvidence<AflTradePlayerPavObservation>[];
}>;

type ConstructionInput =
  | ReadyConstructionInput
  | Readonly<{ state: 'blocked'; blockers: readonly AflTradeValuationInputBlocker[] }>;

type RetainedParent = Readonly<{ reference: AflTradeArtifactRef; bytes: Uint8Array }>;

function retainedParent(value: unknown, createdAt: string): RetainedParent {
  return {
    reference: createAflTradeCanonicalJsonArtifactRef(value, createdAt),
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
  };
}

function authenticateRetainedEvidence<T>(evidence: RetainedEvidence<T>, createdAt: string): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(evidence.bytes));
  } catch {
    throw new TypeError('Authenticated trade construction parent is not valid JSON.');
  }
  if (
    Date.parse(evidence.reference.createdAt) > Date.parse(createdAt) ||
    !doesAflTradeArtifactRefMatchBytes(evidence.reference, evidence.bytes, 'application/json') ||
    !doesAflTradeArtifactRefMatchCanonicalJson(evidence.reference, evidence.value) ||
    canonicalizeAflTradeJson(decoded) !== canonicalizeAflTradeJson(evidence.value)
  ) {
    throw new TypeError(
      'Authenticated trade construction parent does not match exact retained evidence.'
    );
  }
  return evidence.value;
}

function assertSelectedAuthority(input: ReadyConstructionInput): void {
  const trace = input.trace.value.content;
  const selected = new Map(input.components.map((component) => [component.role, component]));
  const traced = new Map(trace.components.map((component) => [component.role, component]));
  const drawn = new Map(
    input.componentDrawSet.content.components.map(({ role, runId }) => [role, runId])
  );
  if (
    trace.factualReleaseId !== input.factualReleaseId ||
    trace.valuationInputBundleId !== input.valuationInputBundleId ||
    input.valuationCase.content.valuationInputBundleId !== input.valuationInputBundleId ||
    input.componentDrawSet.content.valuationInputBundleId !== input.valuationInputBundleId ||
    input.realizedContributionLedger.content.valuationInputBundleId !==
      input.valuationInputBundleId ||
    input.packagePolicy.content.valuationInputBundleId !== input.valuationInputBundleId ||
    input.components.length !== 2 ||
    selected.size !== 2 ||
    trace.components.length !== 2 ||
    input.componentDrawSet.content.components.length !== 2 ||
    [...selected].some(
      ([role, component]) =>
        canonicalizeAflTradeJson(traced.get(role)) !== canonicalizeAflTradeJson(component) ||
        drawn.get(role) !== component.runId
    )
  ) {
    throw new TypeError(
      'Authenticated trade construction does not match selected release, bundle, or component authority.'
    );
  }
}

function createCalculationInput(
  input: ReadyConstructionInput
): AflTradeValuationCalculationInputPackage {
  return createAflTradeValuationCalculationInputPackage({
    schemaVersion: 'afl-trade-valuation-calculation-input-package/v2',
    authority: {
      kind: 'authenticated_non_production',
      inputTraceId: input.trace.value.inputTraceId,
      publicationProhibited: true,
    },
    tradeId: input.trace.value.content.selector.tradeId,
    valuationInputBundleId: input.valuationInputBundleId,
    valuationCase: input.valuationCase,
    componentDrawSet: input.componentDrawSet,
    realizedContributionLedger: input.realizedContributionLedger,
    packagePolicy: input.packagePolicy,
    createdAt: input.createdAt,
    publicationEligible: false,
    limitation:
      'Calculation input only; not a result, model approval, publication approval, or activation authority.',
  });
}

function createManifest(input: {
  ready: ReadyConstructionInput;
  calculation: AflTradeValuationCalculationInputPackage;
  calculationParent: RetainedParent;
  traceParent: RetainedParent;
  explanationParent: RetainedParent;
  lineageParent: RetainedParent;
  pickParents: readonly RetainedParent[];
  playerParents: readonly RetainedParent[];
}): GovernedPrivateEvaluationMaterializationManifest {
  return createGovernedPrivateEvaluationMaterializationManifest({
    schemaVersion: 'private-evaluation-materialization-manifest/v1',
    environment: 'non_production',
    selector: input.ready.trace.value.content.selector,
    calculationInputPackageId: input.calculation.calculationInputPackageId,
    calculationInputArtifact: input.calculationParent.reference,
    inputTraceId: input.ready.trace.value.inputTraceId,
    inputTraceArtifact: input.traceParent.reference,
    explanationPolicyId: input.ready.explanationPolicy.value.policyId,
    explanationPolicyArtifact: input.explanationParent.reference,
    lineageGraphId: createAflTradeLineageGraphId(input.ready.lineageGraph.value),
    lineageGraphArtifact: input.lineageParent.reference,
    pickBenchmarks: input.ready.pickBenchmarks.map((benchmark, index) => ({
      benchmarkId: benchmark.value.benchmarkId,
      artifact: input.pickParents[index]!.reference,
    })),
    playerObservations: input.ready.playerObservations.map((observation, index) => ({
      observationId: observation.value.observationId,
      artifact: input.playerParents[index]!.reference,
    })),
    createdAt: input.ready.createdAt,
    publicationEligible: false,
    limitation:
      'Private materialization inputs only; not model, grade, activation, production, or publication authority.',
  });
}

/**
 * Package already constructed inputs for the existing trade preparer. The caller must select
 * components through retained run/Gate authority independently of the trace and load retained
 * evidence from its repository. Byte integrity here does not grant source, model or custody
 * authority, nor derive forecasts, lineage, or realized measurements.
 */
export function constructAflTradeAuthenticatedCurrentValuationTrade(
  input: ConstructionInput
): AflTradeConstructedCurrentValuationTrade {
  if (input.state === 'blocked') {
    return {
      state: 'blocked',
      blockers: aflTradeValuationInputBlockersSchema.parse(
        input.blockers
          .map((blocker) => aflTradeValuationInputBlockerSchema.parse(blocker))
          .sort((left, right) => {
            const leftKey = `${left.code}\0${left.subject.kind}\0${left.subject.id}`;
            const rightKey = `${right.code}\0${right.subject.kind}\0${right.subject.id}`;
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
          })
      ),
    };
  }
  const trace = authenticateRetainedEvidence(input.trace, input.createdAt);
  const explanationPolicy = authenticateRetainedEvidence(input.explanationPolicy, input.createdAt);
  const lineageGraph = authenticateRetainedEvidence(input.lineageGraph, input.createdAt);
  assertSelectedAuthority(input);
  const pickBenchmarks = input.pickBenchmarks.map((value) =>
    aflTradePickPavDistributionBenchmarkSchema.parse(
      authenticateRetainedEvidence(value, input.createdAt)
    )
  );
  const playerObservations = input.playerObservations.map((value) =>
    aflTradePlayerPavObservationSchema.parse(authenticateRetainedEvidence(value, input.createdAt))
  );
  const calculation = createCalculationInput(input);
  const calculationParent = retainedParent(calculation, input.createdAt);
  const traceParent = {
    reference: aflTradeArtifactRefSchema.parse(input.trace.reference),
    bytes: Uint8Array.from(input.trace.bytes),
  };
  const explanationParent = {
    reference: aflTradeArtifactRefSchema.parse(input.explanationPolicy.reference),
    bytes: Uint8Array.from(input.explanationPolicy.bytes),
  };
  const lineageParent = {
    reference: aflTradeArtifactRefSchema.parse(input.lineageGraph.reference),
    bytes: Uint8Array.from(input.lineageGraph.bytes),
  };
  const pickParents = input.pickBenchmarks.map(({ reference, bytes }) => ({
    reference: aflTradeArtifactRefSchema.parse(reference),
    bytes: Uint8Array.from(bytes),
  }));
  const playerParents = input.playerObservations.map(({ reference, bytes }) => ({
    reference: aflTradeArtifactRefSchema.parse(reference),
    bytes: Uint8Array.from(bytes),
  }));
  const manifest = createManifest({
    ready: input,
    calculation,
    calculationParent,
    traceParent,
    explanationParent,
    lineageParent,
    pickParents,
    playerParents,
  });
  const replay = replayGovernedPrivateEvaluationMaterialization({
    materializationManifest: manifest,
    trace,
    calculationInputPackage: calculation,
    explanationPolicy,
    lineageGraph,
    pickBenchmarks,
    playerObservations,
  });
  if (replay.state !== 'ready') {
    throw new TypeError('Authenticated trade construction did not replay as complete evidence.');
  }
  const retainedParents = [
    calculationParent,
    traceParent,
    explanationParent,
    lineageParent,
    ...pickParents,
    ...playerParents,
  ].sort((left, right) => left.reference.artifactId.localeCompare(right.reference.artifactId));
  return {
    state: 'ready',
    manifest,
    manifestArtifact: createAflTradeCanonicalJsonArtifactRef(manifest, input.createdAt),
    retainedParents,
  };
}
