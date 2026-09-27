import Link from 'next/link';
import { Fragment } from 'react';

import { TeamMark } from '@/components/scores/MatchupScore';

import { FinalsChance, FinalsDivider, FormChips, Movement } from './StandingsBits';
import { formatRecord, type StandingsData } from './standingsFormat';

/**
 * The ladder at a glance, for the league Overview: the same rank, movement, form, finals chance
 * and finals line as the Standings ladder, sized to fit a card without scrolling.
 */
export function StandingsLadderCompact({
  data,
  leagueId,
}: {
  data: StandingsData;
  leagueId: string;
}): React.JSX.Element {
  const hasOdds = data.teams.some((team) => team.finals !== null);
  // Last 5 is hidden on phones, so the finals line spans one column fewer there.
  const columnCount = hasOdds ? 5 : 4;
  return (
    <div>
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">League ladder</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="w-[3.75rem] py-2 pl-3 text-left font-semibold sm:w-[4.5rem] sm:pl-4">
              #
            </th>
            <th scope="col" className="py-2 text-left font-semibold">
              Team
            </th>
            <th scope="col" className="w-12 px-1 py-2 text-right font-semibold sm:w-16 sm:px-2">
              <abbr title="Wins, losses, draws" className="no-underline">
                W–L–D
              </abbr>
            </th>
            <th scope="col" className="hidden w-36 px-3 py-2 text-left font-semibold sm:table-cell">
              Last 5
            </th>
            {hasOdds ? (
              <th scope="col" className="w-[4.5rem] py-2 pl-2 pr-3 text-right font-semibold sm:w-24 sm:pr-4">
                Finals
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.teams.map((team) => {
            const isYou = team.memberId === data.viewerMemberId;
            return (
              <Fragment key={team.memberId}>
                <tr
                  aria-label={`${team.rank}. ${team.teamName}${isYou ? ' (your team)' : ''}`}
                  className={`h-12 border-b border-border ${isYou ? 'bg-accent' : ''}`}
                >
                  <td className="pl-3 sm:pl-4">
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 text-right font-display text-base font-bold tabular-nums text-foreground">
                        {team.rank}
                      </span>
                      <Movement value={team.movement} />
                    </span>
                  </td>
                  <th scope="row" className="min-w-0 py-1.5 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                      <TeamMark teamName={team.teamName} logoUrl={team.teamLogoUrl} size="sm" />
                      <Link
                        href={`/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(team.memberId)}`}
                        className="min-w-0 truncate font-semibold text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                      >
                        {team.teamName}
                      </Link>
                      {isYou ? (
                        <span className="shrink-0 rounded-sm bg-brand-bar px-1 text-[0.6875rem] font-bold leading-4 text-brand-bar-foreground">
                          YOU
                        </span>
                      ) : null}
                    </span>
                  </th>
                  <td className="whitespace-nowrap px-1 text-right font-semibold tabular-nums text-foreground sm:px-2">
                    {formatRecord(team.wins, team.losses, team.draws)}
                  </td>
                  <td className="hidden px-3 sm:table-cell">
                    <FormChips form={team.form} />
                  </td>
                  {hasOdds ? (
                    <td className="pl-2 pr-3 sm:pr-4">
                      <FinalsChance finals={team.finals} />
                    </td>
                  ) : null}
                </tr>
                {data.finalsTeams > 0 &&
                team.rank === data.finalsTeams &&
                team.rank < data.teams.length ? (
                  <>
                    <tr aria-hidden="true" className="border-b border-border sm:hidden">
                      <td colSpan={columnCount - 1} className="p-0">
                        <FinalsDivider className="h-8 px-3" />
                      </td>
                    </tr>
                    <tr aria-hidden="true" className="hidden border-b border-border sm:table-row">
                      <td colSpan={columnCount} className="p-0">
                        <FinalsDivider className="h-8 px-4" />
                      </td>
                    </tr>
                  </>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {hasOdds ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Top {data.finalsTeams} make finals. Finals chances simulate the remaining games 5,000
          times.
        </p>
      ) : null}
    </div>
  );
}
