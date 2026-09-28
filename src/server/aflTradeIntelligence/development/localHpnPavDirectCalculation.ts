import type { AflTradeHpnPavCoreTeam } from '../modeling/hpnPavCore';

/**
 * Direct, deterministic HPN PAV over admitted AFL Tables player-match rows.
 *
 * This is the same math the governed private HPN calculation uses, but fed straight from the
 * provider decoded rows, so a caller can reproduce one season's player values without the full
 * reviewed-season-universe materialization. It is a development/verification lane, not a substitute
 * for the governed persistence path.
 */

/** One flattened player-match row, as selected from `outcome_provider_decoded_row`. */
export interface LocalHpnPavDecodedRow {
  /** The row's AFL Tables player identity (`native_entity_id`); names alone are not unique. */
  readonly nativeEntityId: string | null;
  readonly player: string | null;
  readonly playingFor: string | null;
  readonly matchDate: string | null;
  readonly homeTeam: string | null;
  readonly awayTeam: string | null;
  readonly homeScore: string | null;
  readonly awayScore: string | null;
  readonly goals: string | null;
  readonly behinds: string | null;
  readonly marks: string | null;
  readonly tackles: string | null;
  readonly hitOuts: string | null;
  readonly rebounds: string | null;
  readonly clearances: string | null;
  readonly inside50s: string | null;
  readonly goalAssists: string | null;
  readonly freesFor: string | null;
  readonly freesAgainst: string | null;
  readonly onePercenters: string | null;
  readonly marksInside50: string | null;
}

/** A blank stat is a measured zero; anything else must be a finite number, as the governed path requires. */
function count(value: string | null): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`Non-numeric AFL Tables stat value: ${value}`);
  return parsed;
}

/** The PAV core player id for one AFL Tables identity. */
export function localHpnPavPlayerId(nativeEntityId: string): string {
  return `afl-tables:${nativeEntityId}`;
}

function requiredIdentity(row: LocalHpnPavDecodedRow): string {
  if (row.nativeEntityId === null || row.nativeEntityId === '') {
    throw new TypeError(
      `AFL Tables row for ${row.player ?? 'an unnamed player'} has no player identity.`
    );
  }
  return row.nativeEntityId;
}

interface PlayerAccumulator {
  readonly playerId: string;
  readonly team: string;
  totalPoints: number;
  hitOuts: number;
  goalAssists: number;
  inside50s: number;
  marks: number;
  marksInside50: number;
  freeKicksFor: number;
  freeKicksAgainst: number;
  rebound50s: number;
  onePercenters: number;
  clearances: number;
  tackles: number;
}

interface MatchTotals {
  readonly home: string;
  readonly away: string;
  readonly homeScore: number;
  readonly awayScore: number;
  homeInside50s: number;
  awayInside50s: number;
}

interface TeamTotals {
  pointsFor: number;
  pointsAgainst: number;
  inside50sFor: number;
  inside50sAgainst: number;
}

function newAccumulator(playerId: string, team: string): PlayerAccumulator {
  return {
    playerId,
    team,
    totalPoints: 0,
    hitOuts: 0,
    goalAssists: 0,
    inside50s: 0,
    marks: 0,
    marksInside50: 0,
    freeKicksFor: 0,
    freeKicksAgainst: 0,
    rebound50s: 0,
    onePercenters: 0,
    clearances: 0,
    tackles: 0,
  };
}

function addPlayerRow(accumulator: PlayerAccumulator, row: LocalHpnPavDecodedRow): void {
  accumulator.totalPoints += count(row.goals) * 6 + count(row.behinds);
  accumulator.hitOuts += count(row.hitOuts);
  accumulator.goalAssists += count(row.goalAssists);
  accumulator.inside50s += count(row.inside50s);
  accumulator.marks += count(row.marks);
  accumulator.marksInside50 += count(row.marksInside50);
  accumulator.freeKicksFor += count(row.freesFor);
  accumulator.freeKicksAgainst += count(row.freesAgainst);
  accumulator.rebound50s += count(row.rebounds);
  accumulator.onePercenters += count(row.onePercenters);
  accumulator.clearances += count(row.clearances);
  accumulator.tackles += count(row.tackles);
}

/** Adds a row's inside 50s to its own side of the match; a side that is neither is not counted. */
function addMatchRow(
  matches: Map<string, MatchTotals>,
  season: number,
  row: LocalHpnPavDecodedRow
): void {
  const home = row.homeTeam ?? '';
  const away = row.awayTeam ?? '';
  const matchKey = `${season}|${row.matchDate ?? ''}|${home}|${away}`;
  const match = matches.get(matchKey) ?? {
    home,
    away,
    homeScore: count(row.homeScore),
    awayScore: count(row.awayScore),
    homeInside50s: 0,
    awayInside50s: 0,
  };
  if (row.playingFor === home) match.homeInside50s += count(row.inside50s);
  else if (row.playingFor === away) match.awayInside50s += count(row.inside50s);
  matches.set(matchKey, match);
}

/** Season totals per team; each match credits both sides, so for and against always conserve. */
function teamTotals(matches: ReadonlyMap<string, MatchTotals>): Map<string, TeamTotals> {
  const teams = new Map<string, TeamTotals>();
  const add = (team: string, scored: number, conceded: number, inside: number, against: number) => {
    const totals = teams.get(team) ?? {
      pointsFor: 0,
      pointsAgainst: 0,
      inside50sFor: 0,
      inside50sAgainst: 0,
    };
    totals.pointsFor += scored;
    totals.pointsAgainst += conceded;
    totals.inside50sFor += inside;
    totals.inside50sAgainst += against;
    teams.set(team, totals);
  };
  for (const match of matches.values()) {
    add(match.home, match.homeScore, match.awayScore, match.homeInside50s, match.awayInside50s);
    add(match.away, match.awayScore, match.homeScore, match.awayInside50s, match.homeInside50s);
  }
  return teams;
}

/**
 * Aggregates one season of player-match rows into the per-team, per-player input the HPN PAV core
 * consumes. Team inside-50 totals come from the player rows themselves, so both sides of every match
 * conserve exactly; team points come from the match scores carried on each row.
 */
export function aggregateLocalHpnPavCoreInput(input: {
  readonly season: number;
  readonly rows: readonly LocalHpnPavDecodedRow[];
}): readonly AflTradeHpnPavCoreTeam[] {
  const matches = new Map<string, MatchTotals>();
  const players = new Map<string, PlayerAccumulator>();
  for (const row of input.rows) {
    addMatchRow(matches, input.season, row);
    const playingFor = row.playingFor ?? '';
    const playerId = localHpnPavPlayerId(requiredIdentity(row));
    const key = `${playingFor}|${playerId}`;
    const accumulator = players.get(key) ?? newAccumulator(playerId, playingFor);
    addPlayerRow(accumulator, row);
    players.set(key, accumulator);
  }

  return [...teamTotals(matches)].map(([teamId, totals]) => ({
    teamId,
    ...totals,
    players: [...players.values()]
      .filter((player) => player.team === teamId)
      .map(({ team: _team, ...player }) => ({
        ...player,
        spellVersionId: `spell:${input.season}:${teamId}:${player.playerId}`,
        sourceRowIds: [] as string[],
      })),
  }));
}

/**
 * Each identity's recorded names and teams in the season, so a caller matching by name can tell a
 * unique match from an ambiguous one instead of silently picking one player.
 */
export function describeLocalHpnPavPlayers(
  rows: readonly LocalHpnPavDecodedRow[]
): ReadonlyMap<
  string,
  { readonly names: ReadonlySet<string>; readonly teams: ReadonlySet<string> }
> {
  const players = new Map<string, { names: Set<string>; teams: Set<string> }>();
  for (const row of rows) {
    const playerId = localHpnPavPlayerId(requiredIdentity(row));
    const entry = players.get(playerId) ?? { names: new Set<string>(), teams: new Set<string>() };
    if (row.player) entry.names.add(row.player);
    if (row.playingFor) entry.teams.add(row.playingFor);
    players.set(playerId, entry);
  }
  return players;
}
