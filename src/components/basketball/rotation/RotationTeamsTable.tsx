import Link from 'next/link';

import { shortDate } from '@/lib/basketball/rotation';
import type { RotationTeamView } from '@/server/basketball/readModels/rotationModel';

/** Most lineup churn first: unique starting fives over the last 10, then changes. */
export function sortTeamsByChurn(teams: readonly RotationTeamView[]): RotationTeamView[] {
  return [...teams].sort(
    (a, b) =>
      b.uniqueFivesLast10 - a.uniqueFivesLast10 ||
      b.fiveChanges - a.fiveChanges ||
      a.teamCode.localeCompare(b.teamCode)
  );
}

function LastChange({ change }: { change: RotationTeamView['lastChange'] }) {
  if (!change) return <span className="text-muted-foreground">Same five all season</span>;
  const into = change.into.map((player) => player.name).join(', ');
  const out = change.out.map((player) => `${player.name} (${player.why})`).join(', ');
  return (
    <>
      <span className="block truncate" title={`In: ${into}`}>
        <span className="text-muted-foreground">{shortDate(change.gameDate)}</span>{' '}
        <span aria-hidden="true">▲</span>
        <span className="sr-only">In:</span> {into || '–'}
      </span>
      <span className="block truncate text-muted-foreground" title={`Out: ${out}`}>
        <span aria-hidden="true">▼</span>
        <span className="sr-only">Out:</span> {out || '–'}
      </span>
    </>
  );
}

export function RotationTeamsTable({
  teams,
  teamHref,
}: {
  teams: RotationTeamView[];
  /** Filters the player table to one team. */
  teamHref: (teamCode: string) => string;
}) {
  const number = 'px-2 text-right tabular-nums text-foreground';
  return (
    <div
      role="region"
      aria-label="NBA teams table"
      className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-card"
    >
      <table className="w-full min-w-[54rem] table-fixed text-sm">
        <caption className="sr-only">
          Starting-five churn per NBA team this season, most unique starting fives over the last 10
          games first.
        </caption>
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 z-20 w-16 bg-card px-2 py-2 text-left font-semibold shadow-[1px_0_0_0_var(--border)]"
            >
              Team
            </th>
            <th scope="col" className="w-12 px-2 py-2 text-right font-semibold">
              <abbr title="Games played">GP</abbr>
            </th>
            <th scope="col" className="w-[4.5rem] px-2 py-2 text-right font-semibold">
              Fives
            </th>
            <th
              scope="col"
              aria-sort="descending"
              className="w-24 whitespace-nowrap px-2 py-2 text-right font-semibold text-foreground"
            >
              <abbr title="Unique starting fives in the last 10 games">Fives L10</abbr>
              <span aria-hidden="true"> ▼</span>
            </th>
            <th scope="col" className="w-[4.5rem] px-2 py-2 text-right font-semibold">
              <abbr title="Games whose starters differed from the game before">Changes</abbr>
            </th>
            <th scope="col" className="w-24 px-2 py-2 text-right font-semibold">
              <abbr title="Coach's-decision DNPs per game, last 10 games">Coach DNPs</abbr>
            </th>
            <th scope="col" className="w-24 px-2 py-2 text-right font-semibold">
              <abbr title="Players with 10 or more minutes per game, last 10 games">10+ min</abbr>
            </th>
            <th scope="col" className="px-2 py-2 text-left font-semibold">
              Last change to the starting five
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team.teamCode} className="h-14 border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-2 text-left font-normal shadow-[1px_0_0_0_var(--border)]"
              >
                <Link
                  href={teamHref(team.teamCode)}
                  scroll={false}
                  className="inline-flex min-h-8 items-center rounded-sm font-display text-base font-bold text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {team.teamCode}
                  <span className="sr-only">: show its players</span>
                </Link>
              </th>
              <td className={number}>{team.gamesPlayed}</td>
              <td className={number}>{team.uniqueFives}</td>
              <td className={`${number} font-display text-base font-bold`}>
                {team.uniqueFivesLast10}
              </td>
              <td className={number}>{team.fiveChanges}</td>
              <td className={number}>{team.coachDnpsPerGameLast10.toFixed(1)}</td>
              <td className={number}>{team.tenMinutePlayersPerGameLast10.toFixed(1)}</td>
              <td className="min-w-0 px-2 text-xs text-foreground">
                <LastChange change={team.lastChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
