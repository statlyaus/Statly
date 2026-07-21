'use client';

import type {
  LeagueTradeDto,
  TradeActionName,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeOfferCard } from './TradeOfferCard';

interface TradeCardsProps {
  leagueId: string;
  trades: LeagueTradeDto[];
  teams: TradeTeamDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  pendingTradeId?: string | null;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

export function TradeCards({
  leagueId,
  trades,
  teams,
  playerStats,
  pendingTradeId,
  onAction,
  onCounter,
}: TradeCardsProps): React.JSX.Element {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Trade offers will appear here as managers take action.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {trades.map((trade) => (
        <TradeOfferCard
          key={trade.id}
          leagueId={leagueId}
          trade={trade}
          teams={teams}
          playerStats={playerStats}
          isPending={pendingTradeId === trade.id}
          onAction={onAction}
          onCounter={onCounter}
        />
      ))}
    </div>
  );
}
