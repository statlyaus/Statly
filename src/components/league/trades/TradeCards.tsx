'use client';

import type {
  LeagueTradeDto,
  TradeActionName,
  TradeRulesDto,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';
import { useState } from 'react';

import { TradeOfferCard } from './TradeOfferCard';

interface TradeCardsProps {
  leagueId: string;
  trades: LeagueTradeDto[];
  teams: TradeTeamDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  rules: TradeRulesDto;
  pendingTradeId?: string | null;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

export function TradeCards({
  leagueId,
  trades,
  teams,
  playerStats,
  rules,
  pendingTradeId,
  onAction,
  onCounter,
}: TradeCardsProps): React.JSX.Element {
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(
    () => trades[0]?.id ?? null
  );

  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] px-5 py-8 text-center">
        <p className="text-sm font-bold text-[color:var(--trade-text)]">No offers</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--trade-text-muted)]">
          Offers you send or receive show here.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[color:var(--trade-border)] overflow-hidden rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]">
      {trades.map((trade) => (
        <TradeOfferCard
          key={trade.id}
          leagueId={leagueId}
          trade={trade}
          teams={teams}
          playerStats={playerStats}
          rules={rules}
          isExpanded={expandedTradeId === trade.id}
          isPending={pendingTradeId === trade.id}
          onExpandedChange={() =>
            setExpandedTradeId((currentId) => (currentId === trade.id ? null : trade.id))
          }
          onAction={onAction}
          onCounter={onCounter}
        />
      ))}
    </div>
  );
}
