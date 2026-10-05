import {
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { aflTradePrivateConfirmedValuationResultV2Schema } from './privateConfirmedTradeValuationContracts';
import type { LocalPrivateTradeEvaluationPreparation } from './localPrivateTradeEvaluationModule';

export type LocalPrivatePickEvaluationEvidence =
  | {
      readonly state: 'selection_confirmed';
      readonly canonicalPlayerId: string;
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    }
  | {
      readonly state: 'canonical_realization_confirmed';
      readonly canonicalPlayerId: string;
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    }
  | {
      readonly state: 'fixed_horizon_observed';
      readonly canonicalPlayerId: string;
      readonly score: number;
      readonly gamesPlayed: number;
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    };

function exactUniqueReferences(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  const byId = new Map<string, AflTradeArtifactRef>();
  for (const reference of references) {
    const retained = byId.get(reference.artifactId);
    if (retained !== undefined && !doAflTradeArtifactRefsExactlyMatch(retained, reference)) {
      throw new TypeError('One evaluation dependency identity has conflicting exact references.');
    }
    byId.set(reference.artifactId, reference);
  }
  return [...byId.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function unavailable(
  reason:
    | 'source_rights_not_approved'
    | 'predictive_model_not_authorized'
    | 'calculation_evidence_incomplete'
    | 'pick_selection_not_confirmed'
    | 'canonical_pick_realization_unavailable'
    | 'fixed_horizon_pick_outcome_unavailable',
  evidenceRefs: readonly AflTradeArtifactRef[] = []
) {
  return { state: 'unavailable' as const, reasons: [reason], evidenceRefs: [...evidenceRefs] };
}

export function prepareLocalPrivateTradeEvaluationFromConfirmedResult(input: {
  readonly result: unknown;
  readonly resultArtifact: AflTradeArtifactRef;
  readonly workbookSha256: string;
  readonly labelsByAssetId: ReadonlyMap<string, string>;
  readonly pickEvidenceByAssetId?: ReadonlyMap<string, LocalPrivatePickEvaluationEvidence>;
}): LocalPrivateTradeEvaluationPreparation {
  const result = aflTradePrivateConfirmedValuationResultV2Schema.parse(input.result);
  const dependencies: AflTradeArtifactRef[] = [
    input.resultArtifact,
    result.content.authority.evidenceBundleArtifact,
    result.content.planArtifact,
  ];
  const assets = result.content.assets.map((asset) => {
    const label = input.labelsByAssetId.get(asset.assetId)?.trim();
    if (!label) {
      throw new TypeError('Every confirmed evaluation asset requires its exact workbook label.');
    }
    const pickEvidence = input.pickEvidenceByAssetId?.get(asset.assetId);
    const realized =
      asset.assetKind === 'player'
        ? asset.realizedPav.state === 'calculated'
          ? {
              state: 'calculated' as const,
              score: asset.realizedPav.score,
              gamesPlayed:
                asset.appearances.state === 'observed'
                  ? asset.appearances.gamesPlayed
                  : undefined,
              components: asset.realizedPav.components,
              evidenceRefs: exactUniqueReferences([
                ...asset.realizedPav.evidenceRefs,
                ...asset.realizedPav.calculationArtifacts,
              ]),
            }
          : unavailable('calculation_evidence_incomplete', asset.realizedPav.evidenceRefs)
        : pickEvidence?.state === 'fixed_horizon_observed'
          ? {
              state: 'calculated' as const,
              score: pickEvidence.score,
              gamesPlayed: pickEvidence.gamesPlayed,
              evidenceRefs: [...pickEvidence.evidenceRefs],
            }
          : pickEvidence?.state === 'canonical_realization_confirmed'
            ? unavailable('fixed_horizon_pick_outcome_unavailable', pickEvidence.evidenceRefs)
            : pickEvidence?.state === 'selection_confirmed'
              ? unavailable('canonical_pick_realization_unavailable', pickEvidence.evidenceRefs)
              : unavailable('pick_selection_not_confirmed');
    dependencies.push(
      ...(asset.appearances.evidenceRefs ?? []),
      ...asset.realizedPav.evidenceRefs,
      ...(asset.realizedPav.state === 'calculated'
        ? asset.realizedPav.calculationArtifacts
        : []),
      ...(pickEvidence?.evidenceRefs ?? [])
    );
    return {
      assetId: asset.assetId,
      assetKind: asset.assetKind,
      canonicalPlayerId: asset.canonicalPlayerId ?? pickEvidence?.canonicalPlayerId ?? null,
      sendingClubId: asset.sendingClubId,
      receivingClubId: asset.receivingClubId,
      label,
      appearances:
        asset.appearances.state === 'observed'
          ? {
              state: 'observed' as const,
              gamesPlayed: asset.appearances.gamesPlayed,
              coverage: asset.appearances.coverage,
              effectiveThroughSeason: asset.appearances.effectiveThroughSeason,
              evidenceRefs: exactUniqueReferences(asset.appearances.evidenceRefs),
            }
          : unavailable('calculation_evidence_incomplete', asset.appearances.evidenceRefs),
      views: {
        atTrade: unavailable('source_rights_not_approved'),
        realized,
        remaining: unavailable('predictive_model_not_authorized'),
        current: unavailable('predictive_model_not_authorized'),
      },
    };
  });
  const realizedComplete = assets.every(({ views }) => views.realized.state === 'calculated');
  const clubTotals = realizedComplete
    ? [...new Set(assets.flatMap(({ sendingClubId, receivingClubId }) => [sendingClubId, receivingClubId]))]
        .sort()
        .map((clubId) => {
          const received = assets.reduce(
            (sum, asset) =>
              sum +
              (asset.receivingClubId === clubId && asset.views.realized.state === 'calculated'
                ? asset.views.realized.score
                : 0),
            0
          );
          const givenUp = assets.reduce(
            (sum, asset) =>
              sum +
              (asset.sendingClubId === clubId && asset.views.realized.state === 'calculated'
                ? asset.views.realized.score
                : 0),
            0
          );
          return {
            clubId,
            views: {
              atTrade: unavailable('source_rights_not_approved'),
              realized: {
                state: 'calculated' as const,
                score: Number((received - givenUp).toFixed(12)),
                evidenceRefs: [input.resultArtifact],
              },
              remaining: unavailable('predictive_model_not_authorized'),
              current: unavailable('predictive_model_not_authorized'),
            },
          };
        })
    : null;
  return {
    valuationScopeKey: result.content.valuationScopeKey,
    tradeId: result.content.tradeId,
    workbookSha256: input.workbookSha256,
    generatedAt: result.content.assembledAt,
    dependencyRefs: exactUniqueReferences(dependencies),
    confirmedResultArtifact: input.resultArtifact,
    valueUnitId: result.content.valueUnitId,
    assets,
    clubTotals,
    overallGrade: {
      state: 'unavailable',
      reasons: ['asset_values_incomplete'],
      evidenceRefs: [input.resultArtifact],
    },
  };
}
