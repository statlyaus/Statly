import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import {
  createAflTradePrivateConfirmedValuationPlanV2,
  type AflTradePrivateConfirmedValuationAuthority,
  type AflTradePrivateConfirmedValuationPlanV2,
} from './privateConfirmedTradeValuationContracts';
import type { AflTradePrivateConfirmedValuationConstructionSourceV2 } from './privateConfirmedTradeValuationConstruction';

type ReadyStageInput = Extract<
  Awaited<
    ReturnType<AflTradePrivateConfirmedValuationConstructionSourceV2['loadStage']>
  >,
  { state: 'ready' }
>['input'];

type ReadyAssemblyInput = Extract<
  Awaited<
    ReturnType<AflTradePrivateConfirmedValuationConstructionSourceV2['loadAssembly']>
  >,
  { state: 'ready' }
>['input'];

export interface AflTradePrivateConfirmedValuationSnapshot {
  trustedAt: string;
  authority: AflTradePrivateConfirmedValuationAuthority;
  promotion: Readonly<{
    promotionId: string;
    decisionId: string;
    decidedAt: string;
    decisionDocument: unknown;
    workbookTradeId: string;
    occurredOn: string;
    occurrencePrecision: 'date' | 'year';
    assets: readonly Readonly<{
      assetId: string;
      assetKind: 'player' | 'pick' | 'future_pick';
      sendingClubId: string;
      receivingClubId: string;
      canonicalPlayerId: string | null;
      acquisitionSpell: Readonly<{
        spellId: string;
        spellVersionId: string;
        ruleId: string;
        startEventVersionId: string;
        startAssetVersionId: string;
        startDate: string;
        endDate: string | null;
      }> | null;
      reviewedRecordedName: string | null;
      reviewedReceivingClubName: string | null;
      identityReviewDocument: unknown | null;
    }>[];
  }>;
  expectedSeasonYears: readonly number[];
  appearanceRows: readonly Readonly<{
    providerDecodedRowId: string;
    seasonYear: number;
    matchDate: string;
    canonicalPlayerId: string;
    playingForClubId: string;
    memberDocument: unknown;
  }>[];
  calculations: readonly Readonly<{
    calculationId: string;
    calculatedAt: string;
    seasonYear: number;
    methodId: string;
    calculationDocument: unknown;
    allocation: Readonly<{
      canonicalPlayerId: string;
      clubId: string;
      gamesPlayed: number;
      sourceRowIds: readonly string[];
      offensiveScore: number;
      midfieldScore: number;
      defensiveScore: number;
      offensivePav: number;
      midfieldPav: number;
      defensivePav: number;
      totalPav: number;
    }>;
  }>[];
}

export interface AflTradePrivateConfirmedValuationSnapshotLoader {
  load(input: {
    valuationScopeKey: string;
    tradeId: string;
    knowledgeCutoffAt: string | null;
  }): Promise<AflTradePrivateConfirmedValuationSnapshot | null>;
}

function normalized(value: number): number {
  const result = Number(value.toFixed(12));
  if (!Number.isFinite(result)) throw new TypeError('Private valuation aggregation is non-finite.');
  return result;
}

async function retain(input: {
  repository: AflTradeImmutableArtifactRepository;
  value: unknown;
  createdAt: string;
  maximumBytes: number;
  verifiedAt: string;
}): Promise<AflTradeArtifactRef> {
  const reference = createAflTradeCanonicalJsonArtifactRef(input.value, input.createdAt);
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(input.value));
  await input.repository.putIfAbsent(reference, bytes);
  await verifyAflTradeArtifactReadback(
    input.repository,
    reference,
    input.verifiedAt,
    input.maximumBytes
  );
  return reference;
}

export function createAflTradePrivateConfirmedValuationConstructionSourceV2(dependencies: {
  loadSnapshot: AflTradePrivateConfirmedValuationSnapshotLoader['load'];
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): AflTradePrivateConfirmedValuationConstructionSourceV2 {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !['fixture_memory', 'local_non_production_filesystem'].includes(
      dependencies.artifactRepository.assurance
    ) ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Private valuation source requires bounded private local artifact custody.');
  }

  async function build(
    valuationScopeKey: string,
    tradeId: string,
    knowledgeCutoffAt: string | null,
    plannedAt: string | null
  ) {
    const snapshot = await dependencies.loadSnapshot({
      valuationScopeKey,
      tradeId,
      knowledgeCutoffAt,
    });
    if (snapshot === null) {
      return {
        state: 'blocked' as const,
        reasons: ['transaction_not_confirmed'],
        evidenceRefs: [],
      };
    }
    if (
      snapshot.promotion.workbookTradeId !== tradeId ||
      snapshot.authority.publicationEligible !== false ||
      snapshot.authority.publicationProhibited !== true
    ) {
      throw new TypeError('Private valuation snapshot does not match the requested private scope.');
    }
    const cutoffAt = knowledgeCutoffAt ?? snapshot.trustedAt;
    const cutoffYear = new Date(cutoffAt).getUTCFullYear();
    const transactionYear = Number(snapshot.promotion.occurredOn.slice(0, 4));
    const transactionArtifact = await retain({
      repository: dependencies.artifactRepository,
      value: snapshot.promotion.decisionDocument,
      createdAt: snapshot.promotion.decidedAt,
      verifiedAt: snapshot.trustedAt,
      maximumBytes: dependencies.maximumArtifactBytes,
    });
    const resultAssets: Array<ReadyAssemblyInput['assets'][number]> = [];
    const planAssets: Array<ReadyStageInput['assets'][number]> = [];
    for (const asset of snapshot.promotion.assets) {
      const assetIdentity = {
        assetId: asset.assetId,
        assetKind: asset.assetKind,
        sendingClubId: asset.sendingClubId,
        receivingClubId: asset.receivingClubId,
        canonicalPlayerId: asset.canonicalPlayerId,
        acquisitionSpell: asset.acquisitionSpell,
      };
      if (
        asset.assetKind !== 'player' ||
        asset.canonicalPlayerId === null ||
        asset.acquisitionSpell === null
      ) {
        const unavailable = {
          state: 'unavailable' as const,
          reasons: ['selection_lineage_unresolved' as const],
          evidenceRefs: [transactionArtifact],
        };
        const identity = { ...assetIdentity, canonicalPlayerId: null };
        planAssets.push({ ...identity, appearances: unavailable, realizedPav: unavailable });
        resultAssets.push({ ...identity, appearances: unavailable, realizedPav: unavailable });
        continue;
      }
      const acquisitionSpell = asset.acquisitionSpell;
      const rows = snapshot.appearanceRows
        .filter(
          (row) =>
            row.canonicalPlayerId === asset.canonicalPlayerId &&
            row.playingForClubId === asset.receivingClubId &&
            row.seasonYear > transactionYear &&
            row.seasonYear <= cutoffYear &&
            Date.parse(row.matchDate) <= Date.parse(cutoffAt) &&
            row.matchDate >= acquisitionSpell.startDate &&
            (acquisitionSpell.endDate === null || row.matchDate <= acquisitionSpell.endDate)
        )
        .sort(
          (left, right) =>
            left.matchDate.localeCompare(right.matchDate) ||
            left.providerDecodedRowId.localeCompare(right.providerDecodedRowId)
        );
      const appearanceDocument = {
        schemaVersion: 'afl-trade-private-confirmed-appearance-evidence/v1',
        transactionPromotionId: snapshot.promotion.promotionId,
        acquisitionSpell: asset.acquisitionSpell,
        assetId: asset.assetId,
        canonicalPlayerId: asset.canonicalPlayerId,
        receivingClubId: asset.receivingClubId,
        knowledgeCutoffAt: cutoffAt,
        expectedCompletedCalculationSeasonYears: snapshot.expectedSeasonYears,
        rows: rows.map((row) => row.memberDocument),
        publicationEligible: false,
        publicationProhibited: true,
      };
      const appearanceArtifact = await retain({
        repository: dependencies.artifactRepository,
        value: appearanceDocument,
        createdAt: plannedAt ?? snapshot.trustedAt,
        verifiedAt: snapshot.trustedAt,
        maximumBytes: dependencies.maximumArtifactBytes,
      });
      // The reviewed rows prove observations through the cutoff, but the transaction promotion
      // does not prove that the receiving-club acquisition spell has ended. It must therefore
      // remain explicitly right-censored rather than being presented as a final career total.
      const coverage = 'right_censored' as const;
      const rowIdsBySeason = new Map<number, string[]>();
      for (const row of rows) {
        const ids = rowIdsBySeason.get(row.seasonYear) ?? [];
        ids.push(row.providerDecodedRowId);
        rowIdsBySeason.set(row.seasonYear, ids);
      }
      const appearancesExact =
        rows.length > 0 &&
        snapshot.expectedSeasonYears.every((seasonYear) => rowIdsBySeason.has(seasonYear));
      const appearances =
        !appearancesExact
          ? {
              state: 'unavailable' as const,
              reasons: ['calculation_evidence_incomplete' as const],
              evidenceRefs: [appearanceArtifact],
            }
          : {
              state: 'ready' as const,
              coverage,
              evidenceRefs: [appearanceArtifact],
            };
      const matchingCalculations = snapshot.calculations
        .filter(
          ({ seasonYear, allocation }) =>
            seasonYear > transactionYear &&
            seasonYear <= cutoffYear &&
            allocation.canonicalPlayerId === asset.canonicalPlayerId &&
            allocation.clubId === asset.receivingClubId
        )
        .sort((left, right) => left.seasonYear - right.seasonYear);
      const calculationsExact =
        appearancesExact &&
        matchingCalculations.length > 0 &&
        matchingCalculations.length === snapshot.expectedSeasonYears.length &&
        matchingCalculations.every(
          ({ seasonYear }, index) => seasonYear === snapshot.expectedSeasonYears[index]
        ) &&
        matchingCalculations.every(({ seasonYear, allocation }) => {
          const expected = [...(rowIdsBySeason.get(seasonYear) ?? [])].sort();
          const actual = [...new Set(allocation.sourceRowIds)].sort();
          return (
            allocation.gamesPlayed === expected.length &&
            actual.length === expected.length &&
            actual.every((rowId, index) => rowId === expected[index])
          );
        });
      const calculationArtifacts: AflTradeArtifactRef[] = [];
      if (calculationsExact) {
        for (const calculation of matchingCalculations) {
          calculationArtifacts.push(
            await retain({
              repository: dependencies.artifactRepository,
              value: calculation.calculationDocument,
              createdAt: calculation.calculatedAt,
              verifiedAt: snapshot.trustedAt,
              maximumBytes: dependencies.maximumArtifactBytes,
            })
          );
        }
      }
      const unavailableRealizedPav = {
        state: 'unavailable' as const,
        reasons: ['calculation_field_unavailable' as const],
        evidenceRefs: [appearanceArtifact],
      };
      const planRealizedPav = calculationsExact
        ? {
            state: 'ready' as const,
            methodId: matchingCalculations[0]!.methodId,
            evidenceRefs: calculationArtifacts,
          }
        : unavailableRealizedPav;
      const identity = { ...assetIdentity, canonicalPlayerId: asset.canonicalPlayerId };
      planAssets.push({ ...identity, appearances, realizedPav: planRealizedPav });
      resultAssets.push({
        ...identity,
        appearances:
          appearances.state === 'ready'
            ? {
                state: 'observed' as const,
                gamesPlayed: rows.length,
                coverage: appearances.coverage,
                effectiveThroughSeason: Math.max(...rows.map(({ seasonYear }) => seasonYear)),
                evidenceRefs: appearances.evidenceRefs,
              }
            : appearances,
        realizedPav: calculationsExact
          ? {
              state: 'calculated' as const,
              methodId: matchingCalculations[0]!.methodId,
              score: normalized(
                matchingCalculations.reduce(
                  (sum, { allocation }) => sum + allocation.totalPav,
                  0
                )
              ),
              seasons: matchingCalculations.map(({ seasonYear }) => seasonYear),
              components: {
                offensiveScore: normalized(
                  matchingCalculations.reduce(
                    (sum, { allocation }) => sum + allocation.offensiveScore,
                    0
                  )
                ),
                midfieldScore: normalized(
                  matchingCalculations.reduce(
                    (sum, { allocation }) => sum + allocation.midfieldScore,
                    0
                  )
                ),
                defensiveScore: normalized(
                  matchingCalculations.reduce(
                    (sum, { allocation }) => sum + allocation.defensiveScore,
                    0
                  )
                ),
                offensivePav: normalized(
                  matchingCalculations.reduce(
                    (sum, { allocation }) => sum + allocation.offensivePav,
                    0
                  )
                ),
                midfieldPav: normalized(
                  matchingCalculations.reduce(
                    (sum, { allocation }) => sum + allocation.midfieldPav,
                    0
                  )
                ),
                defensivePav: normalized(
                  matchingCalculations.reduce(
                    (sum, { allocation }) => sum + allocation.defensivePav,
                    0
                  )
                ),
              },
              calculationArtifacts,
              evidenceRefs: calculationArtifacts,
            }
          : unavailableRealizedPav,
      });
    }
    const stageInput = {
      authority: snapshot.authority,
      valuationScopeKey,
      tradeId,
      transactionPromotionId: snapshot.promotion.promotionId,
      transactionOccurredOn: snapshot.promotion.occurredOn,
      transactionOccurrencePrecision: snapshot.promotion.occurrencePrecision,
      knowledgeCutoffAt: cutoffAt,
      transactionArtifact,
      expectedAssetIds: snapshot.promotion.assets.map(({ assetId }) => assetId),
      assets: planAssets,
      plannedAt: plannedAt ?? snapshot.trustedAt,
    };
    return { state: 'ready' as const, stageInput, resultAssets, assembledAt: snapshot.trustedAt };
  }

  return {
    async loadStage(request) {
      const built = await build(request.valuationScopeKey, request.tradeId, null, null);
      return built.state === 'blocked'
        ? built
        : { state: 'ready', input: built.stageInput };
    },
    async loadAssembly(plan: AflTradePrivateConfirmedValuationPlanV2) {
      const built = await build(
        plan.content.valuationScopeKey,
        plan.content.tradeId,
        plan.content.knowledgeCutoffAt,
        plan.content.plannedAt
      );
      if (built.state === 'blocked') return built;
      const rebuiltPlan = createAflTradePrivateConfirmedValuationPlanV2({
        ...built.stageInput,
        plannedAt: plan.content.plannedAt,
      });
      if (rebuiltPlan.planId !== plan.planId) {
        return {
          state: 'blocked',
          reasons: ['calculation_parent_drift'],
          evidenceRefs: [plan.content.transactionArtifact],
        };
      }
      return {
        state: 'ready',
        input: {
          valueUnitId: 'hpn-season-pav/v1',
          assets: built.resultAssets,
          assembledAt: built.assembledAt,
        },
      };
    },
  };
}
