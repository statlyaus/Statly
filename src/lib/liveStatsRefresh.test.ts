import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStateMock = vi.fn();
const setStateMock = vi.fn();
const collectionMock = vi.fn();
const importFootywireRoundsMock = vi.fn();
const primeLeagueMatchupSlatesMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: collectionMock,
  },
}));

vi.mock('@/lib/footywireImporter', () => ({
  importFootywireRounds: importFootywireRoundsMock,
}));

vi.mock('@/lib/leagueMatchupPrewarm', () => ({
  primeLeagueMatchupSlates: primeLeagueMatchupSlatesMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: vi.fn(),
  },
}));

describe('refreshLiveStatsIfNeeded', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    collectionMock.mockImplementation((name: string) => {
      if (name !== '_system') {
        throw new Error(`Unexpected collection ${name}`);
      }
      return {
        doc: (id: string) => {
          if (id !== 'live_stats_refresh') {
            throw new Error(`Unexpected doc ${id}`);
          }
          return {
            get: getStateMock,
            set: setStateMock,
          };
        },
      };
    });

    importFootywireRoundsMock.mockResolvedValue({
      season: 2026,
      rounds: [1],
      importedMatches: 1,
      importedPlayerStats: 46,
    });
    primeLeagueMatchupSlatesMock.mockResolvedValue({
      leagueCount: 1,
      primedCount: 1,
      skippedCount: 0,
    });
  });

  it('refreshes live rounds when a current match is on and the refresh window is open', async () => {
    getStateMock.mockResolvedValue({
      exists: false,
      data: () => undefined,
    });

    const { refreshLiveStatsIfNeeded } = await import('./liveStatsRefresh');

    const result = await refreshLiveStatsIfNeeded({
      fetchHtml: async () => `
        <div id="currentMatchesDiv">
          <h2 class="livestats">2026 Round 1 Current Matches</h2>
          <table class="livestats">
            <tr><td class="ldrow"><a href="th-carlton-blues">Blues</a></td><td class="bdrow">54</td></tr>
            <tr><td class="lnorm"><a href="th-richmond-tigers">Tigers</a></td><td class="bnorm">42</td></tr>
            <tr><td colspan="2" class="bdrow"><a href="live_stats?mid=11412">Live Stats</a></td></tr>
          </table>
        </div>
      `,
      now: new Date('2026-03-14T04:00:00.000Z'),
    });

    expect(importFootywireRoundsMock).toHaveBeenCalledWith({
      season: 2026,
      rounds: [1],
      liveMatches: [
        {
          awayTeam: 'Richmond',
          footywireMid: '11412',
          homeTeam: 'Carlton',
          roundNumber: 1,
          season: 2026,
          status: 'in_progress',
        },
      ],
    });
    expect(primeLeagueMatchupSlatesMock).toHaveBeenCalledWith({
      season: 2026,
      round: 1,
      status: 'in_progress',
    });
    expect(result).toMatchObject({
      refreshed: true,
      season: 2026,
      rounds: [1],
      liveMatchCount: 1,
    });
    expect(setStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastCompletedAt: '2026-03-14T04:00:00.000Z',
        season: 2026,
        rounds: [1],
        liveMatchMids: ['11412'],
      }),
      { merge: true }
    );
  });

  it('skips a refresh when the last successful pull was less than 30 seconds ago', async () => {
    getStateMock.mockResolvedValue({
      exists: true,
      data: () => ({
        lastCompletedAt: '2026-03-14T04:00:10.000Z',
      }),
    });

    const { refreshLiveStatsIfNeeded } = await import('./liveStatsRefresh');

    const result = await refreshLiveStatsIfNeeded({
      fetchHtml: async () => `
        <div id="currentMatchesDiv">
          <h2 class="livestats">2026 Round 1 Current Matches</h2>
          <table class="livestats">
            <tr><td class="ldrow"><a href="th-carlton-blues">Blues</a></td><td class="bdrow">54</td></tr>
            <tr><td class="lnorm"><a href="th-richmond-tigers">Tigers</a></td><td class="bnorm">42</td></tr>
            <tr><td colspan="2" class="bdrow"><a href="live_stats?mid=11412">Live Stats</a></td></tr>
          </table>
        </div>
      `,
      now: new Date('2026-03-14T04:00:25.000Z'),
    });

    expect(importFootywireRoundsMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      refreshed: false,
      reason: 'throttled',
      liveMatchCount: 1,
    });
  });
});
