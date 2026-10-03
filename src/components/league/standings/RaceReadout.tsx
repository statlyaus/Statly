import { describeResult, formatRecord, type StandingsData, type StandingsTeam } from './standingsFormat';
import { describeChance, describeFinish, ordinal, winsLabel, winsOf } from './raceFormat';

/** One line about the selected team: record, finals chance, likely finish, gap and next game. */
export function RaceReadout({
  team,
  data,
  cutoffWins,
  teamsById,
}: {
  team: StandingsTeam;
  data: StandingsData;
  cutoffWins: number | null;
  teamsById: ReadonlyMap<string, StandingsTeam>;
}): React.JSX.Element {
  const wins = winsOf(team);
  const inFinals = data.finalsTeams > 0 && team.rank <= data.finalsTeams;
  const standing =
    data.finalsTeams === 0 || cutoffWins === null
      ? null
      : inFinals
        ? 'in the finals places'
        : cutoffWins - wins > 0
          ? `${winsLabel(cutoffWins - wins)} behind ${ordinal(data.finalsTeams)}`
          : `level with ${ordinal(data.finalsTeams)} on wins`;
  const chance = describeChance(team.finals);
  const finish = describeFinish(team.finals);

  const upcoming = team.upcoming;
  const opponent = upcoming?.opponentId ? teamsById.get(upcoming.opponentId) : null;
  const liveResult =
    upcoming?.status === 'LIVE'
      ? team.results.find((result) => result.round === upcoming.round)
      : undefined;
  const nextGame = liveResult
    ? `round ${upcoming!.round}: ${describeResult(liveResult, opponent?.teamName ?? null)}`
    : upcoming && opponent
      ? `next v ${opponent.teamName}`
      : null;

  return (
    <>
      <span className="font-semibold">
        {team.rank}. {team.teamName}
        {team.memberId === data.viewerMemberId ? ' (you)' : ''}
      </span>
      {' · '}
      {formatRecord(team.wins, team.losses, team.draws)}
      {chance ? (
        <>
          {' · '}
          <span className="font-semibold">{chance}</span>
        </>
      ) : null}
      {finish ? ` · ${finish}` : ''}
      {standing ? ` · ${standing}` : ''}
      {nextGame ? ` · ${nextGame}` : ''}
    </>
  );
}
