import type { Metadata } from 'next';

import {
  EmptyState,
  HowCalculated,
  PageHeading,
  StaleStatsNotice,
} from '@/components/basketball/analysis/AnalysisBits';
import { formatAge } from '@/components/basketball/analysis/format';
import { hrefWith, type SearchParams } from '@/components/basketball/analysis/searchParams';
import { OutlookFilters } from '@/components/basketball/outlook/OutlookFilters';
import { OutlookPanels } from '@/components/basketball/outlook/OutlookPanels';
import { OutlookTable } from '@/components/basketball/outlook/OutlookTable';
import {
  defaultDescending,
  DEFAULT_SORT,
  outlookPanels,
  parseOutlookQuery,
  selectOutlookPlayers,
} from '@/components/basketball/outlook/outlookView';
import { loadLeagueForPage } from '@/server/basketball/readModels/leaguePage';
import { loadOutlook } from '@/server/basketball/readModels/roleOutlook';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Outlook | Fantasy basketball | Statly' };

export default async function BasketballOutlookPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const path = `/basketball/${encodeURIComponent(leagueId)}/outlook`;
  const { league } = await loadLeagueForPage(leagueId, path);
  const now = new Date();
  const view = await loadOutlook(league, { now });
  const tableQuery = parseOutlookQuery(query);
  const players = selectOutlookPlayers(view.players, tableQuery);
  const rosterHref = `/basketball/${encodeURIComponent(leagueId)}/roster`;
  const sortHref = (key: string) => {
    const descending = key === tableQuery.sort ? !tableQuery.descending : defaultDescending(key);
    return hrefWith(path, query, {
      sort: key === DEFAULT_SORT[tableQuery.view] ? null : key,
      dir: descending === defaultDescending(key) ? null : descending ? 'desc' : 'asc',
    });
  };
  const sortState = (key: string) =>
    key === tableQuery.sort
      ? tableQuery.descending
        ? ('descending' as const)
        : ('ascending' as const)
      : ('none' as const);

  return (
    <div className="space-y-5">
      <PageHeading title="Outlook">
        Who gains or loses minutes and usage over the next 5 games, and what each player should
        produce for the rest of the season.
      </PageHeading>
      <StaleStatsNotice updatedAt={view.statsUpdatedAt} now={now} />
      {view.injuriesStale && view.players.length > 0 ? (
        <p
          role="status"
          className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground"
        >
          {view.injuriesFetchedAt
            ? `The injury report was last updated ${formatAge(view.injuriesFetchedAt, now)}. It is still used; injuries marked "old" may have changed.`
            : 'No injury report has been loaded, so the outlook treats every player as available.'}
        </p>
      ) : null}

      {view.players.length === 0 ? (
        view.statsUpdatedAt ? (
          <EmptyState title="The outlook starts after a player's third game">
            A player is listed from his third game for his team with 10+ minutes a game over his
            last 5.
          </EmptyState>
        ) : (
          <EmptyState title="NBA stats haven't been loaded yet">
            The outlook appears once this season&rsquo;s box scores are in.
          </EmptyState>
        )
      ) : (
        <>
          <section aria-labelledby="outlook-movers" className="space-y-3">
            <div>
              <h2 id="outlook-movers" className="font-display text-xl font-bold text-foreground">
                Biggest movers
              </h2>
              <p className="text-sm text-muted-foreground">
                Across the NBA, not just this league. Players expected to miss most of the next 5
                games are left out.
              </p>
            </div>
            <OutlookPanels panels={outlookPanels(view.players)} stale={view.injuriesStale} />
          </section>

          <section aria-labelledby="outlook-players" className="scroll-mt-20 space-y-3">
            <h2 id="outlook-players" className="font-display text-xl font-bold text-foreground">
              Players
            </h2>
            <OutlookFilters path={path} params={query} query={tableQuery} />
            {players.length === 0 ? (
              tableQuery.show === 'OPPONENT' && !view.opponentName ? (
                <EmptyState
                  title="No opponent set for this week"
                  action={{ href: rosterHref, label: 'Set this week’s opponent' }}
                />
              ) : (
                <EmptyState
                  title="No players match this filter"
                  action={
                    tableQuery.show === 'MINE'
                      ? { href: rosterHref, label: 'Add your players' }
                      : undefined
                  }
                >
                  {tableQuery.show === 'MINE'
                    ? 'None of your players has an outlook yet, or your roster is empty.'
                    : 'Try all players.'}
                </EmptyState>
              )
            ) : (
              <>
                <OutlookTable
                  players={players}
                  view={tableQuery.view}
                  injuriesStale={view.injuriesStale}
                  sortHref={sortHref}
                  sortState={sortState}
                />
                <p className="text-xs text-muted-foreground">
                  {players.length} of {view.players.length} players. Stats are per game. A traded
                  player is shown for his current team.
                </p>
              </>
            )}
          </section>
        </>
      )}

      <HowCalculated>
        <p>
          <strong>Model.</strong> This is the Role Model from the REC Bible sheet, ported rule for
          rule. Its models were fitted on NBA seasons 2013-14 to 2024-25 and tested on 2025-26,
          where the minutes prediction was off by 3.0 minutes a game on average. From each
          player&rsquo;s recent games, his role, his coach&rsquo;s habits and which teammates are
          out or coming back, it predicts his minutes, usage rate and total usage (usage rate ×
          minutes ÷ 48) over his team&rsquo;s next 5 games.
        </p>
        <p>
          <strong>Who is listed.</strong> A player appears from his third game for his team with 10+
          minutes a game over his last 5. By default the table shows every player rostered in this
          league and the 25 free agents with the most total usage over the next 5 among those
          expected to play at least one of them.
        </p>
        <p>
          <strong>Next 5 games.</strong> Minutes and usage are averages a game; his minutes land in
          the range 8 times in 10. P(+3) and P(−3) are the chances his minutes rise or fall by 3 or
          more a game. The injury shift adds minutes for teammates newly out and takes them away for
          teammates coming back, from how his minutes changed without each of them; the teammates
          named moved him by a minute or more. Bigger role counts games in a row at least 4 minutes
          above his recent normal. Stats are adjusted for the next 5 opponents&rsquo; defence (Opp
          def: how many more or fewer points they allow than average). Expected games take off games
          he is injured for and the chance he sits the second night of a back-to-back; this
          week&rsquo;s games run to the end of your league&rsquo;s fantasy week.
        </p>
        <p>
          <strong>Rest of season.</strong> Minutes a game played, from his last 5, last 10 and
          season minutes, last season&rsquo;s and teammates expected to miss games. Expected games
          come from his availability this season and last, with injured games first.
        </p>
        <p>
          <strong>Biggest movers.</strong> The sheet&rsquo;s three charts as lists: the 10 biggest
          rises and falls in minutes, the 15 biggest injury shifts (0.5 minutes or more) and the 15
          largest gaps between projected points and season average. The minutes and points lists
          need 15+ minutes a game over the last 5.
        </p>
        <p>
          <strong>Differences from the sheet.</strong> Injuries come from the ESPN injury report
          (status, return date and whether he is out for the season) rather than the sheet&rsquo;s
          injury tab, so injury-driven numbers can differ. Career rates, last season&rsquo;s minutes
          and back-to-back records are recomputed from the earlier seasons Statly has stored, not
          the sheet&rsquo;s tables back to 2013-14. Minutes are the box score&rsquo;s whole minutes,
          and players are matched by ID, not name.
        </p>
      </HowCalculated>
    </div>
  );
}
