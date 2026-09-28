import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';
import type { LeagueTradeDto } from '@/server/leagues/trades/tradeContracts';

import { TradePlayerChip } from './TradePlayerChip';

interface TradeOfferAssetsProps {
  heading: string;
  teamName: string;
  players: LeagueTradeDto['currentOffer']['players'];
  playerStats: LeaguePlayerStatDatasetDto;
  direction?: 'send' | 'receive';
}

/** One side of a trade: the heading and team, then one divider row per player. */
export function TradeOfferAssets({
  heading,
  teamName,
  players,
  playerStats,
}: TradeOfferAssetsProps): React.JSX.Element {
  return (
    <section aria-label={`${heading} package from ${teamName}`} className="min-w-0">
      <div className="flex items-baseline gap-2 border-b border-[color:var(--trade-border)] pb-2">
        <h4 className="text-sm font-semibold text-[color:var(--trade-text)]">{heading}</h4>
        <p className="truncate text-xs text-[color:var(--trade-text-muted)]">{teamName}</p>
      </div>
      {players.length === 0 ? (
        <p className="py-3 text-sm text-[color:var(--trade-text-muted)]">No players</p>
      ) : (
        <ul className="divide-y divide-[color:var(--trade-border)]">
          {players.map((player) => (
            <li key={player.id}>
              <TradePlayerChip player={player} playerStats={playerStats} bare />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
