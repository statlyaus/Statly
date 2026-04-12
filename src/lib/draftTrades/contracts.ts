export const DRAFT_TRADE_COLLECTIONS = {
  trades: 'draftTrades',
  clubs: 'draftClubs',
  meta: 'draftMeta',
} as const;

export const DRAFT_IMPORT_META = {
  importRunsDocId: 'importRuns',
  runsSubcollection: 'runs',
  schemaVersion: 'v1',
} as const;

export interface DraftTradeReceiveByClubDoc {
  clubSlug: string;
  clubName: string;
  assetCount: number;
  playerCount: number;
  pickCount: number;
  futurePickCount: number;
}

export interface DraftTradeDoc {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  source: {
    title: string;
    row: number;
    sha1: string;
  };
  clubSlugs: string[];
  clubNames: string[];
  partyCount: number;
  assetCount: number;
  hasPlayers: boolean;
  hasPicks: boolean;
  hasFuturePicks: boolean;
  receivesByClub: DraftTradeReceiveByClubDoc[];
  importVersion: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DraftTradePartyDoc {
  tradeId: string;
  year: number;
  seqInYear: number;
  tradeTitle: string;
  clubSlug: string;
  clubName: string;
  rowOrder: number;
  assetsRaw: string;
  expected: number | null;
  actual: number | null;
  importVersion: string;
  updatedAt: unknown;
}

export interface DraftTradeAssetDoc {
  tradeId: string;
  year: number;
  clubSlug: string;
  clubName: string;
  assetIndex: number;
  assetType: 'player' | 'pick' | 'future_pick' | 'unknown';
  assetText: string;
  playerName: string | null;
  pick: {
    code: string | null;
    numberGiven: number | null;
    year: number | null;
    round: number | null;
    originalClub: string | null;
    numberActual: number | null;
  };
  draftedPlayer: string | null;
  games: number | null;
  note: string | null;
  importVersion: string;
  updatedAt: unknown;
}

export interface DraftTradeImportRunDoc {
  runId: string;
  status: 'running' | 'success' | 'failed';
  schemaVersion: string;
  source: {
    tradesPath: string;
    partiesPath: string;
    assetsPath: string;
    tradesSha1: string;
    partiesSha1: string;
    assetsSha1: string;
    combinedSha1: string;
  };
  counts: {
    trades: number;
    parties: number;
    assets: number;
    clubs: number;
    writeOps: number;
    batches: number;
  };
  errors: string[];
  startedAt: unknown;
  finishedAt?: unknown;
}

export interface DraftClubDoc {
  clubSlug: string;
  clubName: string;
  tradeCount: number;
  partyCount: number;
  assetCount: number;
  firstYear: number | null;
  lastYear: number | null;
  importVersion: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Club summary for directory UIs; safe for client components (no server-only deps). */
export type DraftClubListItem = Pick<
  DraftClubDoc,
  'clubSlug' | 'clubName' | 'tradeCount' | 'partyCount' | 'assetCount' | 'firstYear' | 'lastYear'
>;

export interface DraftClubTradeRefDoc {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubSlug: string;
  clubName: string;
  assetsRaw: string;
  expected: number | null;
  actual: number | null;
  importVersion: string;
  updatedAt: unknown;
}

/** Row for `clubs/{slug}/tradeRefs` in UIs/APIs (no Firestore-only fields). Safe to pass to client components. */
export type DraftClubTradeRefRow = {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubSlug: string;
  clubName: string;
  assetsRaw: string;
  expected: number | null;
  actual: number | null;
};

export interface DraftMetaAggregatesDoc {
  tradeYears: number[];
  importVersion: string;
  updatedAt: unknown;
}

export interface DraftMetaCurrentVersionDoc {
  datasetId: string;
  collections: {
    trades: string;
    clubs: string;
    meta: string;
  };
  importVersion: string;
  activatedAt: unknown;
}
