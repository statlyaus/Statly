import Link from 'next/link';

import type { MatchupProjection } from '@/lib/basketball/matchup';
import type { WeekSchedule } from '@/server/basketball/readModels/weekSchedule';
import { getBasketballCategory, type BasketballScoringFormat } from '@/types/basketball';

import { CallChip } from '../analysis/AnalysisBits';
import { formatCategory, formatChance, formatDateRange, formatMargin } from '../analysis/format';

const navLink =
  'inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function weekStatus(schedule: WeekSchedule): string {
  const played = schedule.playedDates.length;
  if (played === 0) return 'Upcoming';
  if (played === schedule.dates.length) return 'Final';
  return `In progress: ${played} of ${schedule.dates.length} days played`;
}

export function WeekNav({
  week,
  lastWeek,
  currentWeek,
  schedule,
  hrefFor,
}: {
  week: number;
  lastWeek: number;
  currentWeek: number;
  schedule: WeekSchedule;
  hrefFor: (week: number) => string;
}) {
  return (
    <nav aria-label="Fantasy week" className="flex flex-wrap items-center gap-2">
      {week > 1 ? (
        <Link href={hrefFor(week - 1)} className={navLink}>
          <span aria-hidden="true">‹</span> <span className="sr-only">Previous: </span>Week{' '}
          {week - 1}
        </Link>
      ) : null}
      <p className="px-1 text-sm">
        <span className="font-display text-lg font-bold text-foreground">Week {week}</span>{' '}
        <span className="text-muted-foreground">
          · {formatDateRange(schedule.start, schedule.end)} · {weekStatus(schedule)}
        </span>
      </p>
      {week < lastWeek ? (
        <Link href={hrefFor(week + 1)} className={navLink}>
          <span className="sr-only">Next: </span>Week {week + 1} <span aria-hidden="true">›</span>
        </Link>
      ) : null}
      {week !== currentWeek ? (
        <Link href={hrefFor(currentWeek)} className={`${navLink} border-transparent underline`}>
          This week
        </Link>
      ) : null}
    </nav>
  );
}

export function MatchupScoreboard({
  myTeamName,
  opponentName,
  projection,
  format,
}: {
  myTeamName: string;
  opponentName: string;
  projection: MatchupProjection;
  format: BasketballScoringFormat;
}) {
  const { calls, outcome } = projection;
  const total = projection.categories.length;
  return (
    <section aria-label="Projected result" className="rounded-lg border border-border bg-card p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <p className="truncate font-display text-lg font-bold text-foreground">{myTeamName}</p>
        <p className="text-center">
          <span className="block font-display text-3xl font-bold tabular-nums text-foreground">
            {calls.wins}–{calls.losses}–{calls.tossUps}
          </span>
          <span className="block text-xs text-muted-foreground">projected W–L–T</span>
        </p>
        <p className="truncate text-right font-display text-lg font-bold text-foreground">
          {opponentName}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-4">
        {outcome ? (
          <>
            <Stat label="Win the week" value={formatChance(outcome.win)} strong />
            {outcome.tie > 0.0005 ? <Stat label="Tie" value={formatChance(outcome.tie)} /> : null}
            <Stat label="Lose the week" value={formatChance(outcome.loss)} />
          </>
        ) : (
          <Stat
            label="Expected record"
            value={`${projection.expectedCategoriesWon.toFixed(1)}–${projection.expectedCategoriesLost.toFixed(1)}`}
            strong
          />
        )}
        <Stat
          label="Expected categories"
          value={`${projection.expectedCategoriesWon.toFixed(1)} of ${total}`}
        />
      </dl>
      {format === 'H2H_EACH_CATEGORY' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Each category counts in the standings, so the expected record is what matters.
        </p>
      ) : null}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`tabular-nums text-foreground ${strong ? 'font-display text-2xl font-bold' : 'text-lg font-semibold'}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function MatchupCategoryTable({
  projection,
  punts,
}: {
  projection: MatchupProjection;
  punts: readonly string[];
}) {
  return (
    <div
      role="region"
      aria-label="Categories this week"
      className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full min-w-[34rem] table-fixed text-sm">
        <caption className="sr-only">
          Each category: your projected week, your opponent&rsquo;s, the margin, the call and your
          chance of winning it.
        </caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 z-10 w-24 bg-card px-3 py-2 text-left font-semibold"
            >
              Category
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              You
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              Opponent
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              Margin
            </th>
            <th scope="col" className="w-14 px-2 py-2 text-center font-semibold">
              Call
            </th>
            <th scope="col" className="w-36 px-3 py-2 text-left font-semibold">
              Win chance
            </th>
          </tr>
        </thead>
        <tbody>
          {projection.categories.map((row) => {
            const category = getBasketballCategory(row.category);
            const punted = punts.includes(row.category);
            return (
              <tr key={row.category} className="h-14 border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-3 text-left font-semibold text-foreground"
                >
                  <abbr title={category.label} className="no-underline">
                    {category.shortLabel}
                  </abbr>
                  {punted ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">punt</span>
                  ) : null}
                </th>
                <ValueCell
                  total={formatCategory(row.category, projection.me.total)}
                  soFar={formatCategory(row.category, projection.me.actual)}
                />
                <ValueCell
                  total={formatCategory(row.category, projection.opponent.total)}
                  soFar={formatCategory(row.category, projection.opponent.actual)}
                />
                <td className="px-2 text-right tabular-nums text-foreground">
                  {formatMargin(row.category, row.margin)}
                </td>
                <td className="px-2 text-center">
                  <CallChip call={row.call} />
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className="block h-full rounded-full bg-brand-bar"
                        style={{ width: `${Math.round(row.winChance * 100)}%` }}
                      />
                    </span>
                    <span className="w-10 text-right font-semibold tabular-nums text-foreground">
                      {formatChance(row.winChance)}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ValueCell({ total, soFar }: { total: string; soFar: string }) {
  return (
    <td className="px-2 text-right tabular-nums">
      <span className="block font-semibold text-foreground">{total}</span>
      <span className="block text-xs text-muted-foreground">{soFar} so far</span>
    </td>
  );
}
