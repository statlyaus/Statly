import type { CSSProperties } from 'react';

import { badgeStyles } from '@/components/ui/controlStyles';
import type { MatchupPlayerRow } from '@/server/basketball/readModels/matchupModel';
import { getBasketballCategory, type BasketballCategoryId } from '@/types/basketball';

import { InjuryBadge } from '../analysis/AnalysisBits';
import { formatCategory, formatGameDate } from '../analysis/format';

/**
 * One side's roster for the week: games his NBA team has left, the starts the simulator gives him,
 * the days he already counted, and his projected rest-of-week line per category.
 */
export function MatchupRosterTable({
  title,
  players,
  categories,
  weekStart,
}: {
  title: string;
  players: MatchupPlayerRow[];
  categories: BasketballCategoryId[];
  weekStart: string;
}) {
  const style = { '--roster-min': `${11 + 3 * 4 + categories.length * 4.5}rem` } as CSSProperties;
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">
          Left: NBA games left · Starts: simulated starts left · Done: days counted · categories:
          projected rest of week
        </p>
      </div>
      {players.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          No players on this roster yet.
        </p>
      ) : (
        <div
          role="region"
          aria-label={`${title} table`}
          className="relative overflow-x-auto rounded-lg border border-border bg-card"
        >
          <table className="w-full min-w-[var(--roster-min)] table-fixed text-sm" style={style}>
            <caption className="sr-only">
              {title}: games left, simulated starts, starts so far and projected rest-of-week
              categories.
            </caption>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-44 bg-card px-3 py-2 text-left font-semibold shadow-[1px_0_0_0_var(--border)] sm:w-52"
                >
                  Player
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  <abbr title="NBA team games left this week">Left</abbr>
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  <abbr title="Games the lineup simulator starts him for the rest of the week">
                    Starts
                  </abbr>
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  <abbr title="Days already counted this week">Done</abbr>
                </th>
                {categories.map((categoryId) => (
                  <th
                    key={categoryId}
                    scope="col"
                    className="w-[4.5rem] px-2 py-2 text-right font-semibold"
                  >
                    {getBasketballCategory(categoryId).shortLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const rowBg = 'bg-card';
                const benched =
                  player.countedLeft === 0 &&
                  player.teamGamesLeft > 0 &&
                  !player.onInjuredList &&
                  player.injury?.status !== 'OUT';
                return (
                  <tr
                    key={player.playerId}
                    className={`h-14 border-b border-border last:border-b-0 ${rowBg}`}
                  >
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 px-3 text-left font-normal shadow-[1px_0_0_0_var(--border)] ${rowBg}`}
                    >
                      <span className="block truncate font-semibold text-foreground">
                        {player.fullName}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">
                          {player.teamCode ?? 'No team'} · {player.positions.join('/') || '–'}
                          {player.acquiredOn > weekStart
                            ? ` · from ${formatGameDate(player.acquiredOn)}`
                            : ''}
                        </span>
                        {player.onInjuredList ? (
                          <span className={badgeStyles({ tone: 'muted', size: 'xs' })}>IL</span>
                        ) : null}
                        <InjuryBadge injury={player.injury} />
                      </span>
                    </th>
                    <td className="px-2 text-right tabular-nums text-foreground">
                      {player.teamGamesLeft}
                    </td>
                    <td className="px-2 text-right tabular-nums">
                      <span
                        className={`font-semibold ${benched ? 'text-muted-foreground' : 'text-foreground'}`}
                      >
                        {player.countedLeft}
                      </span>
                      {benched ? (
                        <span className="block text-[0.6875rem] text-muted-foreground">
                          benched
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 text-right tabular-nums text-foreground">
                      {player.countedSoFar}
                    </td>
                    {categories.map((categoryId) => (
                      <td key={categoryId} className="px-2 text-right tabular-nums text-foreground">
                        {player.countedLeft > 0
                          ? formatCategory(categoryId, player.restOfWeek)
                          : '–'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
