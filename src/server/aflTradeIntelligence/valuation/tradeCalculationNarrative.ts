import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeAssetLineageNarrativeEvidence } from './assetLineageNarrativeEvidence';
import type {
  AflTradePickCalculationEvidence,
  AflTradePlayerCalculationEvidence,
} from './calculationNarrativeEvidence';
import type {
  AflTradeValuationAssetContribution,
  AflTradeValuationExplanationClub,
  AflTradeValuationExplanationDocument,
} from './tradeValuationExplanation';

type ValuationView = (typeof AFL_TRADE_VALUATION_VIEWS)[number];
type ModelEvidence = AflTradePlayerCalculationEvidence | AflTradePickCalculationEvidence;

export interface AflTradeCalculationNarrativeInput {
  explanation: AflTradeValuationExplanationDocument;
  assets: readonly Readonly<{
    assetId: string;
    modelEvidence: ModelEvidence;
    lineage: AflTradeAssetLineageNarrativeEvidence;
  }>[];
}

interface AssetIdentity {
  assetId: string;
  assetKind: AflTradeValuationAssetContribution['assetKind'];
  label: string;
  fromClubId: string;
  toClubId: string;
}

const EPSILON = 1e-9;

function close(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= EPSILON;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatted(value: number): string {
  const normalized = close(value, 0) ? 0 : value;
  return Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatted(value)}`;
}

function assertDistribution(
  distribution: AflTradeValuationAssetContribution['distribution'],
  expectedMean: number
): void {
  if (
    !close(distribution.mean, expectedMean) ||
    ![distribution.median, distribution.p10, distribution.p90].every(Number.isFinite) ||
    distribution.p10 > distribution.median ||
    distribution.median > distribution.p90
  ) {
    throw new TypeError('Trade calculation narrative requires reconciled package uncertainty.');
  }
}

function identityOf(asset: AflTradeValuationAssetContribution): AssetIdentity {
  return {
    assetId: asset.assetId,
    assetKind: asset.assetKind,
    label: asset.label,
    fromClubId: asset.fromClubId,
    toClubId: asset.toClubId,
  };
}

function assertSameAsset(
  expected: AflTradeValuationAssetContribution,
  candidate: AflTradeValuationAssetContribution
): void {
  if (canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(candidate)) {
    throw new TypeError('Trade calculation narrative found inconsistent duplicated asset values.');
  }
}

function assertLedgerArithmetic(club: AflTradeValuationExplanationClub): void {
  const receivedMean = sum(club.received.assets.map(({ additiveMean }) => additiveMean));
  const givenUpMean = sum(club.givenUp.assets.map(({ additiveMean }) => additiveMean));
  if (
    !close(club.received.additiveMean, receivedMean) ||
    !close(club.givenUp.additiveMean, givenUpMean) ||
    !close(club.net.additiveMean, receivedMean - givenUpMean)
  ) {
    throw new TypeError('Trade calculation narrative package arithmetic does not reconcile.');
  }
  assertDistribution(club.received.distribution, receivedMean);
  assertDistribution(club.givenUp.distribution, givenUpMean);
  assertDistribution(club.net.distribution, receivedMean - givenUpMean);
}

function packageSummary(
  club: AflTradeValuationExplanationClub,
  valueUnitId: string
): string {
  const arithmetic = `${formatted(club.received.additiveMean)} - ${formatted(club.givenUp.additiveMean)} = ${signed(club.net.additiveMean)} ${valueUnitId}`;
  if (club.grade.grade === null) {
    return `${arithmetic}. The package grade is unavailable (${club.grade.reasonCode}).`;
  }
  return `${arithmetic}, resulting in a ${club.grade.state} ${club.grade.grade} package grade.`;
}

function assertPlayerEvidence(
  evidence: Exclude<AflTradePlayerCalculationEvidence, { state: 'unavailable' }>
): void {
  const seasonYears = evidence.seasons.map(({ seasonYear }) => seasonYear);
  const gamesPlayed = sum(evidence.seasons.map((season) => season.gamesPlayed));
  const contribution = sum(evidence.seasons.map((season) => season.contribution));
  const contributionPerGame = gamesPlayed === 0 ? null : contribution / gamesPlayed;
  const perSeasonRatesReconcile = evidence.seasons.every((season) => {
    const expected =
      season.gamesPlayed === 0 ? null : season.contribution / season.gamesPlayed;
    return (
      (expected === null && season.contributionPerGame === null) ||
      (expected !== null &&
        season.contributionPerGame !== null &&
        close(expected, season.contributionPerGame))
    );
  });
  if (
    canonicalizeAflTradeJson(seasonYears) !==
      canonicalizeAflTradeJson(evidence.horizon.observedSeasons) ||
    !evidence.horizon.observedSeasons.every((season) =>
      evidence.horizon.requiredSeasons.includes(season)
    ) ||
    (evidence.state === 'mature_observed' &&
      canonicalizeAflTradeJson(evidence.horizon.observedSeasons) !==
        canonicalizeAflTradeJson(evidence.horizon.requiredSeasons)) ||
    !close(evidence.totals.gamesPlayed, gamesPlayed) ||
    !close(evidence.totals.contribution, contribution) ||
    ((contributionPerGame === null) !== (evidence.totals.contributionPerGame === null)) ||
    (contributionPerGame !== null &&
      evidence.totals.contributionPerGame !== null &&
      !close(evidence.totals.contributionPerGame, contributionPerGame)) ||
    !perSeasonRatesReconcile
  ) {
    throw new TypeError(
      'Trade calculation narrative player evidence totals do not reconcile to retained seasons.'
    );
  }
}

function playerStory(
  label: string,
  evidence: Exclude<AflTradePlayerCalculationEvidence, { state: 'unavailable' }>,
  valueUnitId: string
): string {
  assertPlayerEvidence(evidence);
  const totals = evidence.totals;
  const seasonCount = evidence.horizon.observedSeasons.length;
  const perGame = totals.contributionPerGame === null ? 'unavailable' : formatted(totals.contributionPerGame);
  const censoring = evidence.state === 'right_censored' ? ' The current season is right-censored.' : '';
  return `${label} records ${formatted(totals.gamesPlayed)} games for ${formatted(totals.contribution)} ${valueUnitId} across ${seasonCount} observed season${seasonCount === 1 ? '' : 's'} (${perGame} per game).${censoring}`;
}

function pickStory(label: string, evidence: AflTradePickCalculationEvidence): string {
  return `${label} is estimated from ${evidence.cohort.observationCount} observations across ${evidence.cohort.draftClassCount} draft classes (picks ${evidence.cohort.minimumSelectionNumber}-${evidence.cohort.maximumSelectionNumber}), with an expected ${formatted(evidence.expected.contribution)} ${evidence.valueUnit} and ${formatted(evidence.expected.games)} games over ${evidence.fixedHorizonSeasons} seasons.`;
}

function contributionStory(input: {
  identity: AssetIdentity;
  contribution: AflTradeValuationAssetContribution;
  view: ValuationView;
  evidence: ModelEvidence;
  valueUnitId: string;
  valuationCalculationId: string;
  effectiveThrough: string;
}): string {
  const { identity, contribution, view, evidence, valueUnitId } = input;
  const value = formatted(contribution.additiveMean);
  if (view === 'at_trade') {
    if (evidence.kind === 'pick') {
      if (!close(contribution.additiveMean, evidence.expected.contribution)) {
        throw new TypeError(
          'Trade calculation narrative pick at-trade value does not reconcile to its cohort expectation.'
        );
      }
      return `${identity.label}: ${value} ${valueUnitId} expected from ${evidence.cohort.observationCount} observations across ${evidence.cohort.draftClassCount} draft classes (picks ${evidence.cohort.minimumSelectionNumber}-${evidence.cohort.maximumSelectionNumber}).`;
    }
    return `${identity.label}: ${value} ${valueUnitId} at-trade model estimate from authenticated calculation ${input.valuationCalculationId}.`;
  }
  if (view === 'realized') {
    if (evidence.kind === 'player') {
      if (evidence.state === 'unavailable' || !close(contribution.additiveMean, evidence.totals.contribution)) {
        throw new TypeError(
          'Trade calculation narrative player realized value does not reconcile to retained seasons.'
        );
      }
      const rate =
        evidence.totals.contributionPerGame === null
          ? 'unavailable'
          : formatted(evidence.totals.contributionPerGame);
      return `${identity.label}: ${value} ${valueUnitId} from ${formatted(evidence.totals.gamesPlayed)} games at ${rate} per game across ${evidence.seasons.length} observed seasons.`;
    }
    return contribution.additiveMean === 0
      ? `${identity.label}: 0 ${valueUnitId} realized; no observed successor contribution is credited at this cutoff.`
      : `${identity.label}: ${value} ${valueUnitId} realized through its retained transformation lineage.`;
  }
  if (view === 'remaining') {
    return `${identity.label}: ${value} ${valueUnitId} remaining model estimate through ${input.effectiveThrough}.`;
  }
  const components = contribution.currentComponents!;
  return `${identity.label}: ${value} = ${formatted(components.realizedMean)} realized + ${formatted(components.remainingMean)} remaining ${valueUnitId}.`;
}

function authenticateExplanation(explanation: AflTradeValuationExplanationDocument): void {
  const { explanationId, ...content } = explanation;
  if (createAflTradeContentAddress('valuation-explanation', content) !== explanationId) {
    throw new TypeError('Trade calculation narrative requires an authentic explanation artifact.');
  }
}

/**
 * Builds a deterministic reader artifact from one already-derived four-view explanation. It does
 * not calculate new values or grades: it authenticates and rechecks the package calculation, then
 * binds each asset to the exact model evidence and temporal lineage used to explain that value.
 */
export function createAflTradeCalculationNarrative(input: AflTradeCalculationNarrativeInput) {
  const explanation = input.explanation;
  if (
    explanation.coverage.status !== 'complete' ||
    explanation.coverage.ratio !== 1 ||
    explanation.methodology.assetGradeTreatment !== 'prohibited' ||
    explanation.methodology.currentIdentity !== 'realized_plus_remaining' ||
    canonicalizeAflTradeJson(explanation.views.map(({ view }) => view)) !==
      canonicalizeAflTradeJson(AFL_TRADE_VALUATION_VIEWS)
  ) {
    throw new TypeError('Trade calculation narrative requires one complete canonical four-view calculation.');
  }

  const identities = new Map<string, AssetIdentity>();
  const contributions = new Map<string, Map<ValuationView, AflTradeValuationAssetContribution>>();
  const narrativeViews = explanation.views.map((tradeView) => {
    const receivedCounts = new Map<string, number>();
    const givenUpCounts = new Map<string, number>();
    const clubs = tradeView.clubs.map((club) => {
      assertLedgerArithmetic(club);
      for (const [side, assets] of [
        ['received', club.received.assets],
        ['givenUp', club.givenUp.assets],
      ] as const) {
        for (const asset of assets) {
          if (
            (side === 'received' && asset.toClubId !== club.aflClubId) ||
            (side === 'givenUp' && asset.fromClubId !== club.aflClubId)
          ) {
            throw new TypeError('Trade calculation narrative asset direction does not match its club package.');
          }
          const currentIdentity = identityOf(asset);
          const knownIdentity = identities.get(asset.assetId);
          if (
            knownIdentity !== undefined &&
            canonicalizeAflTradeJson(knownIdentity) !== canonicalizeAflTradeJson(currentIdentity)
          ) {
            throw new TypeError('Trade calculation narrative asset identity changed between package views.');
          }
          identities.set(asset.assetId, currentIdentity);
          const byView = contributions.get(asset.assetId) ?? new Map();
          const knownContribution = byView.get(tradeView.view);
          if (knownContribution === undefined) byView.set(tradeView.view, asset);
          else assertSameAsset(knownContribution, asset);
          contributions.set(asset.assetId, byView);
          const counts = side === 'received' ? receivedCounts : givenUpCounts;
          counts.set(asset.assetId, (counts.get(asset.assetId) ?? 0) + 1);
          if (
            (tradeView.view === 'current' &&
              (asset.currentComponents === null ||
                !close(
                  asset.additiveMean,
                  asset.currentComponents.realizedMean + asset.currentComponents.remainingMean
                ))) ||
            (tradeView.view !== 'current' && asset.currentComponents !== null)
          ) {
            throw new TypeError('Trade calculation narrative current value does not reconcile to realized plus remaining.');
          }
        }
      }
      return {
        aflClubId: club.aflClubId,
        clubName: club.clubName,
        receivedAssetIds: club.received.assets.map(({ assetId }) => assetId),
        givenUpAssetIds: club.givenUp.assets.map(({ assetId }) => assetId),
        arithmetic: {
          receivedMean: club.received.additiveMean,
          givenUpMean: club.givenUp.additiveMean,
          estimatedAdvantageMean: club.net.additiveMean,
        },
        uncertainty: { ...club.net.distribution },
        finishAheadProbability: club.finishAheadProbability,
        grade: { ...club.grade },
        summary: packageSummary(club, explanation.valueUnitId),
      };
    });
    if (
      [...identities].some(
        ([assetId]) => receivedCounts.get(assetId) !== 1 || givenUpCounts.get(assetId) !== 1
      ) ||
      !close(sum(clubs.map(({ arithmetic }) => arithmetic.estimatedAdvantageMean)), 0) ||
      !close(
        sum(clubs.map(({ finishAheadProbability }) => finishAheadProbability)) +
          tradeView.practicalEquivalenceProbability,
        1
      )
    ) {
      throw new TypeError('Trade calculation narrative requires globally balanced club packages.');
    }
    return {
      view: tradeView.view,
      practicalEquivalenceProbability: tradeView.practicalEquivalenceProbability,
      verdict: { ...tradeView.verdict, aflClubIds: [...tradeView.verdict.aflClubIds] },
      clubs,
    };
  });

  authenticateExplanation(explanation);
  const evidenceByAssetId = new Map(input.assets.map((entry) => [entry.assetId, entry]));
  if (evidenceByAssetId.size !== input.assets.length || evidenceByAssetId.size !== identities.size) {
    throw new TypeError('Trade calculation narrative requires exactly one evidence package per asset.');
  }
  const assets = [...identities.values()]
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
    .map((identity) => {
      const evidencePackage = evidenceByAssetId.get(identity.assetId);
      if (
        evidencePackage === undefined ||
        evidencePackage.lineage.rootAssetId !== identity.assetId ||
        !evidencePackage.lineage.nodes.some(({ assetId }) => assetId === identity.assetId) ||
        (identity.assetKind === 'player' && evidencePackage.modelEvidence.kind !== 'player') ||
        (identity.assetKind !== 'player' && evidencePackage.modelEvidence.kind !== 'pick') ||
        (evidencePackage.modelEvidence.kind === 'player' &&
          evidencePackage.modelEvidence.state === 'unavailable')
      ) {
        throw new TypeError('Trade calculation narrative evidence does not authenticate its asset.');
      }
      const modelEvidence = evidencePackage.modelEvidence;
      const story =
        modelEvidence.kind === 'player'
          ? playerStory(identity.label, modelEvidence, explanation.valueUnitId)
          : pickStory(identity.label, modelEvidence);
      return {
        ...identity,
        contributions: AFL_TRADE_VALUATION_VIEWS.map((view) => {
          const contribution = contributions.get(identity.assetId)?.get(view);
          if (contribution === undefined) {
            throw new TypeError('Trade calculation narrative is missing an asset view contribution.');
          }
          return {
            view,
            ...contribution,
            story: contributionStory({
              identity,
              contribution,
              view,
              evidence: modelEvidence,
              valueUnitId: explanation.valueUnitId,
              valuationCalculationId: explanation.valuationCalculationId,
              effectiveThrough: explanation.effectiveThrough,
            }),
          };
        }),
        modelEvidence,
        lineage: evidencePackage.lineage,
        story,
      };
    });
  const content = {
    schemaVersion: 'afl-trade-calculation-narrative/v1' as const,
    tradeId: explanation.tradeId,
    explanationId: explanation.explanationId,
    valuationCaseId: explanation.valuationCaseId,
    valuationCalculationId: explanation.valuationCalculationId,
    valueUnitId: explanation.valueUnitId,
    defaultView: explanation.defaultView,
    publicationProhibited: explanation.authority.publicationProhibited,
    methodology: {
      additiveStatistic: explanation.methodology.additiveStatistic,
      uncertaintyStatistic: explanation.methodology.uncertaintyStatistic,
      packageMedianIsAdditive: explanation.methodology.packageMedianIsAdditive,
      currentIdentity: explanation.methodology.currentIdentity,
      gradeScope: 'club_package_only' as const,
      practicalEquivalenceBasis: explanation.methodology.practicalEquivalenceBasis,
      practicalEquivalencePolicy: { ...explanation.methodology.practicalEquivalencePolicy },
    },
    views: narrativeViews,
    assets,
  };
  return {
    narrativeId: createAflTradeContentAddress('trade-calculation-narrative', content),
    content,
  };
}
