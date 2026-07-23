'use client';

import { Handshake } from 'lucide-react';

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
      <div className="rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] px-5 py-10 text-center shadow-[var(--trade-card-shadow)]">
        <span className="mx-auto flex size-11 items-center justify-center rounded-lg bg-[color:var(--trade-action-soft)] text-[color:var(--trade-action)]">
          <Handshake aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-4 text-sm font-bold text-[color:var(--trade-text)]">Nothing here yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--trade-text-muted)]">
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
