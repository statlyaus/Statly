export interface LocalAflTradeClubFixture {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export type LocalAflTradeAssetFixture =
  | {
      readonly id: string;
      readonly kind: 'current_pick';
      readonly rawDescription: string;
      readonly draftSeasonYear: number;
      readonly nominalRound: number;
      readonly nominalPick: number;
      readonly originalClubId: string;
      readonly fromClubId: string;
      readonly toClubId: string;
      readonly selectionNumber: number;
      readonly selectedPlayerId: string;
      readonly selectedPlayer: string;
    }
  | {
      readonly id: string;
      readonly kind: 'future_pick';
      readonly rawDescription: string;
      readonly draftSeasonYear: number;
      readonly nominalRound: number;
      readonly nominalPick: null;
      readonly originalClubId: string;
      readonly fromClubId: string;
      readonly toClubId: string;
      readonly selectionNumber: null;
      readonly selectedPlayerId: null;
      readonly selectedPlayer: null;
    };

export interface LocalAflTradeFixture {
  readonly id: string;
  readonly versionId: string;
  readonly seasonYear: number;
  readonly occurredOn: string;
  readonly title: string;
  readonly parties: readonly string[];
  readonly assets: readonly LocalAflTradeAssetFixture[];
}

export interface LocalAflTradeArchiveFixture {
  readonly schemaVersion: 'statly-local-source-archive/v1';
  readonly environment: 'test_fixture';
  readonly provider: 'draftguru';
  readonly competition: 'AFLM';
  readonly sourceRefs: readonly string[];
  readonly clubs: readonly LocalAflTradeClubFixture[];
  readonly trades: readonly LocalAflTradeFixture[];
}

const fixture: LocalAflTradeArchiveFixture = {
  schemaVersion: 'statly-local-source-archive/v1',
  environment: 'test_fixture',
  provider: 'draftguru',
  competition: 'AFLM',
  sourceRefs: ['https://www.draftguru.com.au/trades', 'https://www.draftguru.com.au/years/2025'],
  clubs: [
    { id: 'club-gws', slug: 'gws', name: 'GWS' },
    {
      id: 'club-western-bulldogs',
      slug: 'western-bulldogs',
      name: 'Western Bulldogs',
    },
  ],
  trades: [
    {
      id: 'local-trade-2025-gws-western-bulldogs',
      versionId: 'local-trade-version-2025-gws-western-bulldogs-v1',
      seasonYear: 2025,
      occurredOn: '2025-10-15',
      title: '2025 Draft Pick Exchange: GWS and Western Bulldogs',
      parties: ['gws', 'western-bulldogs'],
      assets: [
        {
          id: 'local-pick-2025-nominal-12',
          kind: 'current_pick',
          rawDescription: '#12 (#19 - Josh Lindsay)',
          draftSeasonYear: 2025,
          nominalRound: 1,
          nominalPick: 12,
          originalClubId: 'club-western-bulldogs',
          fromClubId: 'club-western-bulldogs',
          toClubId: 'club-gws',
          selectionNumber: 19,
          selectedPlayerId: 'player-josh-lindsay',
          selectedPlayer: 'Josh Lindsay',
        },
        {
          id: 'local-pick-2025-nominal-14',
          kind: 'current_pick',
          rawDescription: '#14 (#14 - Harry Kyle)',
          draftSeasonYear: 2025,
          nominalRound: 1,
          nominalPick: 14,
          originalClubId: 'club-gws',
          fromClubId: 'club-gws',
          toClubId: 'club-western-bulldogs',
          selectionNumber: 14,
          selectedPlayerId: 'player-harry-kyle',
          selectedPlayer: 'Harry Kyle',
        },
        {
          id: 'local-pick-2026-gws-round-2',
          kind: 'future_pick',
          rawDescription: '2026R2 (GWS)',
          draftSeasonYear: 2026,
          nominalRound: 2,
          nominalPick: null,
          originalClubId: 'club-gws',
          fromClubId: 'club-gws',
          toClubId: 'club-western-bulldogs',
          selectionNumber: null,
          selectedPlayerId: null,
          selectedPlayer: null,
        },
      ],
    },
  ],
};

export function createLocalAflTradeArchiveFixture(): LocalAflTradeArchiveFixture {
  return structuredClone(fixture);
}
