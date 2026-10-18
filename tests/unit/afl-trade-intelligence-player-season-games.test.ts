import { describe, expect, it } from 'vitest';

import {
  aflTradeFirstStintGames,
  buildAflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesRows,
} from '@/server/aflTradeIntelligence/modeling/playerSeasonGames';
import { loadAflTradePlayerSeasonGames } from '@/server/aflTradeIntelligence/modeling/postgresPlayerSeasonGames';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

import {
  parseReportPlayerSeasonGamesArguments,
  summarizePlayerSeasonGames,
} from '../../Scripts/report-player-season-games';

const methodId = `hpn-pav-method:${'b'.repeat(64)}`;
const options = { methodId, seasons: [2021, 2022, 2023, 2024] };
const finalizedAt = '2026-10-01T00:00:00.000Z';

const head = (season: number, status = 'finalized') => ({
  season_year: season,
  calculation_id: `hpn-pav-season:${season}`,
  status,
  finalized_at: status === 'finalized' ? finalizedAt : null,
});
const player = (season: number, playerId: string, clubId: string, games: number, pav: number) => ({
  season_year: season,
  spell_version_id: `acquisition-spell-version:${playerId}-${clubId}-${season}`,
  player_id: playerId,
  team_id: clubId,
  games_played: games,
  total_pav: pav,
});
const appearance = (season: number, playerId: string, clubId: string, matches: number) => ({
  season_year: season,
  player_id: playerId,
  club_id: clubId,
  matches,
});

// p1: Carlton 2021-2022, 0 games in 2023 (injured), moves to Geelong in 2024.
// p2: Geelong 2021, then Carlton and Geelong in 2022 (mid-season move), Carlton after.
const rows = (): AflTradePlayerSeasonGamesRows => ({
  heads: [head(2021), head(2022), head(2023), head(2024)],
  players: [
    player(2021, 'p1', 'carlton', 20, 10.5),
    player(2022, 'p1', 'carlton', 22, 12),
    player(2024, 'p1', 'geelong', 15, 6),
    player(2021, 'p2', 'geelong', 18, 7),
    player(2022, 'p2', 'carlton', 9, 3),
    player(2022, 'p2', 'geelong', 5, 1),
    player(2023, 'p2', 'carlton', 21, 9),
  ],
  appearances: [
    appearance(2021, 'p1', 'carlton', 20),
    appearance(2022, 'p1', 'carlton', 22),
    appearance(2024, 'p1', 'geelong', 15),
    appearance(2021, 'p2', 'geelong', 18),
    appearance(2022, 'p2', 'carlton', 9),
    appearance(2022, 'p2', 'geelong', 5),
    appearance(2023, 'p2', 'carlton', 21),
  ],
});

describe('player-season games read model', () => {
  it('keys games and PAV by canonical player, season and club, in that order', () => {
    const model = buildAflTradePlayerSeasonGames(options, rows());
    expect(model.seasons.map(({ availability }) => availability)).toEqual([
      'available',
      'available',
      'available',
      'available',
    ]);
    expect(
      model.rows.map(({ playerId, season, clubId, games }) => [playerId, season, clubId, games])
    ).toEqual([
      ['p1', 2021, 'carlton', 20],
      ['p1', 2022, 'carlton', 22],
      ['p1', 2024, 'geelong', 15],
      ['p2', 2021, 'geelong', 18],
      ['p2', 2022, 'carlton', 9],
      ['p2', 2022, 'geelong', 5],
      ['p2', 2023, 'carlton', 21],
    ]);
    expect(model.rows[0]).toMatchObject({
      pav: 10.5,
      spellVersionId: 'acquisition-spell-version:p1-carlton-2021',
    });
    expect(model.discrepancies).toEqual([]);
  });

  it('marks seasons with no head or an unfinalized head instead of reading them', () => {
    const data = rows();
    const model = buildAflTradePlayerSeasonGames(options, {
      heads: [head(2021), head(2022, 'building')],
      players: data.players.filter(({ season_year }) => season_year === 2021),
      appearances: data.appearances.filter(({ season_year }) => season_year === 2021),
    });
    expect(model.seasons).toEqual([
      { season: 2021, availability: 'available', calculationId: 'hpn-pav-season:2021' },
      { season: 2022, availability: 'not_finalized', calculationId: 'hpn-pav-season:2022' },
      { season: 2023, availability: 'no_head', calculationId: null },
      { season: 2024, availability: 'no_head', calculationId: null },
    ]);
    expect(model.rows).toHaveLength(2);
  });

  it('reports PAV without appearances, appearances without PAV and game-count mismatches', () => {
    const data = rows();
    const model = buildAflTradePlayerSeasonGames(options, {
      ...data,
      appearances: [
        ...data.appearances.filter(
          ({ player_id, season_year }) => !(player_id === 'p1' && season_year === 2021)
        ),
        appearance(2022, 'p3', 'carlton', 1),
      ].map((row) =>
        row.player_id === 'p2' && row.season_year === 2023 ? { ...row, matches: 20 } : row
      ),
    });
    expect(model.discrepancies).toEqual([
      { playerId: 'p1', season: 2021, clubId: 'carlton', games: 20, factualMatches: null },
      { playerId: 'p2', season: 2023, clubId: 'carlton', games: 21, factualMatches: 20 },
      { playerId: 'p3', season: 2022, clubId: 'carlton', games: null, factualMatches: 1 },
    ]);
    expect(
      summarizePlayerSeasonGames(model).seasons.map((season) => [
        season.season,
        season.pavWithoutAppearances,
        season.appearancesWithoutPav,
        season.gameCountMismatches,
      ])
    ).toEqual([
      [2021, 1, 0, 0],
      [2022, 0, 1, 0],
      [2023, 0, 0, 1],
      [2024, 0, 0, 0],
    ]);
  });

  it('refuses duplicates, missing game counts, stray rows and non-consecutive seasons', () => {
    const data = rows();
    expect(() =>
      buildAflTradePlayerSeasonGames(options, {
        ...data,
        players: [...data.players, data.players[0]!],
      })
    ).toThrow(/Two PAV rows for p1 at carlton in 2021/);
    expect(() =>
      buildAflTradePlayerSeasonGames(options, {
        ...data,
        players: [{ ...data.players[0]!, games_played: null }],
      })
    ).toThrow(/states no games played/);
    expect(() =>
      buildAflTradePlayerSeasonGames(options, { ...data, heads: data.heads.slice(1) })
    ).toThrow(/outside the finalized seasons read/);
    expect(() => buildAflTradePlayerSeasonGames({ methodId, seasons: [2021, 2023] }, data)).toThrow(
      /consecutive run of seasons/
    );
    expect(() => buildAflTradePlayerSeasonGames({ methodId, seasons: [] }, data)).toThrow(
      /distinct seasons/
    );
  });
});

describe('first stint by appearances', () => {
  const model = buildAflTradePlayerSeasonGames(options, rows());

  it('counts a 0-game season and closes in the first season at another club', () => {
    expect(aflTradeFirstStintGames(model, 'p1', 'carlton', 2021)).toEqual({
      playerId: 'p1',
      clubId: 'carlton',
      startSeason: 2021,
      status: 'closed',
      endSeason: 2023,
      seasons: [
        { season: 2021, games: 20, pav: 10.5 },
        { season: 2022, games: 22, pav: 12 },
        { season: 2023, games: 0, pav: 0 },
      ],
      seasonsUnavailable: [],
      games: 42,
      pav: 22.5,
    });
  });

  it('keeps the move season at both clubs and leaves the later stint open', () => {
    expect(aflTradeFirstStintGames(model, 'p2', 'geelong', 2021)).toMatchObject({
      status: 'closed',
      endSeason: 2022,
      games: 23,
    });
    expect(aflTradeFirstStintGames(model, 'p2', 'carlton', 2022)).toMatchObject({
      status: 'closed',
      endSeason: 2022,
      games: 9,
    });
    expect(aflTradeFirstStintGames(model, 'p2', 'carlton', 2023)).toMatchObject({
      status: 'open',
      endSeason: null,
      seasons: [
        { season: 2023, games: 21, pav: 9 },
        { season: 2024, games: 0, pav: 0 },
      ],
    });
  });

  it('lists seasons with no finalized calculation instead of counting them', () => {
    const data = rows();
    const gapped = buildAflTradePlayerSeasonGames(options, {
      heads: data.heads.filter(({ season_year }) => season_year !== 2022),
      players: data.players.filter(({ season_year }) => season_year !== 2022),
      appearances: data.appearances.filter(({ season_year }) => season_year !== 2022),
    });
    expect(aflTradeFirstStintGames(gapped, 'p1', 'carlton', 2021)).toMatchObject({
      status: 'closed',
      seasons: [
        { season: 2021, games: 20, pav: 10.5 },
        { season: 2023, games: 0, pav: 0 },
      ],
      seasonsUnavailable: [2022],
      games: 20,
    });
  });
});

describe('player-season games loader', () => {
  it('reads in one read-only repeatable-read transaction, only finalized calculations', async () => {
    const data = rows();
    const statements: { sql: string; parameters?: readonly unknown[] }[] = [];
    const answer = (sql: string) => {
      if (sql.includes('FROM outcome_hpn_pav_calculation_head'))
        return [...data.heads.slice(0, 3), head(2024, 'building')];
      if (sql.includes('FROM outcome_hpn_pav_calculation_player'))
        return data.players.filter(({ season_year }) => season_year < 2024);
      if (sql.includes('outcome_hpn_pav_input_factual_appearance_member'))
        return data.appearances.filter(({ season_year }) => season_year < 2024);
      return [];
    };
    let transactions = 0;
    const query = async (sql: string, parameters?: readonly unknown[]) => {
      statements.push({ sql, parameters });
      return { rows: answer(sql) as never[], rowCount: 0 };
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) => {
        transactions++;
        return work({ query });
      },
    } as unknown as AflOutcomeSqlClient;
    const model = await loadAflTradePlayerSeasonGames(client, options);
    expect(transactions).toBe(1);
    expect(statements[0]!.sql).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    expect(statements[1]!.parameters).toEqual([methodId, options.seasons]);
    expect(statements[1]!.sql).toMatch(
      /h\.environment = 'non_production' AND h\.competition = 'AFLM'/
    );
    const finalized = ['hpn-pav-season:2021', 'hpn-pav-season:2022', 'hpn-pav-season:2023'];
    expect(statements[2]!.parameters).toEqual([finalized]);
    expect(statements[2]!.sql).toMatch(/#>> '\{source,gamesPlayed\}'/);
    expect(statements[3]!.parameters).toEqual([finalized]);
    expect(statements[3]!.sql).toMatch(/f\.availability = 'measured' AND f\.appeared = TRUE/);
    expect(model.seasons.at(-1)).toMatchObject({ season: 2024, availability: 'not_finalized' });
    expect(model.discrepancies).toEqual([]);
  });
});

describe('season games report arguments', () => {
  const env = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };

  it('parses the method and a season range', () => {
    expect(
      parseReportPlayerSeasonGamesArguments(['--method', methodId, '--seasons', '2011-2013'], env)
    ).toMatchObject({ methodId, seasons: [2011, 2012, 2013] });
  });

  it('refuses unknown or missing arguments', () => {
    expect(() => parseReportPlayerSeasonGamesArguments(['--out', '/tmp/x'], env)).toThrow(
      /Unexpected argument --out/
    );
    expect(() => parseReportPlayerSeasonGamesArguments(['--method', methodId], env)).toThrow(
      /--seasons is required/
    );
  });
});
