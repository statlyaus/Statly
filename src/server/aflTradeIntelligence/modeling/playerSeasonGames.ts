/**
 * Games and PAV per canonical player, season and club (value-line method, implementation order step
 * 1; statlyaus/Statly#789). One row per finalized HPN PAV calculation player row: the calculation
 * aggregates a season's primary match rows per v3 season spell, so `games` is the distinct matches
 * the player has a primary row for at that club, and `pav` is that spell's season PAV. Player and club
 * ids are the canonical ids the acquisition spells and the asset ledger use. It reads no candidate,
 * no grade rule and nothing of the realized grader.
 */

export interface AflTradePlayerSeasonGamesOptions {
  /** The HPN PAV method whose current per-season calculations are read. */
  methodId: string;
  seasons: readonly number[];
}

export interface AflTradePlayerSeasonGamesRows {
  heads: readonly {
    season_year: number;
    calculation_id: string;
    status: string;
    finalized_at: string | Date | null;
  }[];
  players: readonly {
    season_year: number;
    spell_version_id: string;
    player_id: string;
    team_id: string;
    games_played: number | null;
    total_pav: number;
  }[];
  /** Distinct measured matches the calculation's own factual appearance universe has per player. */
  appearances: readonly {
    season_year: number;
    player_id: string;
    club_id: string;
    matches: number;
  }[];
}

export type AflTradePlayerSeasonAvailability = 'available' | 'no_head' | 'not_finalized';

export interface AflTradePlayerSeasonGamesRow {
  playerId: string;
  season: number;
  clubId: string;
  games: number;
  pav: number;
  spellVersionId: string;
}

/** A player-season-club the calculation and its factual appearance universe disagree on. */
export interface AflTradePlayerSeasonGamesDiscrepancy {
  playerId: string;
  season: number;
  clubId: string;
  /** Null when the calculation has no row (appearances without PAV). */
  games: number | null;
  /** Null when the factual universe has no appearance (PAV without appearances). */
  factualMatches: number | null;
}

export interface AflTradePlayerSeasonGames {
  methodId: string;
  seasons: readonly {
    season: number;
    availability: AflTradePlayerSeasonAvailability;
    calculationId: string | null;
  }[];
  /** Rows of available seasons, ordered by player, season and club. */
  rows: readonly AflTradePlayerSeasonGamesRow[];
  /** Empty when every row's games equal its factual appearances; a fit must refuse otherwise. */
  discrepancies: readonly AflTradePlayerSeasonGamesDiscrepancy[];
}

const key = (playerId: string, season: number, clubId: string) => `${playerId}|${season}|${clubId}`;
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Maps the loaded rows, refusing duplicates and rows outside the read seasons' finalized heads. */
export function buildAflTradePlayerSeasonGames(
  options: AflTradePlayerSeasonGamesOptions,
  rows: AflTradePlayerSeasonGamesRows
): AflTradePlayerSeasonGames {
  if (options.seasons.length === 0 || new Set(options.seasons).size !== options.seasons.length)
    throw new Error('Read one or more distinct seasons.');
  // A stint walks consecutive seasons; a skipped season would hide a move.
  if (Math.max(...options.seasons) - Math.min(...options.seasons) !== options.seasons.length - 1)
    throw new Error('Read a consecutive run of seasons.');
  const heads = new Map(rows.heads.map((head) => [head.season_year, head]));
  const seasons = [...options.seasons]
    .sort((left, right) => left - right)
    .map((season) => {
      const head = heads.get(season);
      const availability: AflTradePlayerSeasonAvailability = !head
        ? 'no_head'
        : head.status === 'finalized' && head.finalized_at !== null
          ? 'available'
          : 'not_finalized';
      return { season, availability, calculationId: head?.calculation_id ?? null };
    });
  const available = new Set(
    seasons.filter((season) => season.availability === 'available').map(({ season }) => season)
  );
  const byKey = new Map<string, AflTradePlayerSeasonGamesRow>();
  for (const row of rows.players) {
    if (!available.has(row.season_year))
      throw new Error(`PAV row ${row.spell_version_id} is outside the finalized seasons read.`);
    const rowKey = key(row.player_id, row.season_year, row.team_id);
    if (byKey.has(rowKey))
      throw new Error(`Two PAV rows for ${row.player_id} at ${row.team_id} in ${row.season_year}.`);
    // Every finalized v3 calculation states games; a missing count is a different calculation shape.
    if (row.games_played === null || !Number.isInteger(row.games_played) || row.games_played < 1)
      throw new Error(`PAV row ${row.spell_version_id} states no games played.`);
    byKey.set(rowKey, {
      playerId: row.player_id,
      season: row.season_year,
      clubId: row.team_id,
      games: row.games_played,
      pav: row.total_pav,
      spellVersionId: row.spell_version_id,
    });
  }
  const factual = new Map<string, AflTradePlayerSeasonGamesRows['appearances'][number]>();
  for (const row of rows.appearances) {
    if (!available.has(row.season_year))
      throw new Error(`Appearances for ${row.player_id} are outside the finalized seasons read.`);
    factual.set(key(row.player_id, row.season_year, row.club_id), row);
  }
  const discrepancies: AflTradePlayerSeasonGamesDiscrepancy[] = [];
  for (const [rowKey, row] of byKey) {
    const matches = factual.get(rowKey)?.matches ?? null;
    if (matches !== row.games)
      discrepancies.push({
        playerId: row.playerId,
        season: row.season,
        clubId: row.clubId,
        games: row.games,
        factualMatches: matches,
      });
  }
  for (const [rowKey, row] of factual) {
    if (!byKey.has(rowKey))
      discrepancies.push({
        playerId: row.player_id,
        season: row.season_year,
        clubId: row.club_id,
        games: null,
        factualMatches: row.matches,
      });
  }
  const order = (left: { playerId: string; season: number; clubId: string }, right: typeof left) =>
    compare(left.playerId, right.playerId) ||
    left.season - right.season ||
    compare(left.clubId, right.clubId);
  return {
    methodId: options.methodId,
    seasons,
    rows: [...byKey.values()].sort(order),
    discrepancies: discrepancies.sort(order),
  };
}

export interface AflTradeFirstStintGames {
  playerId: string;
  clubId: string;
  startSeason: number;
  /** Closed once the player appears for another club in an available season. */
  status: 'open' | 'closed';
  /** The last season counted, when closed. */
  endSeason: number | null;
  /** Each available season counted, with 0 games and 0 PAV when the player did not play. */
  seasons: readonly { season: number; games: number; pav: number }[];
  /** Seasons inside the stint with no finalized calculation; the stint is not complete without them. */
  seasonsUnavailable: readonly number[];
  games: number;
  pav: number;
}

/**
 * A player's first stint at a club from `fromSeason`, by appearances alone. It is the realized
 * grader's boundary without the grader's reviewed-arrival input: the stint ends in the first
 * available season the player appears for another club (that season still counts here if he also
 * played here), and is open when that never happens. A season he did not play anywhere counts with 0
 * games, as a season lost to injury does. Not visible from appearances: a delisting or retirement (the
 * stint stays open with 0-game seasons) and a re-arrival at the same club with no game elsewhere in
 * between (read as one stint).
 */
export function aflTradeFirstStintGames(
  model: AflTradePlayerSeasonGames,
  playerId: string,
  clubId: string,
  fromSeason: number
): AflTradeFirstStintGames {
  const clubsBySeason = new Map<number, AflTradePlayerSeasonGamesRow[]>();
  for (const row of model.rows) {
    if (row.playerId !== playerId) continue;
    clubsBySeason.set(row.season, [...(clubsBySeason.get(row.season) ?? []), row]);
  }
  const stint: AflTradeFirstStintGames = {
    playerId,
    clubId,
    startSeason: fromSeason,
    status: 'open',
    endSeason: null,
    seasons: [],
    seasonsUnavailable: [],
    games: 0,
    pav: 0,
  };
  const seasons: { season: number; games: number; pav: number }[] = [];
  const unavailable: number[] = [];
  for (const { season, availability } of model.seasons) {
    if (season < fromSeason) continue;
    if (availability !== 'available') {
      unavailable.push(season);
      continue;
    }
    const rows = clubsBySeason.get(season) ?? [];
    const here = rows.find((row) => row.clubId === clubId);
    const departed = rows.some((row) => row.clubId !== clubId);
    if (!departed || here) seasons.push({ season, games: here?.games ?? 0, pav: here?.pav ?? 0 });
    if (departed) {
      const counted = seasons.map(({ season: counted }) => counted);
      return {
        ...stint,
        status: 'closed',
        endSeason: counted.length ? Math.max(...counted) : null,
        seasons,
        seasonsUnavailable: unavailable,
        ...totals(seasons),
      };
    }
  }
  return { ...stint, seasons, seasonsUnavailable: unavailable, ...totals(seasons) };
}

const totals = (seasons: readonly { games: number; pav: number }[]) => ({
  games: seasons.reduce((sum, { games }) => sum + games, 0),
  pav: seasons.reduce((sum, { pav }) => sum + pav, 0),
});
