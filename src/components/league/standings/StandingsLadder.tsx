'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useMemo, useState, type CSSProperties } from 'react';

import { ResultChip, TeamMark } from '@/components/scores/MatchupScore';

import {
  describeResult,
  formatGamesBack,
  formatPct,
  formatRecord,
  formatStreak,
  matchCentreHref,
  RESULT_TO_CHIP,
  streakValue,
  type StandingsData,
  type StandingsTeam,
} from './standingsFormat';
import { FinalsChance, FormChips, Movement } from './StandingsBits';

type SortKey = 'rank' | 'winPct' | 'gamesBack' | 'finals' | 'categoryWinPct' | 'streak';

const SORTS: Record<
  SortKey,
  { label: string; value: (team: StandingsTeam) => number; highFirst: boolean }
> = {
  rank: { label: 'Ladder position', value: (team) => team.rank, highFirst: false },
  winPct: { label: 'Win percentage', value: (team) => team.winPct ?? -1, highFirst: true },
  gamesBack: { label: 'Games back', value: (team) => team.gamesBack, highFirst: false },
  finals: {
    label: 'Finals chance',
    value: (team) => team.finals?.chance ?? -1,
    highFirst: true,
  },
  categoryWinPct: {
    label: 'Category win percentage',
    value: (team) => team.categoryWinPct ?? -1,
    highFirst: true,
  },
  streak: { label: 'Streak', value: (team) => streakValue(team.streak), highFirst: true },
};

// Minimum widths: rank 5.5rem and the stat columns (56rem with finals), plus the team column (at
// least 9rem on phones, 13rem from sm). Narrower screens scroll with rank and team pinned.
const LADDER_MIN_WIDTH_STYLE = {
  '--ladder-min': '70.5rem',
  '--ladder-min-sm': '74.5rem',
} as CSSProperties;

export function StandingsLadder({
  data,
  leagueId,
}: {
  data: StandingsData;
  leagueId: string;
}): React.JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; flipped: boolean }>({
    key: 'rank',
    flipped: false,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const teamsById = useMemo(
    () => new Map(data.teams.map((team) => [team.memberId, team])),
    [data.teams]
  );

  const rows = useMemo(() => {
    const spec = SORTS[sort.key];
    const direction = (spec.highFirst ? -1 : 1) * (sort.flipped ? -1 : 1);
    return [...data.teams].sort(
      (left, right) => (spec.value(left) - spec.value(right)) * direction || left.rank - right.rank
    );
  }, [data.teams, sort]);
  const showFinalsLine = sort.key === 'rank' && !sort.flipped && data.finalsTeams > 0;
  const hasOdds = data.teams.some((team) => team.finals !== null);
  const columnCount = hasOdds ? 10 : 9;

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, flipped: !current.flipped } : { key, flipped: false }
    );
  }

  const headerProps = { sort, onSort: toggleSort };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative overflow-x-auto">
        <table
          className="w-full min-w-[var(--ladder-min)] table-fixed text-sm sm:min-w-[var(--ladder-min-sm)]"
          style={LADDER_MIN_WIDTH_STYLE}
        >
          <caption className="sr-only">
            League ladder. Sorted by {SORTS[sort.key].label.toLowerCase()}. Select a team to see its
            results.
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <SortHeader
                {...headerProps}
                sortKey="rank"
                align="left"
                className="sticky left-0 z-10 w-[5.5rem] bg-card pl-2"
              >
                #
              </SortHeader>
              <th
                scope="col"
                className="sticky left-[5.5rem] z-10 bg-card py-2 pr-2 text-left font-semibold shadow-[1px_0_0_0_var(--border)]"
              >
                Team
              </th>
              <th scope="col" className="w-24 px-2 py-2 text-right font-semibold">
                W–L–D
              </th>
              <SortHeader {...headerProps} sortKey="winPct" className="w-20">
                Win %
              </SortHeader>
              <SortHeader {...headerProps} sortKey="gamesBack" className="w-16">
                GB
              </SortHeader>
              {hasOdds ? (
                <SortHeader {...headerProps} sortKey="finals" className="w-24">
                  Finals
                </SortHeader>
              ) : null}
              <SortHeader {...headerProps} sortKey="categoryWinPct" className="w-40">
                Categories
              </SortHeader>
              <SortHeader {...headerProps} sortKey="streak" className="w-20">
                Streak
              </SortHeader>
              <th scope="col" className="w-36 px-3 py-2 text-left font-semibold">
                Last 5
              </th>
              <th scope="col" className="w-44 px-3 py-2 text-left font-semibold">
                {data.liveRound ? `Round ${data.liveRound}` : 'Next'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((team) => {
              const isYou = team.memberId === data.viewerMemberId;
              const isOpen = expanded === team.memberId;
              const rowBg = isYou ? 'bg-accent' : 'bg-card';
              const opponent = team.upcoming?.opponentId
                ? teamsById.get(team.upcoming.opponentId)
                : null;
              const liveResult = team.results.find((result) => result.status === 'LIVE');
              return (
                <Fragment key={team.memberId}>
                  <tr
                    aria-label={`${team.rank}. ${team.teamName}${isYou ? ' (your team)' : ''}`}
                    className={`h-14 border-b border-border ${rowBg}`}
                  >
                    <td className={`sticky left-0 z-10 pl-4 pr-2 ${rowBg}`}>
                      <span className="flex items-center gap-2">
                        <span className="w-6 text-right font-display text-lg font-bold tabular-nums text-foreground">
                          {team.rank}
                        </span>
                        <Movement value={team.movement} />
                      </span>
                    </td>
                    <td
                      className={`sticky left-[5.5rem] z-10 py-1.5 pr-2 shadow-[1px_0_0_0_var(--border)] ${rowBg}`}
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`standings-detail-${team.memberId}`}
                        onClick={() => setExpanded(isOpen ? null : team.memberId)}
                        className="flex w-full min-w-0 items-center gap-2.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                      >
                        <TeamMark teamName={team.teamName} logoUrl={team.teamLogoUrl} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-foreground">
                              {team.teamName}
                            </span>
                            {isYou ? (
                              <span className="shrink-0 rounded-sm bg-brand-bar px-1 text-[0.6875rem] font-bold leading-4 text-brand-bar-foreground">
                                YOU
                              </span>
                            ) : null}
                          </span>
                        </span>
                        {isOpen ? (
                          <ChevronUp
                            aria-hidden="true"
                            className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                          />
                        ) : (
                          <ChevronDown
                            aria-hidden="true"
                            className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                          />
                        )}
                      </button>
                    </td>
                    <td className="px-2 text-right font-semibold tabular-nums text-foreground">
                      {formatRecord(team.wins, team.losses, team.draws)}
                    </td>
                    <td className="px-2 text-right tabular-nums text-foreground">
                      {formatPct(team.winPct)}
                    </td>
                    <td className="px-2 text-right tabular-nums text-muted-foreground">
                      {formatGamesBack(team.gamesBack)}
                    </td>
                    {hasOdds ? (
                      <td className="px-2">
                        <FinalsChance finals={team.finals} />
                      </td>
                    ) : null}
                    <td className="px-2">
                      <CategoryBar team={team} />
                    </td>
                    <td className="px-2 text-right font-semibold tabular-nums text-foreground">
                      {formatStreak(team.streak)}
                    </td>
                    <td className="px-3">
                      <FormChips form={team.form} />
                    </td>
                    <td className="px-3">
                      {team.upcoming ? (
                        <span className="flex min-w-0 items-center gap-2">
                          {opponent ? (
                            <TeamMark
                              teamName={opponent.teamName}
                              logoUrl={opponent.teamLogoUrl}
                              size="sm"
                            />
                          ) : null}
                          <span className="min-w-0">
                            <span className="block truncate text-foreground">
                              {opponent ? `v ${opponent.teamName}` : 'Bye'}
                            </span>
                            {liveResult ? (
                              <span className="block text-xs text-foreground">
                                <span className="font-bold uppercase text-result-loss">Live</span>{' '}
                                <span className="tabular-nums">
                                  {liveResult.categoriesFor}–{liveResult.categoriesAgainst}
                                </span>
                              </span>
                            ) : (
                              <span className="block text-xs text-muted-foreground">
                                Round {team.upcoming.round}
                              </span>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr
                      id={`standings-detail-${team.memberId}`}
                      className="border-b border-border bg-muted"
                    >
                      <td colSpan={columnCount} className="p-0">
                        <TeamDetail
                          team={team}
                          data={data}
                          leagueId={leagueId}
                          teamsById={teamsById}
                        />
                      </td>
                    </tr>
                  ) : null}
                  {showFinalsLine && team.rank === data.finalsTeams ? (
                    <tr aria-hidden="true" className="border-b border-border">
                      <td colSpan={columnCount} className="bg-card p-0">
                        <div className="flex h-8 items-center gap-3">
                          <span className="sticky left-0 z-20 flex h-full items-center bg-card pl-4 pr-1">
                            <span className="rounded-full bg-result-win px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-result-win-foreground">
                              Finals
                            </span>
                          </span>
                          <span className="h-0.5 flex-1 rounded-full bg-result-win" />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {showFinalsLine
          ? `Top ${data.finalsTeams} make finals. `
          : data.finalsTeams > 0
            ? 'Sort by ladder position to see the finals line. '
            : ''}
        Games back counts a draw as half a game. Categories are all categories won and lost this
        season.{hasOdds ? ' Finals chances simulate the remaining games 5,000 times.' : ''}
      </p>
    </div>
  );
}

function SortHeader({
  sort,
  onSort,
  sortKey,
  children,
  align = 'right',
  className = '',
}: {
  sort: { key: SortKey; flipped: boolean };
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === sortKey;
  const highFirst = SORTS[sortKey].highFirst !== sort.flipped;
  const state = active ? (highFirst ? 'descending' : 'ascending') : 'none';
  return (
    <th scope="col" aria-sort={state} className={`py-2 font-semibold ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex min-h-8 w-full items-center gap-1 rounded-sm px-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar ${
          align === 'right' ? 'justify-end' : 'justify-start'
        } ${active ? 'text-foreground' : ''}`}
      >
        {children}
        <span className="sr-only">, sort by {SORTS[sortKey].label.toLowerCase()}</span>
        {active ? (
          state === 'descending' ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-3.5" />
          )
        ) : null}
      </button>
    </th>
  );
}

function CategoryBar({ team }: { team: StandingsTeam }) {
  const total = team.categoryWins + team.categoryLosses + team.categoryDraws;
  const share = (value: number) => (total > 0 ? `${(value / total) * 100}%` : '0%');
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="tabular-nums text-foreground">
        {formatRecord(team.categoryWins, team.categoryLosses, team.categoryDraws)}
        <span className="ml-1.5 text-xs text-muted-foreground">
          {formatPct(team.categoryWinPct)}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="flex h-1.5 w-full max-w-28 gap-0.5 overflow-hidden rounded-full"
      >
        {total > 0 ? (
          <>
            <span
              className="h-full rounded-l-full bg-result-win"
              style={{ width: share(team.categoryWins) }}
            />
            <span
              className="h-full bg-muted-foreground/40"
              style={{ width: share(team.categoryDraws) }}
            />
            <span
              className="h-full rounded-r-full bg-result-loss"
              style={{ width: share(team.categoryLosses) }}
            />
          </>
        ) : (
          <span className="h-full w-full rounded-full bg-muted" />
        )}
      </span>
    </span>
  );
}

function TeamDetail({
  team,
  data,
  leagueId,
  teamsById,
}: {
  team: StandingsTeam;
  data: StandingsData;
  leagueId: string;
  teamsById: ReadonlyMap<string, StandingsTeam>;
}) {
  const isYou = team.memberId === data.viewerMemberId;
  return (
    <div className="sticky left-0 w-[min(100%,calc(100vw-4rem))] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {team.bestRank !== null
            ? `Highest ${ordinal(team.bestRank)} · lowest ${ordinal(team.worstRank ?? team.bestRank)} this season`
            : 'No completed rounds yet'}
        </p>
        <Link
          href={`/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(team.memberId)}`}
          className="text-xs font-semibold text-foreground underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
        >
          View {team.teamName} roster
        </Link>
      </div>
      <ol className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {team.results.map((result) => {
          const opponent = result.opponentId ? teamsById.get(result.opponentId) : null;
          const text = describeResult(result, opponent?.teamName ?? null);
          const involvesYou =
            isYou || (result.opponentId !== null && result.opponentId === data.viewerMemberId);
          const body = (
            <>
              <span className="w-8 shrink-0 text-xs font-semibold text-muted-foreground">
                R{result.round}
              </span>
              {result.result ? (
                <ResultChip result={RESULT_TO_CHIP[result.result]} className="size-5 shrink-0" />
              ) : (
                <span className="size-5 shrink-0" />
              )}
              <span className="min-w-0 truncate text-sm text-foreground first-letter:uppercase">
                {text}
              </span>
            </>
          );
          return (
            <li key={`${result.round}-${result.phase}`}>
              {involvesYou && result.status !== 'BYE' && result.status !== 'SCHEDULED' ? (
                <Link
                  href={matchCentreHref(leagueId, result.round)}
                  className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                >
                  {body}
                  <span className="sr-only">, open in Match Centre</span>
                </Link>
              ) : (
                <span className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-2">
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}
