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
    }
  | {
      readonly id: string;
      readonly kind: 'player';
      readonly rawDescription: string;
      readonly fromClubId: string;
      readonly toClubId: string;
      readonly selectedPlayerId: string;
      readonly selectedPlayer: string;
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
  readonly schemaVersion: 'statly-local-source-archive/v2';
  readonly environment: 'test_fixture';
  readonly provider: 'statly_local_fixture';
  readonly competition: 'AFLM';
  readonly fixtureKind: 'synthetic_volume_with_one_source_shaped_rehearsal';
  readonly sourceRefs: readonly string[];
  readonly clubs: readonly LocalAflTradeClubFixture[];
  readonly trades: readonly LocalAflTradeFixture[];
}

const syntheticClubs: readonly LocalAflTradeClubFixture[] = Array.from(
  { length: 18 },
  (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    return {
      id: `club-local-${ordinal}`,
      slug: `local-club-${ordinal}`,
      name: `Local Club ${ordinal}`,
    };
  }
);

function syntheticTrades(): LocalAflTradeFixture[] {
  const trades: LocalAflTradeFixture[] = [];
  let clubRotation = 0;
  for (let seasonYear = 1988; seasonYear <= 2025; seasonYear += 1) {
    const count = seasonYear <= 2002 ? 20 : seasonYear === 2025 ? 20 : 21;
    for (let sequence = 1; sequence <= count; sequence += 1) {
      const ordinal = String(sequence).padStart(3, '0');
      const fromClub = syntheticClubs[clubRotation % syntheticClubs.length]!;
      const toClub = syntheticClubs[(clubRotation + 5) % syntheticClubs.length]!;
      const playerId = `player-local-synthetic-${seasonYear}-${ordinal}`;
      const playerName = `Synthetic Player ${seasonYear}-${ordinal}`;
      const tradeId = `local-synthetic-trade-${seasonYear}-${ordinal}`;
      trades.push({
        id: tradeId,
        versionId: `${tradeId}-v1`,
        seasonYear,
        occurredOn: `${seasonYear}-10-${String(sequence).padStart(2, '0')}`,
        title: `Synthetic local trade ${seasonYear}-${ordinal}`,
        parties: [fromClub.slug, toClub.slug],
        assets: [
          {
            id: `local-synthetic-player-transfer-${seasonYear}-${ordinal}`,
            kind: 'player',
            rawDescription: playerName,
            fromClubId: fromClub.id,
            toClubId: toClub.id,
            selectedPlayerId: playerId,
            selectedPlayer: playerName,
          },
        ],
      });
      clubRotation += 1;
    }
  }
  return trades;
}

const sourceShapedTrade: LocalAflTradeFixture = {
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
};

const fixture: LocalAflTradeArchiveFixture = {
  schemaVersion: 'statly-local-source-archive/v2',
  environment: 'test_fixture',
  provider: 'statly_local_fixture',
  competition: 'AFLM',
  fixtureKind: 'synthetic_volume_with_one_source_shaped_rehearsal',
  sourceRefs: ['fixture://statly/local-afl-trade-volume-v1'],
  clubs: [
    { id: 'club-gws', slug: 'gws', name: 'GWS' },
    {
      id: 'club-western-bulldogs',
      slug: 'western-bulldogs',
      name: 'Western Bulldogs',
    },
    ...syntheticClubs,
  ],
  trades: [sourceShapedTrade, ...syntheticTrades()],
};

export function createLocalAflTradeArchiveFixture(): LocalAflTradeArchiveFixture {
  return structuredClone(fixture);
}
