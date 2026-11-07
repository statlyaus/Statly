import type { CategoryCall, CategoryComparison } from '@/lib/basketball/matchup';
import type { NeedComparison } from '@/lib/basketball/addDrop';
import type { PoolPlayer } from '@/server/basketball/readModels/playerPool';
import { badgeStyles } from '@/components/ui/controlStyles';
import { getBasketballCategory } from '@/types/basketball';

import { CallChip, InjuryBadge } from '../analysis/AnalysisBits';
import { formatSigned } from '../analysis/format';
import { MarkTakenButton } from './MarkTakenButton';

const CALL_LETTER: Record<CategoryCall, string> = { WIN: 'W', LOSS: 'L', TOSS_UP: 'T' };
const CALL_RANK: Record<CategoryCall, number> = { LOSS: 0, TOSS_UP: 1, WIN: 2 };

function needLabel(weight: number): string {
  if (weight >= 1) return 'close';
  return weight >= 0.4 ? 'behind' : 'safe';
}

/** Where I stand now against this week's opponent, per category, with how much each one needs help. */
export function PickupsNow({
  opponentName,
  categories,
  categoriesWon,
}: {
  opponentName: string;
  categories: NeedComparison[];
  categoriesWon: number;
}) {
  return (
    <section aria-label="This week now" className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-foreground">
        Without a move you win{' '}
        <span className="font-display text-xl font-bold tabular-nums">{categoriesWon}</span> of{' '}
        {categories.length} categories against {opponentName} (a toss-up counts ½).
      </p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Categories now">
        {categories.map((category) => (
          <li
            key={category.category}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
          >
            <CallChip call={category.call} className="size-5" />
            <span className="font-semibold text-foreground">
              {getBasketballCategory(category.category).shortLabel}
            </span>
            <span className="text-muted-foreground">{needLabel(category.needWeight)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface PickupRow {
  player: PoolPlayer;
  gamesLeft: number;
  plan: {
    gamesAdded: number;
    categoriesWon: number;
    categoryChange: number;
    fit: number;
    categories: CategoryComparison[];
  } | null;
}

function Moves({ before, after }: { before: CategoryComparison[]; after: CategoryComparison[] }) {
  const moves = after.flatMap((category) => {
    const previous = before.find((candidate) => candidate.category === category.category);
    if (!previous || previous.call === category.call) return [];
    return [{ category: category.category, from: previous.call, to: category.call }];
  });
  if (moves.length === 0) return <span className="text-xs text-muted-foreground">No change</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {moves.map((move) => {
        const better = CALL_RANK[move.to] > CALL_RANK[move.from];
        return (
          <span
            key={move.category}
            className={badgeStyles({ tone: better ? 'win' : 'loss', size: 'xs' })}
          >
            {getBasketballCategory(move.category).shortLabel} {CALL_LETTER[move.from]}→
            {CALL_LETTER[move.to]}
            <span className="sr-only">{better ? ' (better)' : ' (worse)'}</span>
          </span>
        );
      })}
    </span>
  );
}

export function PickupsTable({
  rows,
  now,
  leagueId,
  userId,
}: {
  rows: PickupRow[];
  /** The current calls; null when there is no opponent and rows have no plan. */
  now: CategoryComparison[] | null;
  leagueId: string;
  userId: string;
}) {
  const planned = now !== null;
  return (
    <div
      role="region"
      aria-label="Free agents table"
      className="relative max-h-[75vh] overflow-auto rounded-lg border border-border bg-card"
    >
      <table
        className={`w-full table-fixed text-sm ${planned ? 'min-w-[62rem]' : 'min-w-[38rem]'}`}
      >
        <caption className="sr-only">
          {planned
            ? 'Free agents ranked by the change in categories won this week, then by fit to your needs.'
            : 'Free agents by season value.'}
        </caption>
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 z-20 w-10 bg-card px-2 py-2 text-right font-semibold"
            >
              #
            </th>
            <th
              scope="col"
              className="sticky left-10 z-20 w-44 bg-card px-2 py-2 text-left font-semibold shadow-[1px_0_0_0_var(--border)] sm:w-52"
            >
              Player
            </th>
            {planned ? (
              <>
                <th
                  scope="col"
                  aria-sort="descending"
                  className="w-20 px-2 py-2 text-right font-semibold"
                >
                  Change
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  <abbr title="Games he would start from the day the add takes effect">Starts</abbr>
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  <abbr title="Categories won after the swap (a toss-up counts ½)">Cats</abbr>
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  <abbr title="Need-weighted change across categories">Fit</abbr>
                </th>
              </>
            ) : (
              <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                <abbr title="NBA games left this fantasy week">Wk</abbr>
              </th>
            )}
            <th
              scope="col"
              aria-sort={planned ? 'none' : 'descending'}
              className="w-16 px-2 py-2 text-right font-semibold"
            >
              Value
            </th>
            <th scope="col" className="w-14 px-2 py-2 text-right font-semibold">
              MPG
            </th>
            {planned ? (
              <th scope="col" className="w-56 px-2 py-2 text-left font-semibold">
                Moves
              </th>
            ) : null}
            <th scope="col" className="w-32 px-2 py-2 text-right font-semibold">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.player.playerId} className="h-14 border-b border-border">
              <td className="sticky left-0 z-10 bg-card px-2 text-right font-display text-base font-bold tabular-nums text-foreground">
                {index + 1}
              </td>
              <th
                scope="row"
                className="sticky left-10 z-10 bg-card px-2 text-left font-normal shadow-[1px_0_0_0_var(--border)]"
              >
                <span className="block truncate font-semibold text-foreground">
                  {row.player.fullName}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">
                    {row.player.teamCode ?? 'No team'} · {row.player.positions.join('/') || '–'}
                  </span>
                  <InjuryBadge injury={row.player.injury} />
                </span>
              </th>
              {row.plan && now ? (
                <>
                  <td
                    className={`px-2 text-right font-display text-base font-bold tabular-nums ${
                      row.plan.categoryChange > 0
                        ? 'text-result-win'
                        : row.plan.categoryChange < 0
                          ? 'text-result-loss'
                          : 'text-foreground'
                    }`}
                  >
                    {formatSigned(row.plan.categoryChange)}
                  </td>
                  <td className="px-2 text-right tabular-nums text-foreground">
                    {row.plan.gamesAdded}
                  </td>
                  <td className="px-2 text-right tabular-nums text-foreground">
                    {row.plan.categoriesWon}
                  </td>
                  <td className="px-2 text-right tabular-nums text-foreground">
                    {formatSigned(row.plan.fit)}
                  </td>
                </>
              ) : (
                <td className="px-2 text-right tabular-nums text-foreground">{row.gamesLeft}</td>
              )}
              <td className="px-2 text-right tabular-nums text-foreground">
                {formatSigned(row.player.value)}
              </td>
              <td className="px-2 text-right tabular-nums text-foreground">
                {row.player.minutesPerGame.toFixed(1)}
              </td>
              {row.plan && now ? (
                <td className="px-2">
                  <Moves before={now} after={row.plan.categories} />
                </td>
              ) : null}
              <td className="px-2 text-right">
                <MarkTakenButton
                  leagueId={leagueId}
                  userId={userId}
                  playerId={row.player.playerId}
                  playerName={row.player.fullName}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
