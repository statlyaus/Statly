import type { StandingsTeam } from './standingsFormat';

/** Wins with draws as half a win, the currency of the ladder. */
export function winsOf(team: Pick<StandingsTeam, 'wins' | 'draws'>): number {
  return team.wins + team.draws / 2;
}

/** Wins after a given round, from the team's completed results. */
export function winsAfter(team: StandingsTeam, round: number): number {
  return team.results.reduce((total, result) => {
    if (result.phase !== 'REGULAR' || result.round > round || !result.result) return total;
    return total + (result.result === 'W' ? 1 : result.result === 'D' ? 0.5 : 0);
  }, 0);
}

export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}

export function formatWins(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function winsLabel(value: number): string {
  return `${formatWins(value)} ${value === 1 ? 'win' : 'wins'}`;
}

/** "64%", with ">99%" and "<1%" kept for chances that are close but not certain. */
export function formatChance(finals: StandingsTeam['finals']): string {
  if (!finals) return '–';
  if (finals.status === 'CLINCHED') return 'In';
  if (finals.status === 'OUT') return 'Out';
  if (finals.chance >= 0.995) return '>99%';
  if (finals.chance < 0.005) return '<1%';
  return `${Math.round(finals.chance * 100)}%`;
}

export function describeChance(finals: StandingsTeam['finals']): string | null {
  if (!finals) return null;
  if (finals.status === 'CLINCHED') return 'finals place clinched';
  if (finals.status === 'OUT') return 'out of the finals race';
  return `${formatChance(finals)} chance of finals`;
}

export function describeFinish(finals: StandingsTeam['finals']): string | null {
  if (!finals || finals.gamesLeft === 0) return null;
  return finals.finishHigh === finals.finishLow
    ? `likely ${ordinal(finals.finishHigh)}`
    : `likely ${ordinal(finals.finishHigh)}–${ordinal(finals.finishLow)}`;
}
