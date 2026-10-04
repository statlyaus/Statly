import { X } from 'lucide-react';

import { GuernseyIcon } from '@/components/league/myteam/FieldArt';
import { guernseyFor } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { standoutStat } from './tradeVerdict';

/**
 * A player in a trade: club guernsey, name, position and club, and the stat they stand out in.
 * The compact form (trays) drops the stat and can offer a remove button.
 */
export function TradePlayerChip({
  player,
  playerStats,
  compact = false,
  bare = false,
  onRemove,
}: {
  player: Pick<TradePlayerDto, 'id' | 'name' | 'club' | 'position'>;
  playerStats?: LeaguePlayerStatDatasetDto;
  compact?: boolean;
  /** No box: for lists that already separate rows with dividers. */
  bare?: boolean;
  onRemove?: () => void;
}): React.JSX.Element {
  const standout = !compact && playerStats ? standoutStat(player.id, playerStats) : null;
  const club = player.club ? getTeamAbbreviation(player.club) : null;
  return (
    <span
      className={`flex min-w-0 items-center gap-2.5 ${
        bare
          ? 'py-2'
          : `rounded-md border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] ${
              compact ? 'py-1 pl-1.5 pr-1' : 'px-2.5 py-2'
            }`
      }`}
    >
      <GuernseyIcon
        guernsey={guernseyFor(player.club)}
        className={compact ? 'h-7 w-6 shrink-0' : 'h-9 w-8 shrink-0'}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[color:var(--trade-text)]">
          {compact ? (player.name.trim().split(/\s+/).at(-1) ?? player.name) : player.name}
        </span>
        <span className="block truncate text-xs text-[color:var(--trade-text-muted)]">
          {[player.position, club].filter(Boolean).join(' · ')}
        </span>
      </span>
      {standout ? (
        <span className="shrink-0 text-right" title={`${standout.label} per game`}>
          <span className="block text-sm font-bold tabular-nums text-[color:var(--trade-text)]">
            {standout.formatted}
          </span>
          <span className="block text-[0.6875rem] text-[color:var(--trade-text-muted)]">
            {standout.label}
          </span>
        </span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${player.name}`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded text-[color:var(--trade-text-muted)] hover:bg-[color:var(--trade-action-soft)] hover:text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)]"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </span>
  );
}
