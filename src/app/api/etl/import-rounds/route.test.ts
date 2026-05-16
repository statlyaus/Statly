import { describe, expect, it, vi, beforeEach } from 'vitest';

const importFootywireRoundsMock = vi.fn();
const listFootywireImportableRoundsMock = vi.fn();
const importAdvancedFootywireRoundsMock = vi.fn();
const refreshPlayerReadModelsMock = vi.fn();

vi.mock('@/lib/footywireImporter', () => ({
  importFootywireRounds: importFootywireRoundsMock,
  listFootywireImportableRounds: listFootywireImportableRoundsMock,
}));

vi.mock('@/lib/footywireStatsIngestion', () => ({
  importAdvancedFootywireRounds: importAdvancedFootywireRoundsMock,
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  refreshPlayerReadModels: refreshPlayerReadModelsMock,
}));

describe('POST /api/etl/import-rounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ETL_IMPORT_TOKEN', 'test-token');
  });

  it('returns metadata and scoring-authoritative stats import results', async () => {
    importFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [0, 1],
      importedMatches: 18,
      importedPlayerStats: 828,
    });
    importAdvancedFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [0, 1],
      dryRun: false,
      fetchedRows: 828,
      sourceDiagnostics: [
        { round: 0, source: 'afltables', rows: 414 },
        { round: 1, source: 'afltables', rows: 414 },
      ],
      written: 700,
      skippedStatus: 0,
      skippedUnchanged: 128,
      quarantinedAmbiguous: 0,
      quarantinedUnresolved: 0,
      observedResolved: 0,
      observedQuarantinedAmbiguous: 0,
      observedQuarantinedUnresolved: 0,
    });
    refreshPlayerReadModelsMock.mockResolvedValue({
      season: 2026,
      playerSeasonSummaries: 457,
      rankingSnapshots: 457,
      rosterSummaries: 456,
      skippedWithoutCanonicalId: 0,
      published: false,
      rankingsDirty: true,
      rostersDirty: true,
      degradedAdvancedStats: [],
      refreshedPlayerIds: 457,
      refreshedRounds: [0, 1],
    });

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost:3000/api/etl/import-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-etl-import-token': 'test-token' },
        body: JSON.stringify({
          season: 2026,
          rounds: [0, 1],
        }),
      }) as any
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(importFootywireRoundsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [0, 1],
      dryRun: false,
    });
    expect(importAdvancedFootywireRoundsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [0, 1],
      dryRun: false,
      dataSource: 'afltables,footywire_match',
    });
    expect(refreshPlayerReadModelsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [0, 1],
    });
    expect(body).toEqual({
      success: true,
      result: {
        season: 2026,
        rounds: [0, 1],
        dryRun: false,
        dataSource: 'afltables,footywire_match',
        metadata: {
          season: 2026,
          rounds: [0, 1],
          importedMatches: 18,
          importedPlayerStats: 828,
        },
        stats: {
          season: 2026,
          rounds: [0, 1],
          dryRun: false,
          fetchedRows: 828,
          sourceDiagnostics: [
            { round: 0, source: 'afltables', rows: 414 },
            { round: 1, source: 'afltables', rows: 414 },
          ],
          written: 700,
          skippedStatus: 0,
          skippedUnchanged: 128,
          quarantinedAmbiguous: 0,
          quarantinedUnresolved: 0,
          observedResolved: 0,
          observedQuarantinedAmbiguous: 0,
          observedQuarantinedUnresolved: 0,
        },
        publication: {
          season: 2026,
          playerSeasonSummaries: 457,
          rankingSnapshots: 457,
          rosterSummaries: 456,
          skippedWithoutCanonicalId: 0,
          published: false,
          rankingsDirty: true,
          rostersDirty: true,
          degradedAdvancedStats: [],
          refreshedPlayerIds: 457,
          refreshedRounds: [0, 1],
        },
        audit: {
          rawImport: {
            sourceNames: ['footywire_metadata', 'afltables', 'footywire_match'],
            metadataMatches: 18,
            metadataPlayerStats: 828,
            statsFetchedRows: 828,
            statsWrittenRows: 700,
          },
          rematerialization: {
            refreshedPlayerIds: 457,
            refreshedRounds: [0, 1],
            rankingsDirty: true,
            rostersDirty: true,
            published: false,
          },
          verifierCommand:
            'npm run verify:player-read-models -- --season 2026 --rounds 0,1 --data-source afltables,footywire_match --json',
        },
      },
    });
  });

  it('repairs all Footywire importable season rounds when rounds are omitted', async () => {
    listFootywireImportableRoundsMock.mockResolvedValue([1, 2, 3, 4]);
    importFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [1, 2, 3, 4],
      importedMatches: 27,
      importedPlayerStats: 1242,
    });
    importAdvancedFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [1, 2, 3, 4],
      dryRun: false,
      fetchedRows: 1242,
      sourceDiagnostics: [],
      written: 1000,
      skippedStatus: 0,
      skippedUnchanged: 242,
      quarantinedAmbiguous: 0,
      quarantinedUnresolved: 0,
      observedResolved: 0,
      observedQuarantinedAmbiguous: 0,
      observedQuarantinedUnresolved: 0,
    });
    refreshPlayerReadModelsMock.mockResolvedValue({
      season: 2026,
      playerSeasonSummaries: 458,
      rankingSnapshots: 458,
      rosterSummaries: 456,
      skippedWithoutCanonicalId: 0,
      published: false,
      rankingsDirty: true,
      rostersDirty: true,
      degradedAdvancedStats: [],
      refreshedPlayerIds: 458,
      refreshedRounds: [1, 2, 3, 4],
    });

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost:3000/api/etl/import-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-etl-import-token': 'test-token' },
        body: JSON.stringify({
          season: 2026,
        }),
      }) as any
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(listFootywireImportableRoundsMock).toHaveBeenCalledWith({ season: 2026 });
    expect(importFootywireRoundsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [1, 2, 3, 4],
      dryRun: false,
    });
    expect(importAdvancedFootywireRoundsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [1, 2, 3, 4],
      dryRun: false,
      dataSource: 'afltables,footywire_match',
    });
    expect(refreshPlayerReadModelsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [1, 2, 3, 4],
    });
    expect(body.result.rounds).toEqual([1, 2, 3, 4]);
    expect(body.result.dataSource).toBe('afltables,footywire_match');
  });

  it('allows callers to override the advanced stats data source explicitly', async () => {
    importFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [2],
      importedMatches: 9,
      importedPlayerStats: 414,
    });
    importAdvancedFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [2],
      dryRun: false,
      fetchedRows: 414,
      sourceDiagnostics: [{ round: 2, source: 'footywire_match', rows: 414 }],
      written: 414,
      skippedStatus: 0,
      skippedUnchanged: 0,
      quarantinedAmbiguous: 0,
      quarantinedUnresolved: 0,
      observedResolved: 0,
      observedQuarantinedAmbiguous: 0,
      observedQuarantinedUnresolved: 0,
    });
    refreshPlayerReadModelsMock.mockResolvedValue({
      season: 2026,
      playerSeasonSummaries: 458,
      rankingSnapshots: 458,
      rosterSummaries: 456,
      skippedWithoutCanonicalId: 0,
      published: false,
      rankingsDirty: true,
      rostersDirty: true,
      degradedAdvancedStats: [],
      refreshedPlayerIds: 458,
      refreshedRounds: [2],
    });

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost:3000/api/etl/import-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-etl-import-token': 'test-token' },
        body: JSON.stringify({
          season: 2026,
          rounds: [2],
          dataSource: 'footywire_match',
        }),
      }) as any
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(importAdvancedFootywireRoundsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [2],
      dryRun: false,
      dataSource: 'footywire_match',
    });
    expect(body.result.dataSource).toBe('footywire_match');
    expect(body.result.audit.verifierCommand).toBe(
      'npm run verify:player-read-models -- --season 2026 --rounds 2 --data-source footywire_match --json'
    );
  });

  it('rejects requests without an explicit token outside local development', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost:3000/api/etl/import-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season: 2026,
          rounds: [1],
        }),
      }) as any
    );

    expect(response.status).toBe(403);
    expect(importFootywireRoundsMock).not.toHaveBeenCalled();
    expect(importAdvancedFootywireRoundsMock).not.toHaveBeenCalled();
    expect(refreshPlayerReadModelsMock).not.toHaveBeenCalled();
  });
});
