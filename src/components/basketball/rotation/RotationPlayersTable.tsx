import Link from 'next/link';
import type { ReactNode } from 'react';

import { LAST_GAME_LABELS, shortDate } from '@/lib/basketball/rotation';
import type { RotationPlayerView } from '@/server/basketball/readModels/rotationModel';

import { InjuryBadge, OwnerLabel, SortHeaderLink } from '../analysis/AnalysisBits';
import { AlertBadge } from './RotationAlerts';
import type { RotationSortKey } from './rotationView';

type SortState = 'ascending' | 'descending' | 'none';

const SORT_LABELS: Record<RotationSortKey, string> = {
  alert: 'alert level',
  name: 'name',
  gp: 'games played',
  gs: 'games started',
  starts: 'starts in the last 5 team games',
  dnp: "coach's-decision DNPs in the last 10 team games",
  mpg: 'minutes per game',
};

function FiveChange({ change }: { change: RotationPlayerView['fiveChange'] }) {
  if (!change) return <span className="text-muted-foreground">–</span>;
  return change.direction === 'INTO' ? (
    <>
      <span aria-hidden="true">▲ </span>Into five {shortDate(change.gameDate)}
    </>
  ) : (
    <>
      <span aria-hidden="true">▼ </span>Out {shortDate(change.gameDate)}
      <span className="block truncate text-muted-foreground">{change.why}</span>
    </>
  );
}

export function RotationPlayersTable({
  players,
  sortHref,
  sortState,
}: {
  players: RotationPlayerView[];
  sortHref: (key: RotationSortKey) => string;
  sortState: (key: RotationSortKey) => SortState;
}) {
  const header = (
    key: RotationSortKey,
    className: string,
    children: ReactNode,
    align: 'left' | 'right' = 'right'
  ) => (
    <SortHeaderLink
      href={sortHref(key)}
      label={SORT_LABELS[key]}
      state={sortState(key)}
      className={className}
      align={align}
    >
      {children}
    </SortHeaderLink>
  );
  const number = 'px-2 text-right tabular-nums text-foreground';

  return (
    <div
      role="region"
      aria-label="Players table"
      className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-card"
    >
      <table className="w-full min-w-[70rem] table-fixed text-sm sm:min-w-[73rem]">
        <caption className="sr-only">
          Each player&rsquo;s role with his current NBA team: games, starts, last game,
          coach&rsquo;s decisions and moves in and out of the starting five.
        </caption>
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-border text-xs text-muted-foreground">
            {header(
              'name',
              'sticky left-0 z-20 w-44 bg-card text-left shadow-[1px_0_0_0_var(--border)] sm:w-56',
              'Player',
              'left'
            )}
            <th scope="col" className="w-24 px-2 py-2 text-left font-semibold">
              Owner
            </th>
            {header('alert', 'w-56', 'Alert', 'left')}
            {header('gp', 'w-14', <abbr title="Games played">GP</abbr>)}
            {header('gs', 'w-14', <abbr title="Games started">GS</abbr>)}
            {header(
              'starts',
              'w-24',
              <abbr title="Starts in the team's last 5 games, and his role">Starts L5</abbr>
            )}
            <th scope="col" className="w-28 px-2 py-2 text-left font-semibold">
              Last game
            </th>
            {header(
              'dnp',
              'w-24',
              <abbr title="Coach's-decision DNPs in the team's last 10 games, and the latest">
                DNP-CD L10
              </abbr>
            )}
            <th scope="col" className="w-36 px-2 py-2 text-left font-semibold">
              <abbr title="Latest move into or out of the starting five, last 10 team games">
                Starting five
              </abbr>
            </th>
            {header('mpg', 'w-16', <abbr title="Minutes per game">MPG</abbr>)}
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const mine = player.owner.kind === 'MINE';
            const rowBg = mine ? 'bg-accent' : 'bg-card';
            return (
              <tr
                key={player.playerId}
                className={`h-14 border-b border-border ${rowBg}`}
                aria-label={mine ? `${player.fullName} (your player)` : undefined}
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 px-2 text-left font-normal shadow-[1px_0_0_0_var(--border)] ${rowBg}`}
                >
                  <span className="block truncate font-semibold text-foreground">
                    {player.fullName}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">
                      {player.teamCode} · {player.positions.join('/') || '–'}
                    </span>
                    <InjuryBadge injury={player.injury} />
                  </span>
                </th>
                <td className="px-2">
                  <span className="flex min-w-0">
                    <OwnerLabel owner={player.owner} />
                  </span>
                </td>
                <td className="px-2 text-xs text-foreground">
                  {player.alert ? (
                    <>
                      <AlertBadge level={player.alert.level} />
                      <span className="block truncate" title={player.alert.text}>
                        {player.alert.text}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={number}>{player.gamesPlayed}</td>
                <td className={number}>{player.gamesStarted}</td>
                <td className={number}>
                  <span className="block">
                    {player.startsLast5}/{player.teamGamesLast5}
                  </span>
                  <span className="block text-xs text-muted-foreground">{player.role}</span>
                </td>
                <td className="px-2 text-foreground">{LAST_GAME_LABELS[player.lastGame]}</td>
                <td className={number}>
                  <span className="block">{player.coachDnpsLast10}</span>
                  {player.lastCoachDnpOn ? (
                    <span className="block text-xs text-muted-foreground">
                      <span className="sr-only">latest </span>
                      {shortDate(player.lastCoachDnpOn)}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 text-xs text-foreground">
                  <FiveChange change={player.fiveChange} />
                </td>
                <td className={number}>{player.minutesPerGame.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RotationTableFooter({
  shown,
  total,
  moreHref,
}: {
  shown: number;
  total: number;
  moreHref: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p>
        Showing {shown} of {total} players. A traded player counts games for his current team only.
      </p>
      {moreHref ? (
        <Link
          href={moreHref}
          scroll={false}
          className="inline-flex min-h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show 100 more
        </Link>
      ) : null}
    </div>
  );
}
