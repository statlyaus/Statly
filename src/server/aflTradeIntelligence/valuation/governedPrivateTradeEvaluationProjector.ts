import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  governedPrivateValuationCalculationInputSchema,
  type GovernedPrivateValuationCalculationInput,
} from './governedPrivateValuationCalculationInput';
import type { GovernedPrivateValuationExplanationAssembly } from './governedPrivateValuationExplanation';
import type { GovernedPrivateValuationRun } from './governedPrivateValuationRun';
import {
  createLocalPrivateTradeEvaluationGenerationV2,
  type LocalPrivateTradeEvaluationGenerationV2,
  type LocalPrivateTradeEvaluationGenerationV2Input,
} from './localPrivateTradeEvaluationGenerationV2';
import {
  privateGovernedPickEvidenceAdmissionSchema,
  type PrivateGovernedPickEvidenceAdmission,
} from './privateGovernedPickEvidence';
import {
  privateGovernedPlayerEvidenceAdmissionSchema,
  type PrivateGovernedPlayerEvidenceAdmission,
} from './privateGovernedPlayerEvidence';

type AssetInput = LocalPrivateTradeEvaluationGenerationV2Input['assets'][number];
type AssetView = AssetInput['views']['current'];
type ClubInput = LocalPrivateTradeEvaluationGenerationV2Input['clubTotals'][number];
type ExplanationDocument = Extract<
  GovernedPrivateValuationExplanationAssembly['explanation'],
  { state: 'available' }
>['document'];

export type GovernedPrivateProjectionAssetEvidence =
  | {
      readonly kind: 'player';
      readonly admission: PrivateGovernedPlayerEvidenceAdmission;
      readonly admissionArtifact: AflTradeArtifactRef;
    }
  | {
      readonly kind: 'pick';
      readonly admission: PrivateGovernedPickEvidenceAdmission;
      readonly admissionArtifact: AflTradeArtifactRef;
    };

export interface ProjectGovernedPrivateTradeEvaluationInput {
  readonly calculationInput: GovernedPrivateValuationCalculationInput;
  readonly run: GovernedPrivateValuationRun;
  readonly explanation: GovernedPrivateValuationExplanationAssembly;
  readonly assetEvidence: readonly GovernedPrivateProjectionAssetEvidence[];
  readonly workbookSha256: string;
  readonly generatedAt: string;
}

const viewPairs = [
  ['atTrade', 'at_trade'],
  ['realized', 'realized'],
  ['remaining', 'remaining'],
  ['current', 'current'],
] as const;

function uniqueEvidence(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  const retained = new Map<string, AflTradeArtifactRef>();
  for (const reference of references) {
    const previous = retained.get(reference.artifactId);
    if (previous && !doAflTradeArtifactRefsExactlyMatch(previous, reference)) {
      throw new TypeError('Governed projection evidence disagrees for one artifact ID.');
    }
    retained.set(reference.artifactId, reference);
  }
  return [...retained.values()].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
}

function authenticatedEvidence(
  evidence: GovernedPrivateProjectionAssetEvidence,
  confirmedResultArtifact: AflTradeArtifactRef
): GovernedPrivateProjectionAssetEvidence {
  const admission =
    evidence.kind === 'player'
      ? privateGovernedPlayerEvidenceAdmissionSchema.parse(evidence.admission)
      : privateGovernedPickEvidenceAdmissionSchema.parse(evidence.admission);
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(evidence.admissionArtifact, admission) ||
    !doAflTradeArtifactRefsExactlyMatch(
      admission.content.confirmedResultArtifact,
      confirmedResultArtifact
    )
  ) {
    throw new TypeError(
      'Governed projection requires an exact admission for the confirmed result.'
    );
  }
  return { ...evidence, admission } as GovernedPrivateProjectionAssetEvidence;
}

function playerHorizons(
  evidence: Extract<GovernedPrivateProjectionAssetEvidence, { kind: 'player' }>
): AssetInput['evidenceHorizons'] {
  return evidence.admission.content.horizons.map((horizon) => {
    const retained = {
      season: horizon.season,
      gamesPlayed: horizon.gamesPlayed,
      effectiveThrough: horizon.effectiveThrough.slice(0, 10),
      evidenceRefs: uniqueEvidence([
        evidence.admissionArtifact,
        horizon.calculationArtifact,
        horizon.coverageEvidenceRef,
      ]),
    };
    return horizon.kind === 'current_season'
      ? { ...retained, kind: 'current_season' as const, coverage: horizon.coverage }
      : { ...retained, kind: 'completed_season' as const };
  });
}

function pickHorizons(
  evidence: Extract<GovernedPrivateProjectionAssetEvidence, { kind: 'pick' }>
): AssetInput['evidenceHorizons'] {
  return evidence.admission.content.selectedPlayerHorizons.map((horizon) => {
    const retained = {
      season: horizon.season,
      gamesPlayed: horizon.gamesPlayed,
      effectiveThrough: horizon.effectiveThrough.slice(0, 10),
      evidenceRefs: uniqueEvidence([
        evidence.admissionArtifact,
        evidence.admission.content.observationArtifact,
      ]),
    };
    return horizon.kind === 'current_season'
      ? { ...retained, kind: 'current_season' as const, coverage: horizon.coverage }
      : { ...retained, kind: 'completed_season' as const };
  });
}

function componentsFor(input: {
  contribution: ExplanationDocument['views'][number]['clubs'][number]['received']['assets'][number];
  viewKey: (typeof viewPairs)[number][0];
  evidence: GovernedPrivateProjectionAssetEvidence;
  evidenceRefs: readonly AflTradeArtifactRef[];
}): Extract<AssetView, { state: 'calculated' }>['components'] {
  const components = [
    {
      componentId: 'valuation:gross',
      label: 'Gross governed value',
      score: input.contribution.layers.grossMean,
      evidenceRefs: [...input.evidenceRefs],
    },
    {
      componentId: 'valuation:list-spot-delta',
      label: 'List-spot adjustment',
      score: input.contribution.layers.listSpotDelta,
      evidenceRefs: [...input.evidenceRefs],
    },
    {
      componentId: 'valuation:scarcity-delta',
      label: 'Scarcity adjustment',
      score: input.contribution.layers.scarcityDelta,
      evidenceRefs: [...input.evidenceRefs],
    },
  ];
  if (input.viewKey === 'realized') {
    if (input.evidence.kind === 'player') {
      for (const [componentId, label, field] of [
        ['hpn:defensive-pav', 'Defensive PAV', 'defensivePav'],
        ['hpn:midfield-pav', 'Midfield PAV', 'midfieldPav'],
        ['hpn:offensive-pav', 'Offensive PAV', 'offensivePav'],
      ] as const) {
        components.push({
          componentId,
          label,
          score: input.evidence.admission.content.horizons.reduce(
            (sum, horizon) => sum + horizon.components[field],
            0
          ),
          evidenceRefs: [...input.evidenceRefs],
        });
      }
    } else {
      const contribution = input.evidence.admission.content.realizedContribution;
      components.push({
        componentId: 'pick:selected-player-realized-contribution',
        label: 'Selected-player realized contribution',
        score:
          contribution.state === 'mature_observed'
            ? contribution.contribution
            : contribution.contributionObservedToDate,
        evidenceRefs: [...input.evidenceRefs],
      });
    }
  }
  if (input.viewKey === 'current' && input.contribution.currentComponents) {
    components.push(
      {
        componentId: 'valuation:current-realized',
        label: 'Current realized component',
        score: input.contribution.currentComponents.realizedMean,
        evidenceRefs: [...input.evidenceRefs],
      },
      {
        componentId: 'valuation:current-remaining',
        label: 'Current remaining component',
        score: input.contribution.currentComponents.remainingMean,
        evidenceRefs: [...input.evidenceRefs],
      }
    );
  }
  return components.sort((left, right) => left.componentId.localeCompare(right.componentId));
}

function assetFor(input: {
  document: ExplanationDocument;
  evidence: GovernedPrivateProjectionAssetEvidence;
  explanationArtifact: AflTradeArtifactRef;
  directionEvidenceArtifact: AflTradeArtifactRef;
  calculationArtifact: AflTradeArtifactRef;
  modelRunArtifact: AflTradeArtifactRef;
}): AssetInput {
  const assetId = input.evidence.admission.content.assetId;
  const contributions = viewPairs.map(([viewKey, explanationView]) => {
    const view = input.document.views.find(({ view }) => view === explanationView);
    const candidates =
      view?.clubs.flatMap(({ received }) =>
        received.assets.filter((asset) => asset.assetId === assetId)
      ) ?? [];
    if (candidates.length !== 1) {
      throw new TypeError('Every admitted asset requires one contribution in every view.');
    }
    return [viewKey, candidates[0]!] as const;
  });
  const canonicalContribution = contributions[0]![1];
  const receivingClubId = input.evidence.admission.content.receivingClubId;
  if (
    canonicalContribution.toClubId !== receivingClubId ||
    contributions.some(
      ([, contribution]) =>
        contribution.fromClubId !== canonicalContribution.fromClubId ||
        contribution.toClubId !== receivingClubId ||
        contribution.assetKind !== canonicalContribution.assetKind
    )
  ) {
    throw new TypeError('Admitted asset identity does not match the governed explanation.');
  }
  const evidenceRefs = uniqueEvidence([
    input.evidence.admissionArtifact,
    input.explanationArtifact,
    input.directionEvidenceArtifact,
    ...input.evidence.admission.content.evidenceRefs,
  ]);
  const calculationRefs = uniqueEvidence([
    input.calculationArtifact,
    input.modelRunArtifact,
  ]);
  const views = Object.fromEntries(
    contributions.map(([viewKey, contribution]) => [
      viewKey,
      {
        state: 'calculated' as const,
        score: contribution.additiveMean,
        distribution: contribution.distribution,
        evidenceRefs,
        components: componentsFor({ contribution, viewKey, evidence: input.evidence, evidenceRefs }),
        calculationRefs,
      },
    ])
  ) as AssetInput['views'];
  return {
    assetId,
    assetKind:
      canonicalContribution.assetKind === 'player'
        ? 'player'
        : canonicalContribution.assetKind === 'current_pick'
          ? 'pick'
          : 'future_pick',
    canonicalPlayerId:
      input.evidence.kind === 'player'
        ? input.evidence.admission.content.canonicalPlayerId
        : input.evidence.admission.content.finalSelection.selectedPlayerId,
    sendingClubId: canonicalContribution.fromClubId,
    receivingClubId,
    label: canonicalContribution.label,
    evidenceHorizons:
      input.evidence.kind === 'player'
        ? playerHorizons(input.evidence)
        : pickHorizons(input.evidence),
    views,
  };
}

function clubTotals(
  document: ExplanationDocument,
  explanationArtifact: AflTradeArtifactRef
): ClubInput[] {
  const current = document.views.find(({ view }) => view === 'current')!;
  return current.clubs.map(({ aflClubId }) => ({
    clubId: aflClubId,
    views: Object.fromEntries(
      viewPairs.map(([viewKey, explanationView]) => {
        const club = document.views
          .find(({ view }) => view === explanationView)!
          .clubs.find((candidate) => candidate.aflClubId === aflClubId)!;
        const summary = (value: typeof club.net) => ({
          score: value.additiveMean,
          distribution: value.distribution,
          evidenceRefs: [explanationArtifact],
        });
        return [
          viewKey,
          {
            state: 'calculated' as const,
            received: summary(club.received),
            givenUp: summary(club.givenUp),
            net: summary(club.net),
          },
        ];
      })
    ) as ClubInput['views'],
  }));
}

export function projectGovernedPrivateTradeEvaluation(
  candidate: ProjectGovernedPrivateTradeEvaluationInput
): LocalPrivateTradeEvaluationGenerationV2 {
  const calculationInput = governedPrivateValuationCalculationInputSchema.parse(
    candidate.calculationInput
  );
  if (
    candidate.explanation.explanation.state !== 'available' ||
    candidate.explanation.explanationArtifact === null ||
    candidate.run.calculationInputId !== calculationInput.calculationInputId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      candidate.run.calculationInputArtifact,
      calculationInput
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      candidate.run.calculationArtifact,
      candidate.run.calculation
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      candidate.explanation.explanationArtifact,
      candidate.explanation.explanation.document
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      candidate.explanation.directionEvidenceArtifact,
      candidate.explanation.directionEvidence.content
    ) ||
    candidate.explanation.directionEvidence.evidenceId !==
      candidate.explanation.directionEvidenceArtifact.artifactId
  ) {
    throw new TypeError('Governed projection parents failed exact authentication.');
  }
  const document = candidate.explanation.explanation.document;
  if (
    document.authority.kind !== 'governed_private_nonproduction' ||
    document.tradeId !== calculationInput.content.tradeId ||
    document.valuationCalculationId !== candidate.run.calculation.valuationCalculationId ||
    document.valuationCaseId !== calculationInput.content.valuationCase.valuationCaseId
  ) {
    throw new TypeError('Governed projection explanation ancestry mismatch.');
  }
  const confirmedResultArtifact = calculationInput.content.authority.confirmedFacts.resultArtifact;
  const evidence = candidate.assetEvidence.map((item) =>
    authenticatedEvidence(item, confirmedResultArtifact)
  );
  const expectedAssetIds = calculationInput.content.authority.confirmedFacts.assetIds;
  const admittedAssetIds = evidence.map(({ admission }) => admission.content.assetId).sort();
  if (
    evidence.length !== expectedAssetIds.length ||
    admittedAssetIds.some((assetId, index) => assetId !== expectedAssetIds[index])
  ) {
    throw new TypeError('Governed projection requires exactly one admission for every asset.');
  }

  const componentRuns = new Map(
    calculationInput.content.authority.components.map((component) => [
      component.role,
      component.runArtifact,
    ])
  );
  const assets = evidence.map((item) =>
    assetFor({
      document,
      evidence: item,
      explanationArtifact: candidate.explanation.explanationArtifact!,
      directionEvidenceArtifact: candidate.explanation.directionEvidenceArtifact,
      calculationArtifact: candidate.run.calculationArtifact,
      modelRunArtifact: componentRuns.get(
        item.kind === 'player'
          ? 'player_contribution_and_availability'
          : 'draft_pick_and_future_pick_distribution'
      )!,
    })
  );
  const current = document.views.find(({ view }) => view === 'current')!;
  const overallGrades = current.clubs.map((club) => {
    if (
      club.grade.grade === null ||
      club.grade.normalizedPerformance === null ||
      club.grade.state === 'unavailable'
    ) {
      return {
        clubId: club.aflClubId,
        state: 'unavailable' as const,
        reasons: ['asset_values_incomplete' as const],
        evidenceRefs: [candidate.explanation.explanationArtifact!],
      };
    }
    return {
      clubId: club.aflClubId,
      state: club.grade.state,
      grade: club.grade.grade,
      normalizedPerformance: club.grade.normalizedPerformance,
      finishesAheadProbability: club.finishAheadProbability,
      evidenceRefs: [candidate.explanation.explanationArtifact!],
    };
  });
  const allGradesAvailable = overallGrades.every(({ state }) => state !== 'unavailable');

  return createLocalPrivateTradeEvaluationGenerationV2({
    valuationScopeKey: calculationInput.content.authority.confirmedFacts.valuationScopeKey,
    tradeId: calculationInput.content.tradeId,
    workbookSha256: candidate.workbookSha256,
    dependencyRefs: uniqueEvidence([
      candidate.run.calculationInputArtifact,
      candidate.run.calculationArtifact,
      candidate.explanation.directionEvidenceArtifact,
      candidate.explanation.explanationArtifact,
      ...evidence.map(({ admissionArtifact }) => admissionArtifact),
      ...calculationInput.content.authority.components.flatMap(({ evidenceRefs }) => evidenceRefs),
      ...calculationInput.content.authority.valuationBundle.evidenceRefs,
    ]),
    confirmedResultArtifact,
    valueUnitId: document.valueUnitId,
    assets,
    clubTotals: clubTotals(document, candidate.explanation.explanationArtifact),
    overallGrades,
    tradeVerdict: allGradesAvailable
      ? {
          state: 'calculated',
          kind: current.verdict.kind,
          clubIds: [...current.verdict.aflClubIds].sort(),
          practicalEquivalenceProbability: current.practicalEquivalenceProbability,
          evidenceRefs: [candidate.explanation.explanationArtifact],
        }
      : {
          state: 'unavailable',
          reasons: ['asset_values_incomplete'],
          evidenceRefs: [candidate.explanation.explanationArtifact],
        },
    generatedAt: candidate.generatedAt,
  });
}
