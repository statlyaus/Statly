import type { Metadata } from 'next';

import {
  EmptyState,
  HowCalculated,
  PageHeading,
  StaleStatsNotice,
} from '@/components/basketball/analysis/AnalysisBits';
import { hrefWith, type SearchParams } from '@/components/basketball/analysis/searchParams';
import { PlayersControls } from '@/components/basketball/players/PlayersControls';
import { PlayersTable, PlayersTableFooter } from '@/components/basketball/players/PlayersTable';
import {
  defaultDescending,
  parsePlayersQuery,
  PLAYER_PAGE_SIZE,
  selectPlayers,
  type PlayerSortKey,
} from '@/components/basketball/players/playersView';
import { BLEND_GAMES } from '@/lib/basketball/projection';
import { toEasternDate } from '@/lib/basketball/fantasyWeeks';
import { loadLeagueForPage } from '@/server/basketball/readModels/leaguePage';
import { resolveWeek } from '@/server/basketball/readModels/matchupModel';
import { loadPlayerPool } from '@/server/basketball/readModels/playerPool';
import { loadWeekSchedule } from '@/server/basketball/readModels/weekSchedule';
import { formatNbaSeason } from '@/types/basketball';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Players | Fantasy basketball | Statly' };

export default async function BasketballPlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const path = `/basketball/${encodeURIComponent(leagueId)}/players`;
  const { userId, league } = await loadLeagueForPage(leagueId, path);
  const view = parsePlayersQuery(query, league.categories);
  const now = new Date();
  const today = toEasternDate(now);
  const { week } = resolveWeek(league, undefined, today);
  const [pool, schedule] = await Promise.all([
    loadPlayerPool(league, { punts: view.punts ?? undefined, today }),
    loadWeekSchedule(league, week, { today }),
  ]);

  const gamesLeft = Object.fromEntries(
    pool.players.map((player) => [
      player.playerId,
      player.teamId ? (schedule.gamesByTeam[player.teamId]?.remaining ?? 0) : 0,
    ])
  );
  const selected = selectPlayers(pool.players, view, (player) => gamesLeft[player.playerId]);
  const shown = selected.slice(0, view.limit);
  const sortHref = (key: PlayerSortKey) => {
    const descending = key === view.sort ? !view.descending : defaultDescending(key);
    return hrefWith(path, query, {
      sort: key === 'value' ? null : key,
      dir: descending === defaultDescending(key) ? null : descending ? 'desc' : 'asc',
      limit: null,
    });
  };
  const sortState = (key: PlayerSortKey) =>
    key === view.sort ? (view.descending ? 'descending' : 'ascending') : ('none' as const);
  const weight = Math.min(1, pool.typicalGamesThisSeason / BLEND_GAMES);
  const percent = (share: number) => `${Math.round(share * 100)} %`;

  return (
    <div className="space-y-5">
      <PageHeading title="Players">
        Every NBA player valued for {league.name}&rsquo;s categories. Find who helps you, and try
        punting categories before you commit.
      </PageHeading>
      <StaleStatsNotice updatedAt={pool.statsUpdatedAt} now={now} />

      {pool.players.length === 0 ? (
        <EmptyState title="NBA stats haven't been loaded yet">
          Player values appear once this season&rsquo;s or last season&rsquo;s box scores are in.
        </EmptyState>
      ) : (
        <>
          <PlayersControls
            path={path}
            params={query}
            leagueId={league.id}
            userId={userId}
            categories={league.categories}
            leaguePunts={pool.leaguePunts}
            punts={pool.punts}
            query={view}
          />
          <p className="text-sm text-muted-foreground">
            Blend for a typical player: {percent(weight)} {formatNbaSeason(pool.season)} (
            {pool.typicalGamesThisSeason} games), {percent(1 - weight)}{' '}
            {formatNbaSeason(pool.lastSeason)}. &ldquo;Wk&rdquo; counts NBA games left in fantasy
            week {week}.
          </p>
          {shown.length === 0 ? (
            <EmptyState title="No players match these filters">
              Clear the search or lower the minutes floor.
            </EmptyState>
          ) : (
            <>
              <PlayersTable
                players={shown}
                categories={league.categories}
                punts={pool.punts}
                showAuction={league.auctionBudget !== null}
                gamesLeft={gamesLeft}
                sortHref={sortHref}
                sortState={sortState}
              />
              <PlayersTableFooter
                shown={shown.length}
                total={selected.length}
                moreHref={
                  selected.length > shown.length
                    ? hrefWith(path, query, { limit: String(view.limit + PLAYER_PAGE_SIZE) })
                    : null
                }
              />
            </>
          )}
        </>
      )}

      <HowCalculated>
        <p>
          <strong>Projection.</strong> Each player&rsquo;s per-game line blends this season with
          last season by games played: a player with 6 games is 40 % this season, and after{' '}
          {BLEND_GAMES} games only this season counts. A rookie&rsquo;s early games are blended with
          a typical bench player&rsquo;s line instead. Only games he played count.
        </p>
        <p>
          <strong>Category z-scores.</strong> Each category compares the player with the pool: every
          player averaging at least 20 minutes. Counting stats use (his number − pool average) ÷
          pool spread. FG% and FT% are weighted by attempts, so a great percentage on few shots
          moves the needle less than on many. Turnovers count against.
        </p>
        <p>
          <strong>Value</strong> adds the z-scores of your league&rsquo;s categories, leaving out
          punted ones.
          {league.auctionBudget !== null
            ? ' Auction $ shares the league’s whole budget by value above the best player who would go undrafted (teams × roster spots, IL excluded); everyone else is $1.'
            : ''}
        </p>
        <p>
          <strong>Limits.</strong> Positions are the stats provider&rsquo;s (often just G, F or C)
          and can differ from Yahoo&rsquo;s or ESPN&rsquo;s. Injury status comes from the NBA injury
          report. Each category is valued on its own, with no adjustment for how they move together.
        </p>
      </HowCalculated>
    </div>
  );
}
