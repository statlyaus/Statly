export interface AflTradeHpnPavCorePlayer {
  readonly spellVersionId: string;
  readonly playerId: string;
  readonly sourceRowIds: readonly string[];
  readonly totalPoints: number;
  readonly hitOuts: number;
  readonly goalAssists: number;
  readonly inside50s: number;
  readonly marks: number;
  readonly marksInside50: number;
  readonly freeKicksFor: number;
  readonly freeKicksAgainst: number;
  readonly rebound50s: number;
  readonly onePercenters: number;
  readonly clearances: number;
  readonly tackles: number;
}

export interface AflTradeHpnPavCoreTeam {
  readonly teamId: string;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly inside50sFor: number;
  readonly inside50sAgainst: number;
  readonly players: readonly AflTradeHpnPavCorePlayer[];
}

export interface AflTradeHpnPavCoreResult {
  readonly league: {
    readonly teamCount: number;
    readonly leaguePointsPerInside50: number;
    readonly componentPools: {
      readonly offensivePav: number;
      readonly midfieldPav: number;
      readonly defensivePav: number;
    };
    readonly totalPav: number;
  };
  readonly teams: ReadonlyArray<{
    readonly teamId: string;
    readonly source: Omit<AflTradeHpnPavCoreTeam, 'players'>;
    readonly rawStrength: {
      readonly offence: number;
      readonly midfield: number;
      readonly defence: number;
    };
    readonly offensivePav: number;
    readonly midfieldPav: number;
    readonly defensivePav: number;
    readonly totalPav: number;
  }>;
  readonly players: ReadonlyArray<{
    readonly spellVersionId: string;
    readonly playerId: string;
    readonly teamId: string;
    readonly source: Omit<AflTradeHpnPavCorePlayer, 'spellVersionId' | 'playerId'>;
    readonly offensiveScore: number;
    readonly midfieldScore: number;
    readonly defensiveScore: number;
    readonly offensivePav: number;
    readonly midfieldPav: number;
    readonly defensivePav: number;
    readonly totalPav: number;
  }>;
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function normalized(value: number): number {
  const result = Number(value.toFixed(12));
  if (!Number.isFinite(result))
    throw new RangeError('PAV calculation produced a non-finite value.');
  return result;
}

function requireCount(value: number, label: string, positive = false): void {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0)) {
    throw new RangeError(`${label} must be a ${positive ? 'positive' : 'non-negative'} integer.`);
  }
}

function scores(player: AflTradeHpnPavCorePlayer) {
  const freeKickDifferential = player.freeKicksFor - player.freeKicksAgainst;
  return {
    offence:
      player.totalPoints +
      0.25 * player.hitOuts +
      3 * player.goalAssists +
      player.inside50s +
      player.marksInside50 +
      freeKickDifferential,
    midfield:
      15 * player.inside50s +
      20 * player.clearances +
      3 * player.tackles +
      1.5 * player.hitOuts +
      freeKickDifferential,
    defence:
      20 * player.rebound50s +
      12 * player.onePercenters +
      player.marks -
      4 * player.marksInside50 +
      2 * freeKickDifferential -
      (2 / 3) * player.hitOuts,
  };
}

export function calculateAflTradeHpnPavCore(
  untrustedTeams: readonly AflTradeHpnPavCoreTeam[]
): AflTradeHpnPavCoreResult {
  if (untrustedTeams.length < 2 || untrustedTeams.length > 30) {
    throw new RangeError('HPN PAV requires between two and thirty teams.');
  }
  const teams = [...untrustedTeams].sort((left, right) => compare(left.teamId, right.teamId));
  if (new Set(teams.map(({ teamId }) => teamId)).size !== teams.length) {
    throw new RangeError('HPN PAV team IDs must be unique.');
  }
  const spellKeys = new Set<string>();
  for (const team of teams) {
    requireCount(team.pointsFor, 'Team points for', true);
    requireCount(team.pointsAgainst, 'Team points against', true);
    requireCount(team.inside50sFor, 'Team inside 50s for', true);
    requireCount(team.inside50sAgainst, 'Team inside 50s against', true);
    if (team.players.length === 0) throw new RangeError('Every HPN PAV team needs player rows.');
    for (const player of team.players) {
      if (player.spellVersionId.length === 0) {
        throw new RangeError('Player contribution requires an acquisition-spell version.');
      }
      if (spellKeys.has(player.spellVersionId)) {
        throw new RangeError('Acquisition-spell rows must be unique.');
      }
      spellKeys.add(player.spellVersionId);
      for (const [field, value] of Object.entries(player)) {
        if (field !== 'spellVersionId' && field !== 'playerId' && field !== 'sourceRowIds') {
          requireCount(value as number, field);
        }
      }
    }
  }
  const sum = (field: 'pointsFor' | 'pointsAgainst' | 'inside50sFor' | 'inside50sAgainst') =>
    teams.reduce((total, team) => total + team[field], 0);
  if (
    sum('pointsFor') !== sum('pointsAgainst') ||
    sum('inside50sFor') !== sum('inside50sAgainst')
  ) {
    throw new RangeError('League points and inside 50 totals must conserve.');
  }

  const leaguePointsPerInside50 = sum('pointsFor') / sum('inside50sFor');
  const rawTeams = teams.map((team) => ({
    team,
    offence: team.pointsFor / team.inside50sFor / leaguePointsPerInside50,
    midfield: team.inside50sFor / team.inside50sAgainst,
    defence: 2 - team.pointsAgainst / team.inside50sAgainst / leaguePointsPerInside50,
  }));
  const rawTotals = {
    offence: rawTeams.reduce((total, team) => total + team.offence, 0),
    midfield: rawTeams.reduce((total, team) => total + team.midfield, 0),
    defence: rawTeams.reduce((total, team) => total + team.defence, 0),
  };
  if (Object.values(rawTotals).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('League PAV component strength denominators must be positive.');
  }

  const pool = teams.length * 100;
  const players: AflTradeHpnPavCoreResult['players'][number][] = [];
  const teamResults = rawTeams.map(({ team, ...strength }) => {
    const scored = [...team.players]
      .sort((left, right) => compare(left.spellVersionId, right.spellVersionId))
      .map((source) => ({ source, score: scores(source) }));
    const totals = {
      offence: scored.reduce((total, player) => total + player.score.offence, 0),
      midfield: scored.reduce((total, player) => total + player.score.midfield, 0),
      defence: scored.reduce((total, player) => total + player.score.defence, 0),
    };
    if (Object.values(totals).some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new RangeError('Team player-score component denominators must be positive.');
    }
    const componentPav = {
      offence: (pool * strength.offence) / rawTotals.offence,
      midfield: (pool * strength.midfield) / rawTotals.midfield,
      defence: (pool * strength.defence) / rawTotals.defence,
    };
    for (const { source, score } of scored) {
      const offensivePav = normalized(componentPav.offence * (score.offence / totals.offence));
      const midfieldPav = normalized(componentPav.midfield * (score.midfield / totals.midfield));
      const defensivePav = normalized(componentPav.defence * (score.defence / totals.defence));
      const { spellVersionId, playerId, ...sourceValues } = source;
      players.push({
        spellVersionId,
        playerId,
        teamId: team.teamId,
        source: sourceValues,
        offensiveScore: normalized(score.offence),
        midfieldScore: normalized(score.midfield),
        defensiveScore: normalized(score.defence),
        offensivePav,
        midfieldPav,
        defensivePav,
        totalPav: normalized(offensivePav + midfieldPav + defensivePav),
      });
    }
    const { players: _players, ...source } = team;
    const offensivePav = normalized(componentPav.offence);
    const midfieldPav = normalized(componentPav.midfield);
    const defensivePav = normalized(componentPav.defence);
    return {
      teamId: team.teamId,
      source,
      rawStrength: {
        offence: normalized(strength.offence),
        midfield: normalized(strength.midfield),
        defence: normalized(strength.defence),
      },
      offensivePav,
      midfieldPav,
      defensivePav,
      totalPav: normalized(offensivePav + midfieldPav + defensivePav),
    };
  });
  return {
    league: {
      teamCount: teams.length,
      leaguePointsPerInside50: normalized(leaguePointsPerInside50),
      componentPools: { offensivePav: pool, midfieldPav: pool, defensivePav: pool },
      totalPav: pool * 3,
    },
    teams: teamResults,
    players,
  };
}
