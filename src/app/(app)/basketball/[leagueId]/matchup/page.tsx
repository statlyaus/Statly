import type { Metadata } from 'next';

import {
  EmptyState,
  HowCalculated,
  PageHeading,
  StaleStatsNotice,
} from '@/components/basketball/analysis/AnalysisBits';
import {
  firstParam,
  hrefWith,
  type SearchParams,
} from '@/components/basketball/analysis/searchParams';
import { MatchupRosterTable } from '@/components/basketball/matchup/MatchupRosterTable';
import {
  MatchupCategoryTable,
  MatchupScoreboard,
  WeekNav,
} from '@/components/basketball/matchup/MatchupSummary';
import { toEasternDate } from '@/lib/basketball/fantasyWeeks';
import { loadLeagueForPage } from '@/server/basketball/readModels/leaguePage';
import { loadMatchup, resolveWeek } from '@/server/basketball/readModels/matchupModel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Matchup | Fantasy basketball | Statly' };

export default async function BasketballMatchupPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const path = `/basketball/${encodeURIComponent(leagueId)}/matchup`;
  const { league } = await loadLeagueForPage(leagueId, path);
  const now = new Date();
  const today = toEasternDate(now);
  const weekParam = Number(firstParam(query, 'week'));
  const view = await loadMatchup(league, {
    week: Number.isInteger(weekParam) ? weekParam : undefined,
    today,
  });
  const currentWeek = resolveWeek(league, undefined, today).week;
  const rosterHref = `/basketball/${encodeURIComponent(leagueId)}/roster`;
  const hrefFor = (week: number) =>
    hrefWith(path, query, { week: week === currentWeek ? null : String(week) });
  const myRosterEmpty = !league.rosterSpots.some((spot) => spot.teamId === league.myTeamId);

  return (
    <div className="space-y-5">
      <PageHeading title="Matchup">
        {view.status === 'READY'
          ? `Week ${view.week} against ${view.opponentTeam.name}: who wins each category if the rest of the week plays out as projected.`
          : 'Who wins each category this week if the rest of the week plays out as projected.'}
      </PageHeading>
      <StaleStatsNotice updatedAt={view.pool.statsUpdatedAt} now={now} />
      <WeekNav
        week={view.week}
        lastWeek={view.lastWeek}
        currentWeek={currentWeek}
        schedule={view.schedule}
        hrefFor={hrefFor}
      />

      {myRosterEmpty ? (
        <EmptyState
          title="Your roster is empty"
          action={{ href: rosterHref, label: 'Add your players' }}
        >
          Add your players on the Roster page to project your week.
        </EmptyState>
      ) : view.status === 'NO_OPPONENT' ? (
        <EmptyState
          title={`No opponent set for week ${view.week}`}
          action={{ href: rosterHref, label: "Set this week's opponent" }}
        >
          Pick who you play this week, and add their roster, to see the category odds.
        </EmptyState>
      ) : view.pool.players.length === 0 ? (
        <EmptyState title="NBA stats haven't been loaded yet">
          Projections appear once box scores are in.
        </EmptyState>
      ) : (
        <>
          <MatchupScoreboard
            myTeamName={view.myTeam.name}
            opponentName={view.opponentTeam.name}
            projection={view.projection}
            format={league.format}
          />
          <MatchupCategoryTable projection={view.projection} punts={league.puntCategories} />
          <MatchupRosterTable
            title={`${view.myTeam.name} (you)`}
            players={view.me.players}
            categories={league.categories}
            weekStart={view.schedule.start}
          />
          <MatchupRosterTable
            title={view.opponentTeam.name}
            players={view.opponent.players}
            categories={league.categories}
            weekStart={view.schedule.start}
          />
        </>
      )}

      <HowCalculated>
        <p>
          <strong>So far.</strong> Box scores from this week&rsquo;s finished days count for a
          player only on days the lineup simulator would have started him, and only from the date
          you added him.
        </p>
        <p>
          <strong>Rest of the week.</strong> Each remaining day, players whose NBA team plays are
          slotted into your starting positions by season value, highest first, while a slot they are
          eligible for is open. Injured-list players and players ruled out do not play; day-to-day
          players do. Each start adds the player&rsquo;s projected per-game line from the Players
          page.
        </p>
        <p>
          <strong>Win chance</strong> compares the margin with how much the games still to play
          could move it, so the odds firm up as the week goes on. A category within 3 % is a toss-up
          (T). The chance of winning the week combines the category chances as if they were
          independent, which they are not quite: a big scoring week also lifts points and threes
          together.
        </p>
        <p>
          <strong>Limits.</strong> Statly has no record of your real daily lineups, so finished days
          are simulated too. Players you have dropped no longer count, even for games they played
          for you this week. Positions come from the stats provider (often just G, F or C) and can
          differ from your platform&rsquo;s, so a player may fill fewer slots here than he can for
          you.
        </p>
      </HowCalculated>
    </div>
  );
}
