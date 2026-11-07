import type { Metadata } from 'next';

import {
  EmptyState,
  HowCalculated,
  PageHeading,
  StaleStatsNotice,
} from '@/components/basketball/analysis/AnalysisBits';
import { hrefWith, type SearchParams } from '@/components/basketball/analysis/searchParams';
import {
  PanelLink,
  PlayerAlertList,
  RotationPanel,
} from '@/components/basketball/rotation/RotationAlerts';
import { RotationFilters } from '@/components/basketball/rotation/RotationFilters';
import {
  RotationPlayersTable,
  RotationTableFooter,
} from '@/components/basketball/rotation/RotationPlayersTable';
import {
  RotationTeamsTable,
  sortTeamsByChurn,
} from '@/components/basketball/rotation/RotationTeamsTable';
import {
  defaultDescending,
  parseRotationQuery,
  ROTATION_PAGE_SIZE,
  selectRotationPlayers,
  type RotationSortKey,
} from '@/components/basketball/rotation/rotationView';
import { loadLeagueForPage } from '@/server/basketball/readModels/leaguePage';
import { loadRotation } from '@/server/basketball/readModels/rotationModel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rotation | Fantasy basketball | Statly' };

const FREE_AGENT_LIMIT = 6;

export default async function BasketballRotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const path = `/basketball/${encodeURIComponent(leagueId)}/rotation`;
  const { league } = await loadLeagueForPage(leagueId, path);
  const now = new Date();
  const view = await loadRotation(league);
  const teamCodes = view.teams.map((team) => team.teamCode);
  const tableQuery = parseRotationQuery(query, teamCodes);
  const selected = selectRotationPlayers(view.players, tableQuery);
  const shown = selected.slice(0, tableQuery.limit);
  const rosterHref = `/basketball/${encodeURIComponent(leagueId)}/roster`;
  const hasRoster = league.rosterSpots.some((spot) => spot.teamId === league.myTeamId);
  const tableHref = (updates: Record<string, string | null>) =>
    `${hrefWith(path, query, { ...updates, limit: null })}#rotation-players`;
  const sortHref = (key: RotationSortKey) => {
    const descending = key === tableQuery.sort ? !tableQuery.descending : defaultDescending(key);
    return hrefWith(path, query, {
      sort: key === 'alert' ? null : key,
      dir: descending === defaultDescending(key) ? null : descending ? 'desc' : 'asc',
      limit: null,
    });
  };
  const sortState = (key: RotationSortKey) =>
    key === tableQuery.sort
      ? tableQuery.descending
        ? ('descending' as const)
        : ('ascending' as const)
      : ('none' as const);

  return (
    <div className="space-y-5">
      <PageHeading title="Rotation">
        Who is starting, who lost minutes, and which coaches shuffle their lineups.
      </PageHeading>
      <StaleStatsNotice updatedAt={view.statsUpdatedAt} now={now} />

      {view.players.length === 0 ? (
        <EmptyState title="NBA stats haven't been loaded yet">
          Rotations appear once this season&rsquo;s box scores are in.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <RotationPanel id="rotation-mine" title="Your players">
              <PlayerAlertList
                players={view.alerts.mine}
                empty={
                  hasRoster ? (
                    'No rotation alerts for your players.'
                  ) : (
                    <>
                      Your roster is empty.{' '}
                      <PanelLink href={rosterHref}>Add your players</PanelLink>
                    </>
                  )
                }
              />
            </RotationPanel>
            <RotationPanel
              id="rotation-opponent"
              title={
                view.opponentName ? `${view.opponentName} (this week)` : "This week's opponent"
              }
            >
              {view.opponentName ? (
                <PlayerAlertList
                  players={view.alerts.opponent}
                  empty="No rotation alerts for your opponent's players."
                />
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  No opponent set for this week.{' '}
                  <PanelLink href={rosterHref}>Set this week&rsquo;s opponent</PanelLink>
                </p>
              )}
            </RotationPanel>
          </div>

          <RotationPanel id="rotation-free-agents" title="Free agents moving up">
            <p className="text-sm text-muted-foreground">
              New starters, injury cover and minutes up among players nobody holds in this league.
            </p>
            <PlayerAlertList
              players={view.freeAgentRoleUps.slice(0, FREE_AGENT_LIMIT)}
              empty="No free agent has moved into a bigger role lately."
            />
            {view.freeAgentRoleUps.length > FREE_AGENT_LIMIT ? (
              <PanelLink href={tableHref({ show: 'rising', team: null, sort: 'mpg', dir: null })}>
                All {view.freeAgentRoleUps.length} free agents moving up, in the player table
              </PanelLink>
            ) : null}
          </RotationPanel>

          <section aria-labelledby="rotation-teams" className="space-y-2">
            <h2 id="rotation-teams" className="font-display text-xl font-bold text-foreground">
              NBA teams
            </h2>
            <p className="text-sm text-muted-foreground">
              Most lineup churn first. Choose a team to list its players below.
            </p>
            <RotationTeamsTable
              teams={sortTeamsByChurn(view.teams)}
              teamHref={(teamCode) => tableHref({ team: teamCode, show: null })}
            />
          </section>

          <section aria-labelledby="rotation-players" className="scroll-mt-20 space-y-3">
            <h2 id="rotation-players" className="font-display text-xl font-bold text-foreground">
              Players
            </h2>
            <RotationFilters
              path={path}
              params={query}
              teamCodes={teamCodes}
              query={{ show: tableQuery.show, team: tableQuery.team }}
            />
            {shown.length === 0 ? (
              <EmptyState title="No players match these filters">
                {tableQuery.show === 'MINE' && !hasRoster
                  ? 'Add your players on the Roster page.'
                  : 'Try all players or all teams.'}
              </EmptyState>
            ) : (
              <>
                <RotationPlayersTable players={shown} sortHref={sortHref} sortState={sortState} />
                <RotationTableFooter
                  shown={shown.length}
                  total={selected.length}
                  moreHref={
                    selected.length > shown.length
                      ? hrefWith(path, query, {
                          limit: String(tableQuery.limit + ROTATION_PAGE_SIZE),
                        })
                      : null
                  }
                />
              </>
            )}
          </section>
        </>
      )}

      <HowCalculated>
        <p>
          <strong>Source.</strong> Box scores of this season&rsquo;s finished regular-season games.
          &ldquo;Last 5&rdquo; and &ldquo;last 10&rdquo; are the team&rsquo;s last games, not days.
          A player the box score does not list was not dressed.
        </p>
        <p>
          <strong>Teams.</strong> Fives counts the different starting fives used; changes counts
          games whose starters differed from the game before. Coach DNPs and 10+ minute players are
          per game over the last 10.
        </p>
        <p>
          <strong>Players.</strong> Starter means 4 or 5 starts in the team&rsquo;s last 5 games,
          spot starter 1 to 3. A traded player is shown with his current team, counting that
          team&rsquo;s games only.
        </p>
        <p>
          <strong>Role lost</strong> (▼): a coach&rsquo;s-decision DNP in either of the team&rsquo;s
          last 2 games for a player averaging 12+ minutes over the last 10, or a regular starter (4
          of the 5 games before) sent to the bench in the last 3.
        </p>
        <p>
          <strong>At risk</strong> (⚠): a starter with under 2.45 free-throw attempts per 36 minutes
          over his last 10 games and an effective FG% of .509 or lower over his last 5 (not flagged
          while he is injured or not dressed for the last game); a bench player on 12+ minutes with
          a plus-minus of −5.4 per 48 or worse and FG% of .425 or lower over his last 10; or minutes
          down: the median of his last 3 games 7 or more below his average (10 in his first 12
          games), for a player averaging 15+.
        </p>
        <p>
          <strong>Role up</strong> (▲): moved into the starting five in the last 3 games and still
          there, unless he started before an absence. When he replaced a starter who is out, it says
          whom (paired by position) and, from the injury report, when that starter is expected back.
          Minutes up: the median of his last 3 games 5 or more above his average, for a player under
          30.
        </p>
        <p>
          <strong>Limits.</strong> Positions used to pair a new starter with the one he replaced are
          the stats provider&rsquo;s. Rest and suspensions count as absences, not as coach&rsquo;s
          decisions.
        </p>
      </HowCalculated>
    </div>
  );
}
