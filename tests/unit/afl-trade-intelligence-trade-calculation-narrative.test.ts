import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeAssetLineageNarrativeEvidence } from '@/server/aflTradeIntelligence/valuation/assetLineageNarrativeEvidence';
import type {
  AflTradePickCalculationEvidence,
  AflTradePlayerCalculationEvidence,
} from '@/server/aflTradeIntelligence/valuation/calculationNarrativeEvidence';
import {
  createAflTradeCalculationNarrative,
  type AflTradeCalculationNarrativeInput,
} from '@/server/aflTradeIntelligence/valuation/tradeCalculationNarrative';
import type {
  AflTradeValuationAssetContribution,
  AflTradeValuationExplanationDocument,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationExplanation';
import {
  createGovernedPrivateEvaluationGeneration,
  decodeGovernedPrivateEvaluationDetailDocument,
  verifyGovernedPrivateEvaluationGeneration,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';

const addressed = (kind: string, marker: string) => `${kind}:${marker.repeat(64)}`;
const views = ['at_trade', 'realized', 'remaining', 'current'] as const;

function asset(
  assetId: string,
  assetKind: 'player' | 'current_pick',
  label: string,
  fromClubId: string,
  toClubId: string,
  value: number,
  view: (typeof views)[number]
): AflTradeValuationAssetContribution {
  return {
    assetId,
    assetKind,
    label,
    fromClubId,
    toClubId,
    additiveMean: value,
    distribution: { mean: value, median: value, p10: value - 1, p90: value + 1 },
    currentComponents:
      view === 'current'
        ? assetId === 'asset:player-a'
          ? { realizedMean: 72, remainingMean: 20 }
          : { realizedMean: 0, remainingMean: 70 }
        : null,
    layers: {
      grossMean: value,
      listSpotAdjustedMean: value,
      scarcityAdjustedMean: value,
      listSpotDelta: 0,
      scarcityDelta: 0,
    },
    evidenceState: 'complete',
  };
}

function explanation(): AflTradeValuationExplanationDocument {
  const values = {
    at_trade: { player: 80, pick: 70 },
    realized: { player: 72, pick: 0 },
    remaining: { player: 20, pick: 70 },
    current: { player: 92, pick: 70 },
  } as const;
  const content = {
    schemaVersion: 'afl-trade-valuation-explanation/v1' as const,
    tradeId: 'trade:adelaide-st-kilda',
    defaultView: 'current' as const,
    authority: {
      kind: 'private_synthetic' as const,
      assumptionSetId: addressed('artifact', 'a'),
      publicationProhibited: true as const,
      warning: 'Fabricated rank-based test values — not real AFL data.' as const,
    },
    valueUnitId: 'fixed_horizon_pav',
    valuationBundleId: addressed('valuation-bundle', 'b'),
    valuationCaseId: addressed('valuation-case', 'c'),
    valuationCalculationId: addressed('valuation-calculation', 'd'),
    effectiveAt: '2026-08-19T00:00:00.000Z',
    effectiveThrough: '2026-08-19T23:59:59.999Z',
    coverage: { status: 'complete' as const, ratio: 1 as const },
    confidenceLevel: 'high' as const,
    selectedLayer: 'scarcityAdjusted' as const,
    views: views.map((view) => {
      const player = asset(
        'asset:player-a',
        'player',
        'Player A',
        'afl-club:st-kilda',
        'afl-club:adelaide',
        values[view].player,
        view
      );
      const pick = asset(
        'asset:pick-14',
        'current_pick',
        'Pick 14',
        'afl-club:adelaide',
        'afl-club:st-kilda',
        values[view].pick,
        view
      );
      const net = player.additiveMean - pick.additiveMean;
      const club = (
        aflClubId: string,
        clubName: string,
        received: AflTradeValuationAssetContribution,
        givenUp: AflTradeValuationAssetContribution,
        sign: 1 | -1
      ) => ({
        aflClubId,
        clubName,
        received: {
          assets: [received],
          additiveMean: received.additiveMean,
          distribution: received.distribution,
        },
        givenUp: {
          assets: [givenUp],
          additiveMean: givenUp.additiveMean,
          distribution: givenUp.distribution,
        },
        net: {
          additiveMean: sign * net,
          distribution: {
            mean: sign * net,
            median: sign * net,
            p10: sign * net - 1,
            p90: sign * net + 1,
          },
        },
        finishAheadProbability: sign === 1 ? 0.8 : 0.1,
        grade: {
          grade: sign === 1 ? ('A+' as const) : ('D' as const),
          state: 'provisional' as const,
          reasonCode: 'complete_high_confidence_development_preview',
        },
      });
      return {
        view,
        practicalEquivalenceProbability: 0.1,
        verdict: { kind: 'favours_club' as const, aflClubIds: ['afl-club:adelaide'] },
        clubs: [
          club('afl-club:adelaide', 'Adelaide', player, pick, 1),
          club('afl-club:st-kilda', 'St Kilda', pick, player, -1),
        ],
      };
    }),
    methodology: {
      additiveStatistic: 'probability_weighted_mean' as const,
      uncertaintyStatistic: 'joint_draw_weighted_quantiles' as const,
      packageMedianIsAdditive: false as const,
      assetGradeTreatment: 'prohibited' as const,
      currentIdentity: 'realized_plus_remaining' as const,
      practicalEquivalenceBasis: 'Fixture threshold.',
      practicalEquivalencePolicy: {
        assumptionSetId: addressed('artifact', 'a'),
        valueUnitId: 'fixed_horizon_pav',
        bandByView: { at_trade: 1, realized: 1, remaining: 1, current: 1 },
      },
    },
  };
  return {
    explanationId: createAflTradeContentAddress('valuation-explanation', content),
    ...content,
  };
}

function lineage(assetId: string, assetType: 'player' | 'current_pick_entitlement') {
  return {
    lineageGraphId: addressed('lineage-graph', assetId === 'asset:player-a' ? 'e' : 'f'),
    rootAssetId: assetId,
    cutoff: {
      effectiveAsOf: '2026-08-19T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-19T00:00:00.000Z',
    },
    nodes: [
      {
        assetId,
        assetType,
        label: assetId === 'asset:player-a' ? 'Player A' : 'Pick 14',
        depth: 0,
        effectiveFrom: '2020-10-10T00:00:00.000Z',
        evidenceId: `evidence:${assetId}`,
      },
    ],
    transformations: [],
    custodyHistory: [],
    dispositions: [],
    frontierAssetIds: [assetId],
  } satisfies AflTradeAssetLineageNarrativeEvidence;
}

function input(): AflTradeCalculationNarrativeInput {
  const playerEvidence: AflTradePlayerCalculationEvidence = {
    kind: 'player',
    state: 'mature_observed',
    observationId: addressed('player-pav-observation', '1'),
    releaseId: addressed('outcome-release', '2'),
    playerId: 'asset:player-a',
    acquisitionSpell: {
      spellId: 'spell:player-a',
      spellVersionId: addressed('acquisition-spell-version', '3'),
      clubId: 'afl-club:adelaide',
      effectiveFrom: '2020-10-10',
      effectiveThrough: null,
      recordedAt: '2020-10-10T00:00:00.000Z',
    },
    predictionSeason: 2020,
    evidenceCutoffAt: '2026-08-19T00:00:00.000Z',
    horizon: {
      endsAt: '2026-12-31T23:59:59.999Z',
      requiredSeasons: [2021, 2022, 2023, 2024, 2025, 2026],
      observedSeasons: [2021, 2022, 2023, 2024, 2025, 2026],
    },
    seasons: [2021, 2022, 2023, 2024, 2025, 2026].map((seasonYear, index) => ({
      seasonYear,
      gamesPlayed: 25,
      contribution: 12,
      contributionPerGame: 0.48,
      calculationId: addressed('hpn-pav-season', String(index + 1)),
      calculationSha256: String(index + 1).repeat(64),
      effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
      sourceObservationIds: [`provider-row:player-a:${seasonYear}`],
    })),
    totals: { gamesPlayed: 150, contribution: 72, contributionPerGame: 0.48 },
  };
  const pickEvidence: AflTradePickCalculationEvidence = {
    kind: 'pick',
    benchmarkId: addressed('pick-pav-benchmark', '4'),
    observationSetId: addressed('pick-pav-observation-set', '5'),
    policyId: addressed('pick-pav-policy', '6'),
    methodId: addressed('hpn-pav-method', '7'),
    valueUnit: 'fixed_horizon_pav',
    selectionNumber: 14,
    cohort: {
      minimumSelectionNumber: 12,
      maximumSelectionNumber: 16,
      observationCount: 48,
      draftClassCount: 12,
      sourceSelectionNumbers: [12, 13, 14, 15, 16],
    },
    expected: { contribution: 70, games: 82 },
    centralRange: {
      contribution: { p10: 20, p50: 65, p90: 130 },
      games: { p10: 12, p50: 76, p90: 180 },
    },
    outcomeProbabilities: [],
    empiricalSupportObservationIds: [addressed('pick-pav-observation', '8')],
    fixedHorizonSeasons: 5,
    limitation: 'Training-only mature cohort.',
  };
  return {
    explanation: explanation(),
    assets: [
      {
        assetId: 'asset:player-a',
        modelEvidence: playerEvidence,
        lineage: lineage('asset:player-a', 'player'),
      },
      {
        assetId: 'asset:pick-14',
        modelEvidence: pickEvidence,
        lineage: lineage('asset:pick-14', 'current_pick_entitlement'),
      },
    ],
  };
}

describe('trade calculation narrative', () => {
  it('connects evidence and exact arithmetic to each club package without asset grades', () => {
    const narrative = createAflTradeCalculationNarrative(input());
    const atTrade = narrative.content.views.find(({ view }) => view === 'at_trade')!;
    const adelaide = atTrade.clubs.find(({ aflClubId }) => aflClubId === 'afl-club:adelaide')!;

    expect(adelaide.arithmetic).toEqual({
      receivedMean: 80,
      givenUpMean: 70,
      estimatedAdvantageMean: 10,
    });
    expect(adelaide.summary).toContain('80 - 70 = +10 fixed_horizon_pav');
    expect(adelaide.summary).toContain('provisional A+ package grade');
    expect(narrative.content.assets).toEqual([
      expect.objectContaining({
        assetId: 'asset:pick-14',
        story: expect.stringContaining('48 observations across 12 draft classes'),
      }),
      expect.objectContaining({
        assetId: 'asset:player-a',
        story: expect.stringContaining('150 games for 72 fixed_horizon_pav'),
      }),
    ]);
    expect(JSON.stringify(narrative)).not.toMatch(/assetGrade|asset grade/i);
    const pick = narrative.content.assets.find(({ assetId }) => assetId === 'asset:pick-14')!;
    const player = narrative.content.assets.find(({ assetId }) => assetId === 'asset:player-a')!;
    expect(pick.contributions.find(({ view }) => view === 'at_trade')?.story).toContain(
      '70 fixed_horizon_pav expected from 48 observations across 12 draft classes'
    );
    expect(player.contributions.find(({ view }) => view === 'realized')?.story).toContain(
      '72 fixed_horizon_pav from 150 games at 0.48 per game'
    );
    expect(player.contributions.find(({ view }) => view === 'remaining')?.story).toContain(
      '20 fixed_horizon_pav remaining model estimate'
    );
    expect(player.contributions.find(({ view }) => view === 'current')?.story).toContain(
      '92 = 72 realized + 20 remaining fixed_horizon_pav'
    );
  });

  it('fails closed when package arithmetic drifts from its assets', () => {
    const request = input();
    request.explanation.views[0]!.clubs[0]!.received.additiveMean += 1;

    expect(() => createAflTradeCalculationNarrative(request)).toThrow(/package arithmetic/i);
  });

  it('fails closed when a player headline total drifts from the retained seasons', () => {
    const request = input();
    const player = request.assets.find(({ assetId }) => assetId === 'asset:player-a')!;
    if (player.modelEvidence.kind !== 'player' || player.modelEvidence.state === 'unavailable') {
      throw new Error('Fixture player evidence must be numeric.');
    }
    const modelEvidence = player.modelEvidence;
    const driftedRequest: AflTradeCalculationNarrativeInput = {
      ...request,
      assets: request.assets.map((entry) =>
        entry.assetId === player.assetId
          ? {
              ...entry,
              modelEvidence: {
                ...modelEvidence,
                totals: { ...modelEvidence.totals, contribution: 73 },
              },
            }
          : entry
      ),
    };

    expect(() => createAflTradeCalculationNarrative(driftedRequest)).toThrow(
      /player evidence totals/i
    );
  });
});

describe('governed private evaluation generation', () => {
  it('pins canonical reader documents and exact JSON export bytes without retaining runtime HTML', () => {
    const narrative = createAflTradeCalculationNarrative(input());
    const materialization = createGovernedPrivateEvaluationGeneration({
      selector: {
        valuationScopeKey: 'afl.mens.trade-value:test-fixture',
        tradeId: narrative.content.tradeId,
      },
      transitionIntentId: addressed('private-evaluation-transition-intent', 'a'),
      generatedAt: '2026-08-19T01:00:00.000Z',
      narrative,
    });

    expect(materialization.projectionManifest.content.documents.map(({ kind }) => kind)).toEqual([
      'archive_summary',
      'detail',
      'reader_api',
      'json_export',
    ]);
    expect(materialization.generation.content.transitionIntentId).toBe(
      addressed('private-evaluation-transition-intent', 'a')
    );
    const exportArtifact = materialization.artifacts.find(({ kind }) => kind === 'json_export')!;
    const exportJson = new TextDecoder().decode(exportArtifact.bytes);
    expect(exportJson.endsWith('\n')).toBe(true);
    expect(JSON.parse(exportJson)).toMatchObject({
      schemaVersion: 'governed-private-evaluation-reader-api/v1',
      selector: materialization.generation.content.selector,
      narrativeId: narrative.narrativeId,
    });
    expect(
      materialization.artifacts.map(({ bytes }) => new TextDecoder().decode(bytes)).join('')
    ).not.toMatch(/<html|__next|react/i);
    expect(verifyGovernedPrivateEvaluationGeneration(materialization)).toBe(true);
    const detailArtifact = materialization.artifacts.find(({ kind }) => kind === 'detail')!;
    expect(decodeGovernedPrivateEvaluationDetailDocument(detailArtifact.bytes)).toMatchObject({
      selector: materialization.generation.content.selector,
      narrativeId: narrative.narrativeId,
      narrative: { tradeId: narrative.content.tradeId },
    });
    const alteredDetail = JSON.parse(new TextDecoder().decode(detailArtifact.bytes));
    alteredDetail.narrative.defaultView = 'at_trade';
    expect(() =>
      decodeGovernedPrivateEvaluationDetailDocument(
        new TextEncoder().encode(JSON.stringify(alteredDetail))
      )
    ).toThrow(/detail|narrative|authenticate/i);
  });

  it('rejects retained export-byte tampering', () => {
    const materialization = createGovernedPrivateEvaluationGeneration({
      selector: {
        valuationScopeKey: 'afl.mens.trade-value:test-fixture',
        tradeId: explanation().tradeId,
      },
      transitionIntentId: addressed('private-evaluation-transition-intent', 'b'),
      generatedAt: '2026-08-19T01:00:00.000Z',
      narrative: createAflTradeCalculationNarrative(input()),
    });
    const exportArtifact = materialization.artifacts.find(({ kind }) => kind === 'json_export')!;
    exportArtifact.bytes[0] = exportArtifact.bytes[0]! ^ 1;

    expect(verifyGovernedPrivateEvaluationGeneration(materialization)).toBe(false);
  });
});
