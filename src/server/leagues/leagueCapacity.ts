export const MIN_LEAGUE_TEAMS = 4;
export const MAX_LEAGUE_TEAMS = 18;

export function isValidLeagueMaxTeams(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_LEAGUE_TEAMS && value <= MAX_LEAGUE_TEAMS;
}

export function isLeagueAtCapacity(input: {
  activeMemberCount: number;
  maxTeams: number;
}): boolean {
  return Math.max(0, input.activeMemberCount) >= input.maxTeams;
}

export function getMaxTeamsUpdateError(input: {
  nextMaxTeams: number | undefined;
  activeMemberCount: number;
}): string | null {
  if (input.nextMaxTeams === undefined) return null;

  if (!isValidLeagueMaxTeams(input.nextMaxTeams)) {
    return `Max teams must be between ${MIN_LEAGUE_TEAMS} and ${MAX_LEAGUE_TEAMS}`;
  }

  if (input.nextMaxTeams < input.activeMemberCount) {
    return 'Max teams cannot be less than the current team count';
  }

  return null;
}
