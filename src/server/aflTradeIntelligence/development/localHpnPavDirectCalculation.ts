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

function count(value: string | null): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface PlayerAccumulator {
  readonly player: string;
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

/**
 * Aggregates one season of player-match rows into the per-team, per-player input the HPN PAV core
 * consumes. Team inside-50 totals come from the player rows themselves, so both sides of every match
 * conserve exactly; team points come from the match scores carried on each row.
 */
export function aggregateLocalHpnPavCoreInput(input: {
  readonly season: number;
  readonly rows: readonly LocalHpnPavDecodedRow[];
}): readonly AflTradeHpnPavCoreTeam[] {
  const matches = new Map<
    string,
    { home: string; away: string; homeScore: number; awayScore: number }
  >();
  const matchInside50 = new Map<string, { home: number; away: number }>();
  const players = new Map<string, PlayerAccumulator>();
  const teamPointsFor = new Map<string, number>();
  const teamPointsAgainst = new Map<string, number>();
  const teamInside50For = new Map<string, number>();
  const teamInside50Against = new Map<string, number>();

  for (const row of input.rows) {
    const playingFor = row.playingFor ?? '';
    const home = row.homeTeam ?? '';
    const away = row.awayTeam ?? '';
    const date = row.matchDate ?? '';
    const matchKey = `${input.season}|${date}|${home}|${away}`;
    if (!matches.has(matchKey)) {
      matches.set(matchKey, {
        home,
        away,
        homeScore: count(row.homeScore),
        awayScore: count(row.awayScore),
      });
    }
    const inside50 = count(row.inside50s);
    const bySide = matchInside50.get(matchKey) ?? { home: 0, away: 0 };
    if (playingFor === home) bySide.home += inside50;
    else if (playingFor === away) bySide.away += inside50;
    matchInside50.set(matchKey, bySide);

    const key = `${playingFor}|${row.player ?? ''}`;
    const accumulator = players.get(key) ?? {
      player: row.player ?? '',
      team: playingFor,
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
    accumulator.totalPoints += count(row.goals) * 6 + count(row.behinds);
    accumulator.hitOuts += count(row.hitOuts);
    accumulator.goalAssists += count(row.goalAssists);
    accumulator.inside50s += inside50;
    accumulator.marks += count(row.marks);
    accumulator.marksInside50 += count(row.marksInside50);
    accumulator.freeKicksFor += count(row.freesFor);
    accumulator.freeKicksAgainst += count(row.freesAgainst);
    accumulator.rebound50s += count(row.rebounds);
    accumulator.onePercenters += count(row.onePercenters);
    accumulator.clearances += count(row.clearances);
    accumulator.tackles += count(row.tackles);
    players.set(key, accumulator);
  }

  for (const [matchKey, match] of matches) {
    const sides = matchInside50.get(matchKey) ?? { home: 0, away: 0 };
    teamPointsFor.set(match.home, (teamPointsFor.get(match.home) ?? 0) + match.homeScore);
    teamPointsFor.set(match.away, (teamPointsFor.get(match.away) ?? 0) + match.awayScore);
    teamPointsAgainst.set(match.home, (teamPointsAgainst.get(match.home) ?? 0) + match.awayScore);
    teamPointsAgainst.set(match.away, (teamPointsAgainst.get(match.away) ?? 0) + match.homeScore);
    teamInside50For.set(match.home, (teamInside50For.get(match.home) ?? 0) + sides.home);
    teamInside50For.set(match.away, (teamInside50For.get(match.away) ?? 0) + sides.away);
    teamInside50Against.set(match.home, (teamInside50Against.get(match.home) ?? 0) + sides.away);
    teamInside50Against.set(match.away, (teamInside50Against.get(match.away) ?? 0) + sides.home);
  }

  const teamIds = [...new Set([...teamPointsFor.keys()])];
  return teamIds.map((teamId) => ({
    teamId,
    pointsFor: teamPointsFor.get(teamId) ?? 0,
    pointsAgainst: teamPointsAgainst.get(teamId) ?? 0,
    inside50sFor: teamInside50For.get(teamId) ?? 0,
    inside50sAgainst: teamInside50Against.get(teamId) ?? 0,
    players: [...players.values()]
      .filter((player) => player.team === teamId)
      .map((player) => ({
        spellVersionId: `spell:${input.season}:${teamId}:${player.player}`,
        playerId: player.player,
        sourceRowIds: [] as string[],
        totalPoints: player.totalPoints,
        hitOuts: player.hitOuts,
        goalAssists: player.goalAssists,
        inside50s: player.inside50s,
        marks: player.marks,
        marksInside50: player.marksInside50,
        freeKicksFor: player.freeKicksFor,
        freeKicksAgainst: player.freeKicksAgainst,
        rebound50s: player.rebound50s,
        onePercenters: player.onePercenters,
        clearances: player.clearances,
        tackles: player.tackles,
      })),
  }));
}
