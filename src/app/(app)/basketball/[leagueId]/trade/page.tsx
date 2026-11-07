import type { Metadata } from 'next';

import {
  EmptyState,
  HowCalculated,
  PageHeading,
  StaleStatsNotice,
} from '@/components/basketball/analysis/AnalysisBits';
import { listParam, type SearchParams } from '@/components/basketball/analysis/searchParams';
import { TradeBuilder, type TradePlayerOption } from '@/components/basketball/trade/TradeBuilder';
import { TradeResult } from '@/components/basketball/trade/TradeResult';
import { TRADE_EVEN_BAND } from '@/lib/basketball/trade';
import { loadLeagueForPage } from '@/server/basketball/readModels/leaguePage';
import type { PoolPlayer } from '@/server/basketball/readModels/playerPool';
import { loadTrade, MAX_TRADE_PLAYERS } from '@/server/basketball/readModels/tradeModel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Trade check | Fantasy basketball | Statly' };

function toOption(player: PoolPlayer): TradePlayerOption {
  const holder =
    player.owner.kind === 'FREE_AGENT'
      ? 'Free agent'
      : player.owner.kind === 'ELSEWHERE'
        ? 'Rostered elsewhere'
        : (player.owner.teamName ?? '');
  return {
    playerId: player.playerId,
    fullName: player.fullName,
    teamCode: player.teamCode,
    value: player.value,
    holder,
  };
}

export default async function BasketballTradePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const path = `/basketball/${encodeURIComponent(leagueId)}/trade`;
  const { league } = await loadLeagueForPage(leagueId, path);
  const now = new Date();
  const view = await loadTrade(league, {
    give: listParam(query, 'give'),
    get: listParam(query, 'get'),
  });

  return (
    <div className="space-y-5">
      <PageHeading title="Trade check">
        Weigh what you give against what you get, category by category, on season value and your
        punts.
      </PageHeading>
      <StaleStatsNotice updatedAt={view.pool.statsUpdatedAt} now={now} />

      {view.pool.players.length === 0 ? (
        <EmptyState title="NBA stats haven't been loaded yet">
          Trade values appear once box scores are in.
        </EmptyState>
      ) : (
        <>
          <TradeBuilder
            path={path}
            params={query}
            myPlayers={view.myPlayers.map(toOption)}
            otherPlayers={view.otherPlayers.map(toOption)}
            give={view.give.map((player) => player.playerId)}
            get={view.get.map((player) => player.playerId)}
            max={MAX_TRADE_PLAYERS}
          />
          {view.evaluation ? (
            <TradeResult evaluation={view.evaluation} />
          ) : (
            <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Pick players to give, get, or both to see the trade by category.
            </p>
          )}
        </>
      )}

      <HowCalculated>
        <p>
          <strong>Each category</strong> adds up the season z-scores (from the Players page) of the
          players you get and subtracts those you give. A net within {TRADE_EVEN_BAND} either way is
          even. Punted categories are shown but left out of the total.
        </p>
        <p>
          <strong>Limits.</strong> This is season value only: it ignores this week&rsquo;s schedule,
          injuries, and what you would do with a freed or extra roster spot. Each category is valued
          on its own.
        </p>
      </HowCalculated>
    </div>
  );
}
