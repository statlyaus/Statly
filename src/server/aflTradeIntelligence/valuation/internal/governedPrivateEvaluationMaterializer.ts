import { doesAflTradeArtifactRefMatchCanonicalJson } from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeLineageGraph } from '../../domain/lineageTypes';
import {
  aflTradePickPavDistributionBenchmarkSchema,
  type AflTradePickPavDistributionBenchmark,
} from '../../modeling/pickPavDistributionBenchmark';
import {
  aflTradePlayerPavObservationSchema,
  type AflTradePlayerPavObservation,
} from '../../modeling/playerPavObservationContracts';
import { deriveAflTradeAssetLineageNarrativeEvidence } from '../assetLineageNarrativeEvidence';
import {
  deriveAflTradePickCalculationEvidence,
  deriveAflTradePlayerCalculationEvidence,
} from '../calculationNarrativeEvidence';
import { createAflTradeCalculationNarrative } from '../tradeCalculationNarrative';
import {
  createGovernedAflTradeValuationExplanation,
  type AflTradeValuationExplanationDocument,
} from '../tradeValuationExplanation';
import {
  aflTradeValuationCalculationInputPackageSchema,
  type AflTradeValuationCalculationInputPackage,
} from '../valuationCalculationInputPackage';
import { createAflTradeLineageGraphId } from '../valuationCaseContracts';
import {
  governedPrivateEvaluationExplanationPolicySchema,
  type GovernedPrivateEvaluationExplanationPolicy,
} from './governedPrivateEvaluationExplanationPolicy';
import {
  governedPrivateEvaluationInputTraceSchema,
  type GovernedPrivateEvaluationInputTrace,
} from './governedPrivateEvaluationInputTrace';
import {
  governedPrivateEvaluationMaterializationManifestSchema,
  type GovernedPrivateEvaluationMaterializationManifest,
} from './governedPrivateEvaluationMaterializationManifest';

export type GovernedPrivateEvaluationMaterializationBlockerCode =
  | 'incomplete_numeric_evidence'
  | 'pick_benchmark_missing'
  | 'pick_model_support_unavailable'
  | 'pick_selection_unresolved'
  | 'player_evidence_missing'
  | 'player_evidence_unavailable';

export interface GovernedPrivateEvaluationMaterializationBlocker {
  readonly code: GovernedPrivateEvaluationMaterializationBlockerCode;
  readonly assetId: string | null;
  readonly message: string;
}

export interface MaterializeGovernedPrivateEvaluationInput {
  readonly trace: GovernedPrivateEvaluationInputTrace;
  readonly explanationPolicy: GovernedPrivateEvaluationExplanationPolicy;
  readonly calculationInputPackage: AflTradeValuationCalculationInputPackage;
  readonly pickBenchmarks: readonly AflTradePickPavDistributionBenchmark[];
  readonly playerObservations: readonly AflTradePlayerPavObservation[];
  readonly lineageGraph: AflTradeLineageGraph;
}

export interface ReplayGovernedPrivateEvaluationMaterializationInput
  extends MaterializeGovernedPrivateEvaluationInput {
  readonly materializationManifest: GovernedPrivateEvaluationMaterializationManifest;
}

export type GovernedPrivateEvaluationMaterializationResult =
  | Readonly<{
      state: 'ready';
      explanation: AflTradeValuationExplanationDocument;
      narrative: ReturnType<typeof createAflTradeCalculationNarrative>;
      publicationEligible: false;
    }>
  | Readonly<{
      state: 'unavailable';
      tradeId: string;
      blockers: readonly GovernedPrivateEvaluationMaterializationBlocker[];
    }>;

type MaterializedEvidence = Parameters<
  typeof createAflTradeCalculationNarrative
>[0]['assets'][number];

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function uniqueById<T>(
  values: readonly T[],
  idOf: (value: T) => string,
  label: string
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = idOf(value);
    if (result.has(id)) {
      throw new TypeError(`Governed materialization received duplicate ${label} identity.`);
    }
    result.set(id, value);
  }
  return result;
}

function addDisplayIdentity(
  identities: Map<string, string>,
  id: string,
  label: string,
  kind: 'asset' | 'club'
): void {
  const known = identities.get(id);
  if (known !== undefined && known !== label) {
    throw new TypeError(`Governed materialization found conflicting ${kind} display identity.`);
  }
  identities.set(id, label);
}

function displayIdentity(trace: GovernedPrivateEvaluationInputTrace) {
  const assets = new Map<string, string>();
  const clubs = new Map<string, string>();
  for (const { assetId, displayLabel } of trace.content.transaction.transfers) {
    addDisplayIdentity(assets, assetId, displayLabel, 'asset');
  }
  for (const { assetId, playerName, acquisitionSpells } of trace.content.playerHorizons) {
    addDisplayIdentity(assets, assetId, playerName, 'asset');
    for (const spell of acquisitionSpells) {
      addDisplayIdentity(clubs, spell.clubId, spell.clubName, 'club');
    }
  }
  for (const lineage of trace.content.pickLineages) {
    addDisplayIdentity(assets, lineage.rootAssetId, lineage.pickIdentityLabel, 'asset');
    for (const transformation of lineage.transformations) {
      for (const label of transformation.assetLabels) {
        addDisplayIdentity(assets, label.assetId, label.displayLabel, 'asset');
      }
    }
    for (const custody of lineage.custody) {
      addDisplayIdentity(clubs, custody.clubId, custody.clubName, 'club');
    }
  }
  for (const club of trace.content.transaction.clubs) {
    addDisplayIdentity(clubs, club.aflClubId, club.clubName, 'club');
  }
  return {
    assets: [...assets].map(([assetId, label]) => ({ assetId, label })),
    clubs: [...clubs].map(([aflClubId, clubName]) => ({ aflClubId, clubName })),
  };
}

function assertPlayerAncestry(
  trace: GovernedPrivateEvaluationInputTrace,
  horizon: GovernedPrivateEvaluationInputTrace['content']['playerHorizons'][number],
  observation: AflTradePlayerPavObservation
): void {
  const spell = horizon.acquisitionSpells.find(
    ({ spellVersionId }) => spellVersionId === observation.acquisitionSpell.spellVersionId
  );
  const requiredSeasons = horizon.requiredSeasons.map(({ season }) => season);
  const observedDeparture = observation.acquisitionSpell.effectiveThrough;
  const tracedDeparture = spell?.departedAt?.slice(0, 10) ?? null;
  if (
    observation.observationId !== horizon.playerObservationId ||
    observation.releaseId !== trace.content.factualReleaseId ||
    observation.playerId !== horizon.playerId ||
    observation.acquisitionSpell.clubId !== horizon.receivingClubId ||
    spell === undefined ||
    observation.acquisitionSpell.effectiveFrom !== spell.joinedAt.slice(0, 10) ||
    observedDeparture !== tracedDeparture ||
    !exactJson(observation.targetCalculationSeasons, requiredSeasons) ||
    Date.parse(observation.outcomeObservedAt) > Date.parse(trace.content.derivedAt) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(horizon.playerObservationArtifact, observation)
  ) {
    throw new TypeError(
      'Governed materialization player evidence does not match its exact release, horizon, spell, or retained artifact.'
    );
  }
}

function unavailable(
  tradeId: string,
  blockers: readonly GovernedPrivateEvaluationMaterializationBlocker[]
): GovernedPrivateEvaluationMaterializationResult {
  return { state: 'unavailable', tradeId, blockers };
}

/**
 * Authenticates retained calculation parents, derives all model and lineage evidence, then creates
 * one complete four-view explanation and reader narrative. It never accepts caller-supplied values,
 * stories, or grades, and it never returns a partially materialized calculation.
 */
export function materializeGovernedPrivateEvaluation(
  input: MaterializeGovernedPrivateEvaluationInput
): GovernedPrivateEvaluationMaterializationResult {
  const trace = governedPrivateEvaluationInputTraceSchema.parse(input.trace);
  const explanationPolicy = governedPrivateEvaluationExplanationPolicySchema.parse(
    input.explanationPolicy
  );
  const calculationInputPackage = aflTradeValuationCalculationInputPackageSchema.parse(
    input.calculationInputPackage
  );
  const pickBenchmarks = input.pickBenchmarks.map((benchmark) =>
    aflTradePickPavDistributionBenchmarkSchema.parse(benchmark)
  );
  const playerObservations = input.playerObservations.map((observation) =>
    aflTradePlayerPavObservationSchema.parse(observation)
  );
  const benchmarkById = uniqueById(
    pickBenchmarks,
    ({ benchmarkId }) => benchmarkId,
    'pick benchmark'
  );
  const playerObservationById = uniqueById(
    playerObservations,
    ({ observationId }) => observationId,
    'player observation'
  );
  const tradeId = trace.content.selector.tradeId;

  if (
    createAflTradeLineageGraphId(input.lineageGraph) !==
    calculationInputPackage.content.valuationCase.content.lineageGraphId
  ) {
    throw new TypeError(
      'Governed materialization lineage graph does not match the calculation input package.'
    );
  }

  const blockers: GovernedPrivateEvaluationMaterializationBlocker[] = [];
  const modelEvidence = new Map<
    string,
    MaterializedEvidence['modelEvidence']
  >();
  for (const horizon of trace.content.playerHorizons) {
    const observation = playerObservationById.get(horizon.playerObservationId);
    if (observation === undefined) {
      blockers.push({
        code: 'player_evidence_missing',
        assetId: horizon.assetId,
        message: `${horizon.playerName} has no retained authenticated player observation.`,
      });
      continue;
    }
    assertPlayerAncestry(trace, horizon, observation);
    const evidence = deriveAflTradePlayerCalculationEvidence(observation);
    if (evidence.state === 'unavailable') {
      blockers.push({
        code: 'player_evidence_unavailable',
        assetId: horizon.assetId,
        message: `${horizon.playerName} evidence is unavailable (${evidence.reason}).`,
      });
      continue;
    }
    modelEvidence.set(horizon.assetId, evidence);
  }
  for (const lineage of trace.content.pickLineages) {
    if (lineage.resolvedSelectionNumber === null) {
      blockers.push({
        code: 'pick_selection_unresolved',
        assetId: lineage.rootAssetId,
        message: `${lineage.pickIdentityLabel} has no authenticated resolved selection number.`,
      });
      continue;
    }
    const benchmark = benchmarkById.get(lineage.pickBenchmarkId);
    if (benchmark === undefined) {
      blockers.push({
        code: 'pick_benchmark_missing',
        assetId: lineage.rootAssetId,
        message: `${lineage.pickIdentityLabel} has no retained authenticated pick benchmark.`,
      });
      continue;
    }
    if (
      benchmark.content.observationSetId !== lineage.pickObservationSetId ||
      benchmark.content.valueUnit !==
        calculationInputPackage.content.valuationCase.content.valueUnitId ||
      !doesAflTradeArtifactRefMatchCanonicalJson(lineage.pickBenchmarkArtifact, benchmark)
    ) {
      throw new TypeError(
        'Governed materialization pick evidence does not match its observation set, value unit, or retained artifact.'
      );
    }
    try {
      modelEvidence.set(
        lineage.rootAssetId,
        deriveAflTradePickCalculationEvidence(benchmark, lineage.resolvedSelectionNumber)
      );
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      blockers.push({
        code: 'pick_model_support_unavailable',
        assetId: lineage.rootAssetId,
        message: `${lineage.pickIdentityLabel} is outside the authenticated pick-model support.`,
      });
    }
  }
  if (blockers.length > 0) return unavailable(tradeId, blockers);

  const currentContext = calculationInputPackage.content.valuationCase.content.viewContexts.find(
    ({ view }) => view === 'current'
  )!;
  const display = displayIdentity(trace);
  const evidencePackages: MaterializedEvidence[] = trace.content.transaction.transfers.map(
    ({ assetId }) => {
      const evidence = modelEvidence.get(assetId);
      if (evidence === undefined) {
        throw new TypeError('Governed materialization is missing evidence for a transaction root.');
      }
      return {
        assetId,
        modelEvidence: evidence,
        lineage: deriveAflTradeAssetLineageNarrativeEvidence(
          input.lineageGraph,
          assetId,
          {
            effectiveAsOf: currentContext.effectiveAt,
            knowledgeCutoffAt: currentContext.knowledgeCutoffAt,
          },
          display
        ),
      };
    }
  );
  const explanationResult = createGovernedAflTradeValuationExplanation({
    trace,
    explanationPolicy,
    calculationInputPackage,
  });
  if (explanationResult.state === 'unavailable') {
    return unavailable(tradeId, [
      {
        code: 'incomplete_numeric_evidence',
        assetId: null,
        message: explanationResult.explanation,
      },
    ]);
  }
  const narrative = createAflTradeCalculationNarrative({
    explanation: explanationResult.document,
    assets: evidencePackages,
  });
  return {
    state: 'ready',
    explanation: explanationResult.document,
    narrative,
    publicationEligible: false,
  };
}

/** Authenticates the bounded retained-parent manifest before replaying deterministic materialization. */
export function replayGovernedPrivateEvaluationMaterialization(
  input: ReplayGovernedPrivateEvaluationMaterializationInput
): GovernedPrivateEvaluationMaterializationResult {
  const manifest = governedPrivateEvaluationMaterializationManifestSchema.parse(
    input.materializationManifest
  );
  const content = manifest.content;
  const pickBenchmarks = [...input.pickBenchmarks].sort((left, right) =>
    left.benchmarkId.localeCompare(right.benchmarkId)
  );
  const playerObservations = [...input.playerObservations].sort((left, right) =>
    left.observationId.localeCompare(right.observationId)
  );
  const pickParents = content.pickBenchmarks;
  const playerParents = content.playerObservations;
  if (
    !exactJson(content.selector, input.trace.content.selector) ||
    content.calculationInputPackageId !== input.calculationInputPackage.calculationInputPackageId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      content.calculationInputArtifact,
      input.calculationInputPackage
    ) ||
    content.inputTraceId !== input.trace.inputTraceId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(content.inputTraceArtifact, input.trace) ||
    content.explanationPolicyId !== input.explanationPolicy.policyId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      content.explanationPolicyArtifact,
      input.explanationPolicy
    ) ||
    content.lineageGraphId !== createAflTradeLineageGraphId(input.lineageGraph) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(content.lineageGraphArtifact, input.lineageGraph) ||
    pickParents.length !== pickBenchmarks.length ||
    pickParents.some(
      (parent, index) =>
        parent.benchmarkId !== pickBenchmarks[index]?.benchmarkId ||
        !doesAflTradeArtifactRefMatchCanonicalJson(parent.artifact, pickBenchmarks[index])
    ) ||
    playerParents.length !== playerObservations.length ||
    playerParents.some(
      (parent, index) =>
        parent.observationId !== playerObservations[index]?.observationId ||
        !doesAflTradeArtifactRefMatchCanonicalJson(parent.artifact, playerObservations[index])
    )
  ) {
    throw new TypeError(
      'Governed materialization replay does not match its exact retained-parent manifest.'
    );
  }
  return materializeGovernedPrivateEvaluation(input);
}
