import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';
import type { LeagueTradeDto } from '@/server/leagues/trades/tradeContracts';

interface TradeOfferAssetsProps {
  heading: string;
  teamName: string;
  players: LeagueTradeDto['currentOffer']['players'];
  playerStats: LeaguePlayerStatDatasetDto;
  direction?: 'send' | 'receive';
}

export function TradeOfferAssets({
  heading,
  teamName,
  players,
  playerStats,
  direction = heading.toLowerCase().includes('send') ? 'send' : 'receive',
}: TradeOfferAssetsProps): React.JSX.Element {
  const isSending = direction === 'send';
  const DirectionIcon = isSending ? ArrowUpRight : ArrowDownLeft;
  const accent = isSending ? 'var(--trade-send)' : 'var(--trade-receive)';
  const accentSoft = isSending ? 'var(--trade-send-soft)' : 'var(--trade-receive-soft)';

  return (
    <section
      aria-label={`${heading} package from ${teamName}`}
      className="min-w-0 overflow-hidden rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
    >
      <div
        className="flex items-start justify-between gap-3 border-b border-[color:var(--trade-border)] px-3 py-2.5"
        style={{ backgroundColor: accentSoft }}
      >
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-bold" style={{ color: accent }}>
            <DirectionIcon aria-hidden="true" className="size-4 shrink-0" />
            {heading}
          </h4>
          <p className="mt-0.5 truncate text-xs text-[color:var(--trade-text-muted)]">{teamName}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-[color:var(--trade-text-muted)]">
          {playerStats.context.season} season
        </span>
      </div>

      {players.length === 0 ? (
        <p className="p-4 text-sm text-[color:var(--trade-text-muted)]">
          No players from this team
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--trade-border)]">
          {players.map((player) => {
            const gamesPlayed = playerStats.playersById[player.id]?.gamesPlayed;
            return (
              <li
                key={player.id}
                className="flex min-w-0 items-center justify-between gap-4 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--trade-text)]">
                    {player.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[color:var(--trade-text-muted)]">
                    {[player.club, player.position].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-bold tabular-nums text-[color:var(--trade-text)]">
                    {formatGamesPlayed(gamesPlayed)}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-[color:var(--trade-text-muted)]">
                    sample size
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatGamesPlayed(gamesPlayed: number | null | undefined): string {
  return typeof gamesPlayed === 'number' ? `${gamesPlayed} GP` : 'GP unavailable';
}
