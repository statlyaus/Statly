// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { projectAflOutcomesDevelopmentWorkbookValues } from '@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection';
import type { AflTradeDevelopmentReconciledAcquisitionOutcome } from '@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection';
import type { AflOutcomesDevelopmentAcquisitionProjection } from '@/server/aflTradeIntelligence/source/developmentWorkbookAcquisitionProjection';
import type { AflOutcomesDevelopmentTradeProjection } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';

function acquisition(input: {
  eventId: string;
  year: number;
  category?: 'national_draft' | 'trade';
  playerName: string;
  clubName: string;
  draftNumber: number | null;
  games: string;
}) {
  return {
    eventId: input.eventId,
    year: input.year,
    category: input.category ?? 'national_draft',
    acquisitionType: input.category === 'trade' ? 'Trade' : 'National',
    signing: null,
    pick: null,
    draftNumber: input.draftNumber,
    clubName: input.clubName,
    playerName: input.playerName,
    age: 18,
    heightCm: 188,
    weightKg: 82,
    originalClub: null,
    grade: 'A+',
    games: input.games,
    goals: '4',
    coachesVotes: '2',
    brownlowVotes: '1',
    awards: null,
  } as const;
}

function acquisitions(): AflOutcomesDevelopmentAcquisitionProjection {
  const historical = [2010, 2011, 2012, 2013, 2014].map((year, index) =>
    acquisition({
      eventId: `${year}_0001`,
      year,
      playerName: `Historical Player ${index}`,
      clubName: 'Historical Club',
      draftNumber: index < 3 ? 12 + index : 40 + index,
      games: String(30 + index * 10),
    })
  );
  const items = [
    ...historical,
    acquisition({
      eventId: '2025_0026',
      year: 2025,
      category: 'trade',
      playerName: 'Liam Reidy',
      clubName: 'Carlton',
      draftNumber: null,
      games: '1',
    }),
    acquisition({
      eventId: '2025_0083',
      year: 2025,
      playerName: 'Hugo Mikunda',
      clubName: 'North Melbourne',
      draftNumber: 48,
      games: '0',
    }),
    acquisition({
      eventId: '2025_0078',
      year: 2025,
      playerName: 'Cody Curtin',
      clubName: 'Brisbane',
      draftNumber: 43,
      games: '0',
    }),
  ];
  return {
    items,
    years: [2025, 2014, 2013, 2012, 2011, 2010],
    categoryCounts: {
      national_draft: items.filter(({ category }) => category === 'national_draft').length,
      rookie_draft: 0,
      mid_season_draft: 0,
      pre_season_draft: 0,
      mini_draft: 0,
      trade: 1,
      free_agency: 0,
      pre_draft: 0,
      post_draft: 0,
      training_squad_selection: 0,
    },
  };
}

function reconciledOutcomes(
  input: AflOutcomesDevelopmentAcquisitionProjection = acquisitions()
): ReadonlyMap<string, AflTradeDevelopmentReconciledAcquisitionOutcome> {
  return new Map(
    input.items.map((item) => {
      const metric =
        item.year <= 2023
          ? ({ state: 'observed', value: 10 } as const)
          : ({
              state: 'partial',
              observedValue: 2,
              reason: 'active_career_right_censored',
            } as const);
      return [
        item.eventId,
        {
          source: 'reconciled_acquisition_spell' as const,
          effectiveThrough: '2026-08-07T00:00:00.000Z',
          metrics: {
            games: metric,
            goals: metric,
            coachesVotes: metric,
            brownlowVotes: metric,
          },
        },
      ];
    })
  );
}

function trades(): AflOutcomesDevelopmentTradeProjection {
  const tradeId = 'workbook-2025-fixture';
  const trade = {
    tradeId,
    year: 2025,
    seqInYear: 1,
    title: '2025 Trade for Liam Reidy',
    clubSlugs: ['carlton', 'fremantle'],
    clubNames: ['Carlton', 'Fremantle'],
    partyCount: 2,
    assetCount: 5,
    hasPlayers: true,
    hasPicks: true,
    hasFuturePicks: false,
    receivesByClub: [
      {
        clubSlug: 'carlton',
        clubName: 'Carlton',
        assetCount: 3,
        playerCount: 1,
        pickCount: 2,
        futurePickCount: 0,
      },
      {
        clubSlug: 'fremantle',
        clubName: 'Fremantle',
        assetCount: 2,
        playerCount: 0,
        pickCount: 2,
        futurePickCount: 0,
      },
    ],
  };
  const asset = (
    id: string,
    clubSlug: string,
    clubName: string,
    assetIndex: number,
    assetType: 'player' | 'pick',
    playerName: string | null,
    draftedPlayer: string | null,
    numberGiven: number | null,
    numberActual: number | null
  ) => ({
    id,
    tradeId,
    year: 2025,
    clubSlug,
    clubName,
    assetIndex,
    assetType,
    assetText: id,
    playerName,
    pick: {
      code: null,
      numberGiven,
      year: null,
      round: numberGiven && numberGiven <= 20 ? 1 : 3,
      originalClub: null,
      numberActual,
    },
    draftedPlayer,
    games: null,
    note: null,
  });
  const assets = [
    asset('asset-reidy', 'carlton', 'Carlton', 1, 'player', 'Reidy', null, null, null),
    asset('asset-mikunda', 'carlton', 'Carlton', 2, 'pick', null, 'Mikunda', 53, 48),
    asset('asset-unresolved-carlton', 'carlton', 'Carlton', 3, 'pick', null, null, 71, null),
    asset('asset-curtin', 'fremantle', 'Fremantle', 4, 'pick', null, 'Curtin', 50, 43),
    asset('asset-unresolved-fremantle', 'fremantle', 'Fremantle', 5, 'pick', null, null, 68, null),
  ];
  return {
    years: [2025],
    tradesByYear: new Map([[2025, [trade]]]),
    detailsById: new Map([
      [
        tradeId,
        {
          trade,
          parties: [
            {
              id: 'party-carlton',
              tradeId,
              year: 2025,
              seqInYear: 1,
              tradeTitle: trade.title,
              clubSlug: 'carlton',
              clubName: 'Carlton',
              rowOrder: 1,
              assetsRaw: '',
              expected: 999,
              actual: 999,
            },
            {
              id: 'party-fremantle',
              tradeId,
              year: 2025,
              seqInYear: 1,
              tradeTitle: trade.title,
              clubSlug: 'fremantle',
              clubName: 'Fremantle',
              rowOrder: 2,
              assetsRaw: '',
              expected: 1,
              actual: 1,
            },
          ],
          assets,
        },
      ],
    ]),
    clubs: [],
    refsByClub: new Map(),
  };
}

describe('development workbook Statly value projection', () => {
  it('does not treat workbook-recorded games as reconciled acquisition-spell facts', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookValues({
      trades: trades(),
      acquisitions: acquisitions(),
      providerSeasons: [],
      reconciledOutcomesByAcquisitionId: new Map(),
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
    });
    const value = projection.valuesByTradeId.get('workbook-2025-fixture');
    const reidy = value?.assets.find(({ assetId }) => assetId === 'asset-reidy');
    const link = projection.linksByTradeId
      .get('workbook-2025-fixture')
      ?.find(({ assetId }) => assetId === 'asset-reidy');

    expect(reidy?.state).not.toBe('right_censored');
    expect(link).toMatchObject({
      state: 'linked',
      acquisitionId: '2025_0026',
      outcomeEvidence: {
        state: 'unavailable',
        reason: 'no_reconciled_acquisition_spell',
      },
    });
  });

  it('links unique player and used-pick outcomes while leaving unresolved picks explicit', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookValues({
      trades: trades(),
      acquisitions: acquisitions(),
      providerSeasons: [],
      reconciledOutcomesByAcquisitionId: new Map(),
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
    });

    expect(projection.linksByTradeId.get('workbook-2025-fixture')).toMatchObject([
      { assetId: 'asset-reidy', state: 'linked', acquisitionId: '2025_0026' },
      { assetId: 'asset-mikunda', state: 'linked', acquisitionId: '2025_0083' },
      { assetId: 'asset-unresolved-carlton', state: 'unresolved', acquisitionId: null },
      { assetId: 'asset-curtin', state: 'linked', acquisitionId: '2025_0078' },
      { assetId: 'asset-unresolved-fremantle', state: 'unresolved', acquisitionId: null },
    ]);
  });

  it('derives Statly grades from model probabilities and never imports workbook grades or party comparisons', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookValues({
      trades: trades(),
      acquisitions: acquisitions(),
      providerSeasons: [],
      reconciledOutcomesByAcquisitionId: reconciledOutcomes(),
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
    });
    const value = projection.valuesByTradeId.get('workbook-2025-fixture');
    const grades = projection.gradesByTradeId.get('workbook-2025-fixture');

    expect(value?.summaries.at_trade.availability).toBe('available');
    expect(grades?.atTrade.clubs).toHaveLength(2);
    expect(grades?.current.clubs.every(({ grade }) => grade !== null)).toBe(true);
    expect(projection.linksByTradeId.get('workbook-2025-fixture')?.[0]?.outcomeEvidence).toEqual({
      state: 'reconciled',
      effectiveThrough: '2026-08-07T00:00:00.000Z',
      games: {
        state: 'partial',
        observedValue: 2,
        reason: 'active_career_right_censored',
      },
    });
    expect(JSON.stringify({ value, grades })).not.toMatch(/999|legacy|workbookGrade/i);
  });

  it('uses selection and demographic cohorts when no reconciled provider season exists', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookValues({
      trades: trades(),
      acquisitions: acquisitions(),
      providerSeasons: [],
      reconciledOutcomesByAcquisitionId: reconciledOutcomes(),
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
    });
    const value = projection.valuesByTradeId.get('workbook-2025-fixture');

    expect(value?.summaries.at_trade.availability).toBe('available');
    expect(value?.assets.every(({ featureProviders }) => featureProviders.length === 0)).toBe(true);
  });

  it('fails an ambiguous surname match closed instead of choosing a player by name', () => {
    const input = acquisitions();
    input.items = [
      ...input.items,
      acquisition({
        eventId: '2025_0999',
        year: 2025,
        category: 'trade',
        playerName: 'Other Reidy',
        clubName: 'Carlton',
        draftNumber: null,
        games: '20',
      }),
    ];
    const projection = projectAflOutcomesDevelopmentWorkbookValues({
      trades: trades(),
      acquisitions: input,
      providerSeasons: [],
      reconciledOutcomesByAcquisitionId: new Map(),
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
    });

    expect(projection.linksByTradeId.get('workbook-2025-fixture')?.[0]).toMatchObject({
      assetId: 'asset-reidy',
      state: 'ambiguous',
      acquisitionId: null,
    });
  });
});
