import Link from 'next/link';
import type { CSSProperties } from 'react';

import type { PoolPlayer } from '@/server/basketball/readModels/playerPool';
import { getBasketballCategory, type BasketballCategoryId } from '@/types/basketball';

import { InjuryBadge, OwnerLabel, SortHeaderLink, zHeatClass } from '../analysis/AnalysisBits';
import { formatPct, formatSigned } from '../analysis/format';
import type { PlayerSortKey } from './playersView';

type SortState = 'ascending' | 'descending' | 'none';

const SORT_LABELS: Record<string, string> = {
  value: 'total value',
  name: 'name',
  gp: 'games played this season',
  mpg: 'minutes per game',
  auction: 'auction dollars',
  gamesLeft: 'games left this week',
};

/** Per-game number for a category: .489 with attempts, or a count to one decimal. */
function CategoryStat({
  player,
  categoryId,
}: {
  player: PoolPlayer;
  categoryId: BasketballCategoryId;
}) {
  const category = getBasketballCategory(categoryId);
  if (category.kind === 'COUNT') {
    return <>{player.perGame[category.stat].toFixed(1)}</>;
  }
  const attempts = player.perGame[category.attempted];
  return (
    <>
      {attempts > 0 ? formatPct(player.perGame[category.made] / attempts) : '–'}
      <span className="ml-1 text-[0.6875rem] text-muted-foreground">{attempts.toFixed(1)}</span>
    </>
  );
}

export function PlayersTable({
  players,
  categories,
  punts,
  showAuction,
  gamesLeft,
  sortHref,
  sortState,
}: {
  players: PoolPlayer[];
  categories: BasketballCategoryId[];
  punts: BasketballCategoryId[];
  showAuction: boolean;
  gamesLeft: Record<string, number>;
  sortHref: (key: PlayerSortKey) => string;
  sortState: (key: PlayerSortKey) => SortState;
}) {
  // Rank 3rem + player 11rem (14rem from sm) + owner 7rem + value 4.5rem + $ 3.5rem + games 3.5rem
  // + GP/MPG 7.5rem + categories 5.5rem each. Value leads so it is on screen without scrolling.
  const fixed = 3 + 7 + 7.5 + 4.5 + 3.5 + (showAuction ? 3.5 : 0) + categories.length * 5.5;
  const widthStyle = {
    '--players-min': `${fixed + 11}rem`,
    '--players-min-sm': `${fixed + 14}rem`,
  } as CSSProperties;
  const header = (
    key: PlayerSortKey,
    label: string,
    className: string,
    children: React.ReactNode,
    align: 'left' | 'right' = 'right'
  ) => (
    <SortHeaderLink
      key={key}
      href={sortHref(key)}
      label={label}
      state={sortState(key)}
      className={className}
      align={align}
    >
      {children}
    </SortHeaderLink>
  );

  return (
    <div
      role="region"
      aria-label="Players table"
      className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-card"
    >
      <table
        className="w-full min-w-[var(--players-min)] table-fixed text-sm sm:min-w-[var(--players-min-sm)]"
        style={widthStyle}
      >
        <caption className="sr-only">
          NBA players valued for this league. Each category shows the per-game number and its
          z-score against the player pool.
        </caption>
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 z-20 w-12 bg-card px-2 py-2 text-right font-semibold"
            >
              #
            </th>
            {header(
              'name',
              SORT_LABELS.name,
              'sticky left-12 z-20 w-44 bg-card text-left shadow-[1px_0_0_0_var(--border)] sm:w-56',
              'Player',
              'left'
            )}
            <th scope="col" className="w-28 px-2 py-2 text-left font-semibold">
              Owner
            </th>
            {header('value', SORT_LABELS.value, 'w-[4.5rem]', 'Value')}
            {showAuction ? header('auction', SORT_LABELS.auction, 'w-14', '$') : null}
            {header(
              'gamesLeft',
              SORT_LABELS.gamesLeft,
              'w-14',
              <abbr title="NBA games left this fantasy week">Wk</abbr>
            )}
            {header(
              'gp',
              SORT_LABELS.gp,
              'w-14',
              <abbr title="Games played this season, and last season below">GP</abbr>
            )}
            {header('mpg', SORT_LABELS.mpg, 'w-16', <abbr title="Minutes per game">MPG</abbr>)}
            {categories.map((categoryId) => {
              const category = getBasketballCategory(categoryId);
              const punted = punts.includes(categoryId);
              return header(
                categoryId,
                `${category.label.toLowerCase()} value`,
                'w-[5.5rem]',
                <span className={punted ? 'line-through' : ''} title={category.label}>
                  {category.shortLabel}
                  {punted ? <span className="sr-only"> (punted)</span> : null}
                </span>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const mine = player.owner.kind === 'MINE';
            const rowBg = mine ? 'bg-accent' : 'bg-card';
            return (
              <tr
                key={player.playerId}
                className="h-14 border-b border-border"
                aria-label={mine ? `${player.fullName} (your player)` : undefined}
              >
                <td
                  className={`sticky left-0 z-10 px-2 text-right font-display text-base font-bold tabular-nums text-foreground ${rowBg}`}
                >
                  {player.rank}
                </td>
                <th
                  scope="row"
                  className={`sticky left-12 z-10 px-2 text-left font-normal shadow-[1px_0_0_0_var(--border)] ${rowBg}`}
                >
                  <span className="block truncate font-semibold text-foreground">
                    {player.fullName}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">
                      {player.teamCode ?? 'No team'} · {player.positions.join('/') || '–'}
                    </span>
                    <InjuryBadge injury={player.injury} />
                  </span>
                </th>
                <td className={`px-2 ${rowBg}`}>
                  <span className="flex min-w-0">
                    <OwnerLabel owner={player.owner} />
                  </span>
                </td>
                <td
                  className={`px-2 text-right font-display text-base font-bold tabular-nums text-foreground ${rowBg}`}
                >
                  {formatSigned(player.value)}
                </td>
                {showAuction ? (
                  <td className={`px-2 text-right tabular-nums text-foreground ${rowBg}`}>
                    ${player.auctionDollars}
                  </td>
                ) : null}
                <td className={`px-2 text-right tabular-nums text-foreground ${rowBg}`}>
                  {gamesLeft[player.playerId] ?? 0}
                </td>
                <td className={`px-2 text-right tabular-nums text-foreground ${rowBg}`}>
                  <span className="block">{player.gamesThisSeason}</span>
                  <span className="block text-xs text-muted-foreground">
                    {player.gamesLastSeason}
                    <span className="sr-only"> games</span> last
                  </span>
                </td>
                <td className={`px-2 text-right tabular-nums text-foreground ${rowBg}`}>
                  {player.minutesPerGame.toFixed(1)}
                </td>
                {categories.map((categoryId) => {
                  const z = player.categoryZ[categoryId];
                  const punted = punts.includes(categoryId);
                  return (
                    <td
                      key={categoryId}
                      className={`px-2 text-right tabular-nums ${punted ? 'text-muted-foreground' : `text-foreground ${zHeatClass(z)}`}`}
                    >
                      <span className="block whitespace-nowrap">
                        <CategoryStat player={player} categoryId={categoryId} />
                      </span>
                      <span className="block text-xs">{formatSigned(z)}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PlayersTableFooter({
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
        Showing {shown} of {total} players. Each category shows the per-game number (percentages
        with attempts) above its z-score; shading follows the z-score, green above the pool and red
        below. Struck-through categories are punted.
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
