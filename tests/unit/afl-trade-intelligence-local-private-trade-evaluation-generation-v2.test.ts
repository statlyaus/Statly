import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createLocalPrivateTradeEvaluationGenerationV2 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';

const generatedAt = '2026-08-17T10:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, generatedAt);

const distribution = (mean: number) => ({
  mean,
  median: mean,
  p10: mean - 5,
  p90: mean + 5,
});

const value = (score: number, name: string) => ({
  score,
  distribution: distribution(score),
  evidenceRefs: [evidence(name)],
});

const assetView = (score: number, name: string) => ({
  state: 'calculated' as const,
  ...value(score, name),
  components: [
    {
      componentId: 'component:total',
      label: 'Total governed value',
      score,
      evidenceRefs: [evidence(`${name}-component`)],
    },
  ],
  calculationRefs: [evidence(`${name}-calculation`)],
});

function completeInput() {
  const confirmedResultArtifact = evidence('confirmed-result');
  return {
    valuationScopeKey: 'afl-men:2021-trades',
    tradeId: 'workbook-2021-e7f7d1484744f855',
    workbookSha256: '1'.repeat(64),
    dependencyRefs: [confirmedResultArtifact, evidence('kernel-output')],
    confirmedResultArtifact,
    valueUnitId: 'hpn-season-pav/v1',
    assets: [
      {
        assetId: 'asset-player',
        assetKind: 'player' as const,
        canonicalPlayerId: 'local-afl-player:12516',
        sendingClubId: 'local-afl-club:sydney',
        receivingClubId: 'local-afl-club:adelaide',
        label: 'Jordan Dawson',
        evidenceHorizons: [
          {
            kind: 'completed_season' as const,
            season: 2022,
            gamesPlayed: 22,
            effectiveThrough: '2022-09-24',
            evidenceRefs: [evidence('dawson-2022')],
          },
        ],
        views: {
          atTrade: assetView(70, 'player-at-trade'),
          realized: assetView(60, 'player-realized'),
          remaining: assetView(20, 'player-remaining'),
          current: assetView(80, 'player-current'),
        },
      },
      {
        assetId: 'asset-pick',
        assetKind: 'pick' as const,
        canonicalPlayerId: 'local-afl-player:pick-selection',
        sendingClubId: 'local-afl-club:adelaide',
        receivingClubId: 'local-afl-club:sydney',
        label: '2021 national draft selection',
        evidenceHorizons: [
          {
            kind: 'current_season' as const,
            season: 2026,
            gamesPlayed: 12,
            coverage: 'right_censored' as const,
            effectiveThrough: '2026-05-28',
            evidenceRefs: [evidence('selected-player-2026')],
          },
        ],
        views: {
          atTrade: assetView(50, 'pick-at-trade'),
          realized: assetView(30, 'pick-realized'),
          remaining: assetView(10, 'pick-remaining'),
          current: assetView(40, 'pick-current'),
        },
      },
    ],
    clubTotals: [
      {
        clubId: 'local-afl-club:adelaide',
        views: {
          atTrade: {
            state: 'calculated' as const,
            received: value(70, 'adelaide-at-trade-received'),
            givenUp: value(50, 'adelaide-at-trade-given'),
            net: value(20, 'adelaide-at-trade-net'),
          },
          realized: {
            state: 'calculated' as const,
            received: value(60, 'adelaide-realized-received'),
            givenUp: value(30, 'adelaide-realized-given'),
            net: value(30, 'adelaide-realized-net'),
          },
          remaining: {
            state: 'calculated' as const,
            received: value(20, 'adelaide-remaining-received'),
            givenUp: value(10, 'adelaide-remaining-given'),
            net: value(10, 'adelaide-remaining-net'),
          },
          current: {
            state: 'calculated' as const,
            received: value(80, 'adelaide-current-received'),
            givenUp: value(40, 'adelaide-current-given'),
            net: value(40, 'adelaide-current-net'),
          },
        },
      },
      {
        clubId: 'local-afl-club:sydney',
        views: {
          atTrade: {
            state: 'calculated' as const,
            received: value(50, 'sydney-at-trade-received'),
            givenUp: value(70, 'sydney-at-trade-given'),
            net: value(-20, 'sydney-at-trade-net'),
          },
          realized: {
            state: 'calculated' as const,
            received: value(30, 'sydney-realized-received'),
            givenUp: value(60, 'sydney-realized-given'),
            net: value(-30, 'sydney-realized-net'),
          },
          remaining: {
            state: 'calculated' as const,
            received: value(10, 'sydney-remaining-received'),
            givenUp: value(20, 'sydney-remaining-given'),
            net: value(-10, 'sydney-remaining-net'),
          },
          current: {
            state: 'calculated' as const,
            received: value(40, 'sydney-current-received'),
            givenUp: value(80, 'sydney-current-given'),
            net: value(-40, 'sydney-current-net'),
          },
        },
      },
    ],
    overallGrades: [
      {
        clubId: 'local-afl-club:adelaide',
        state: 'graded' as const,
        grade: 'A' as const,
        normalizedPerformance: 0.8,
        finishesAheadProbability: 0.7,
        evidenceRefs: [evidence('adelaide-grade')],
      },
      {
        clubId: 'local-afl-club:sydney',
        state: 'graded' as const,
        grade: 'C' as const,
        normalizedPerformance: 0.3,
        finishesAheadProbability: 0.2,
        evidenceRefs: [evidence('sydney-grade')],
      },
    ],
    tradeVerdict: {
      state: 'calculated' as const,
      kind: 'favours_club' as const,
      clubIds: ['local-afl-club:adelaide'],
      practicalEquivalenceProbability: 0.1,
      evidenceRefs: [evidence('trade-verdict')],
    },
    generatedAt,
  };
}

describe('local private trade evaluation generation v2', () => {
  it('creates one deterministic complete four-view generation with per-club grades', () => {
    const generation = createLocalPrivateTradeEvaluationGenerationV2(completeInput());

    expect(generation.content).toMatchObject({
      schemaVersion: 'local-private-trade-evaluation-generation/v2',
      environment: 'non_production',
      authority: 'private_confirmed_local_evaluation',
      publicationEligible: false,
      publicationProhibited: true,
      assets: [
        { assetId: 'asset-pick', views: { current: { score: 40 } } },
        { assetId: 'asset-player', views: { current: { score: 80 } } },
      ],
      clubTotals: [
        { clubId: 'local-afl-club:adelaide', views: { current: { net: { score: 40 } } } },
        { clubId: 'local-afl-club:sydney', views: { current: { net: { score: -40 } } } },
      ],
      overallGrades: [
        { clubId: 'local-afl-club:adelaide', grade: 'A' },
        { clubId: 'local-afl-club:sydney', grade: 'C' },
      ],
    });
    expect(generation.generationId).toMatch(/^local-private-trade-evaluation-generation:/u);
    expect(generation.content.dependencyRefs).toContainEqual(evidence('adelaide-grade'));
  });

  it('rejects a calculated verdict that names a club outside the transaction parties', () => {
    const input = completeInput();
    input.tradeVerdict = {
      ...input.tradeVerdict,
      clubIds: ['local-afl-club:unknown'],
    };

    expect(() => createLocalPrivateTradeEvaluationGenerationV2(input)).toThrow(
      'Calculated verdict clubs must be transaction parties'
    );
  });
});
