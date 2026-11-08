import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { BasketballLeagueSwitcher } from '@/components/basketball/shell/BasketballLeagueSwitcher';
import { BasketballLeagueTabs } from '@/components/basketball/shell/BasketballLeagueTabs';
import {
  FORMAT_LABELS,
  PLATFORM_LABELS,
  formatEasternDate,
  formatWeekLabel,
} from '@/components/basketball/shell/basketballFormat';
import { toEasternDate } from '@/lib/basketball/fantasyWeeks';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import {
  listBasketballLeagues,
  loadOwnedBasketballLeague,
} from '@/server/basketball/leagues/basketballLeagueQueries';
import { currentFantasyWeek } from '@/server/basketball/readModels/overview';
import { formatNbaSeason } from '@/types/basketball';

export const dynamic = 'force-dynamic';

/**
 * Every page of one basketball league profile: the owner-scoped load (a missing league and someone
 * else's league are both 404), the league header with the current fantasy week, and the section tabs.
 */
export default async function BasketballLeagueLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) notFound();
  const [league, leagues] = await Promise.all([
    loadOwnedBasketballLeague(userId, leagueId),
    listBasketballLeagues(userId),
  ]);
  if (!league) notFound();

  const { phase, week } = currentFantasyWeek(league, toEasternDate(new Date()));
  const weekLabel =
    phase === 'PRESEASON'
      ? `Week 1 starts ${formatEasternDate(league.weekOneStartsOn)}`
      : phase === 'ENDED'
        ? 'Regular season over'
        : formatWeekLabel(week);
  const meta = [
    PLATFORM_LABELS[league.platform],
    formatNbaSeason(league.season),
    FORMAT_LABELS[league.format],
    `${league.teamCount} teams`,
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="truncate font-display text-3xl font-bold leading-tight text-foreground">
              {league.name}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{meta.join(' · ')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold tabular-nums text-foreground">{weekLabel}</p>
            {leagues.length > 1 ? (
              <BasketballLeagueSwitcher leagues={leagues} currentLeagueId={league.id} />
            ) : null}
          </div>
        </div>
        <div className="mt-4">
          <BasketballLeagueTabs leagueId={league.id} />
        </div>
      </header>
      {children}
    </div>
  );
}
