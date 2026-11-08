import type { Metadata } from 'next';

import {
  EmptyState,
  HowCalculated,
  PageHeading,
  StaleStatsNotice,
} from '@/components/basketball/analysis/AnalysisBits';
import { formatGameDate } from '@/components/basketball/analysis/format';
import { firstParam, type SearchParams } from '@/components/basketball/analysis/searchParams';
import { DropSelect } from '@/components/basketball/pickups/DropSelect';
import { TakenPlayersNotice } from '@/components/basketball/shell/TakenPlayersNotice';
import { takenPlayersCheck } from '@/components/basketball/shell/takenPlayers';
import {
  PickupsNow,
  PickupsTable,
  type PickupRow,
} from '@/components/basketball/pickups/PickupsTable';
import { loadLeagueForPage } from '@/server/basketball/readModels/leaguePage';
import {
  loadPickups,
  PICKUP_LIMIT,
  PICKUP_MIN_MINUTES,
} from '@/server/basketball/readModels/pickupsModel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pickups | Fantasy basketball | Statly' };

export default async function BasketballPickupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const path = `/basketball/${encodeURIComponent(leagueId)}/pickups`;
  const { userId, league } = await loadLeagueForPage(leagueId, path);
  const now = new Date();
  const dropParam = firstParam(query, 'drop');
  const view = await loadPickups(league, {
    drop: dropParam === 'none' ? null : dropParam || undefined,
  });
  const rosterHref = `/basketball/${encodeURIComponent(leagueId)}/roster`;
  const gamesLeft = (teamId: string | null) =>
    teamId ? (view.schedule.gamesByTeam[teamId]?.remaining ?? 0) : 0;

  const rows: PickupRow[] =
    view.status === 'READY'
      ? view.options.map((option) => ({
          player: option.player,
          gamesLeft: gamesLeft(option.player.teamId),
          plan: option,
        }))
      : view.freeAgents.map((player) => ({
          player,
          gamesLeft: gamesLeft(player.teamId),
          plan: null,
        }));

  return (
    <div className="space-y-5">
      <PageHeading title="Pickups">
        {view.status === 'READY'
          ? `Free agents ranked by the categories they would swing this week against ${view.opponentTeam.name}.`
          : 'Free agents worth a roster spot, ranked for this week once you set an opponent.'}
      </PageHeading>
      <StaleStatsNotice updatedAt={view.pool.statsUpdatedAt} now={now} />

      {view.dropOptions.length === 0 ? (
        <EmptyState
          title="Your roster is empty"
          action={{ href: rosterHref, label: 'Add your players' }}
        >
          Pickups compare free agents with the players you already have.
        </EmptyState>
      ) : view.pool.players.length === 0 ? (
        <EmptyState title="NBA stats haven't been loaded yet">
          Free agents appear once box scores are in.
        </EmptyState>
      ) : (
        <>
          <TakenPlayersNotice
            check={takenPlayersCheck(league, view.status === 'READY' ? view.opponentTeam.id : null)}
            leagueId={league.id}
          />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <DropSelect
              path={path}
              params={query}
              options={view.dropOptions}
              selected={view.drop?.playerId ?? null}
              defaultId={view.defaultDropId}
            />
            <p className="pb-2 text-sm text-muted-foreground">
              Week {view.week}. An add counts from {formatGameDate(view.addFrom)}, the next US day.
            </p>
          </div>
          {view.status === 'READY' ? (
            <PickupsNow
              opponentName={view.opponentTeam.name}
              categories={view.now.categories}
              categoriesWon={view.now.categoriesWon}
            />
          ) : (
            <EmptyState
              title={`No opponent set for week ${view.week}`}
              action={{ href: rosterHref, label: "Set this week's opponent" }}
            >
              Until then, free agents are listed by season value.
            </EmptyState>
          )}
          {rows.length === 0 ? (
            <EmptyState title="No free agents to show">
              Everyone averaging {PICKUP_MIN_MINUTES} minutes or more is rostered, ruled out or has
              no game left this week.
            </EmptyState>
          ) : (
            <PickupsTable
              rows={rows}
              now={view.status === 'READY' ? view.now.categories : null}
              leagueId={league.id}
              userId={userId}
            />
          )}
        </>
      )}

      <HowCalculated>
        <p>
          <strong>Free agents</strong> are players nobody holds in this league profile, not ruled
          out, averaging at least {PICKUP_MIN_MINUTES} minutes. Every one whose NBA team still plays
          this week after the add takes effect is ranked, however low his season value; without an
          opponent, the best {PICKUP_LIMIT} by season value are listed. Statly only knows the
          players you enter, so paste every rostered player in your league under Players on other
          teams on the Roster page, or mark a player as taken here when a team you have not entered
          holds him.
        </p>
        <p>
          <strong>The swap.</strong> The player you drop loses his remaining games. The free agent
          joins from the next US day, as adds do on Yahoo and ESPN, and your lineup is simulated
          again for the rest of the week, so he only counts on days he would start, and he can push
          a weaker teammate to the bench.
        </p>
        <p>
          <strong>Change</strong> is categories won after the swap minus categories won now, against
          your opponent&rsquo;s projected week: a win counts 1 and a toss-up (within 3 %) ½. Ties
          are broken by <strong>fit</strong>: the change in each category, weighted by need. Close
          categories (within 10 %) count fully, ones you trail by more count 0.4 and ones you lead
          comfortably 0.1.
        </p>
        <p>
          <strong>Limits.</strong> Calls here use the fixed 3 % rule, not the win chances on the
          Matchup page. Statly has no record of your real lineups or other managers&rsquo; moves,
          and positions come from the stats provider, so starts are estimates.
        </p>
      </HowCalculated>
    </div>
  );
}
