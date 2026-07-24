'use client';

import { ChevronDown, ChevronRight, Clock3 } from 'lucide-react';
import { useId } from 'react';

import type {
  LeagueTradeDto,
  TradeActionName,
  TradeOfferPlayerDto,
  TradeRulesDto,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeOfferDetails } from './TradeOfferDetails';
import { TradeOfferStatus } from './TradeOfferStatus';
import { formatTradeDateTime } from './tradeDateFormatting';

interface TradeOfferCardProps {
  leagueId: string;
  trade: LeagueTradeDto;
  teams: TradeTeamDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  rules?: TradeRulesDto;
  isExpanded?: boolean;
  isPending: boolean;
  onExpandedChange?: () => void;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

export function TradeOfferCard({
  leagueId,
  trade,
  teams,
  playerStats,
  rules,
  isExpanded = false,
  isPending,
  onExpandedChange,
  onAction,
  onCounter,
}: TradeOfferCardProps): React.JSX.Element {
  const detailsId = useId();
  const offer = trade.currentOffer;
  const viewerTeam = teams.find((team) => team.isViewer);
  const viewerParty = [trade.memberOne, trade.memberTwo].find(
    (party) => party.memberId === viewerTeam?.memberId
  );
  const perspectiveParty =
    viewerParty ??
    [trade.memberOne, trade.memberTwo].find((party) => party.memberId === offer.proposerMemberId) ??
    trade.memberOne;
  const opponentParty =
    perspectiveParty.memberId === trade.memberOne.memberId ? trade.memberTwo : trade.memberOne;
  const perspectiveMemberId = perspectiveParty.memberId;
  const sendingHeading = viewerParty ? 'You send' : `${perspectiveParty.teamName} sends`;
  const receivingHeading = viewerParty ? 'You receive' : `${opponentParty.teamName} sends`;
  const sendingPlayers = offer.players.filter(
    (player) => player.fromMemberId === perspectiveMemberId
  );
  const receivingPlayers = offer.players.filter(
    (player) => player.toMemberId === perspectiveMemberId
  );
  const displayTitle = buildPackageTitle(sendingPlayers, receivingPlayers);

  return (
    <article className="bg-[color:var(--trade-surface)] text-[color:var(--trade-text)]">
      <header
        className={`grid min-w-0 gap-3 px-3 py-3 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:px-4 ${
          isExpanded
            ? 'bg-[color:var(--trade-action-soft)]/45'
            : 'hover:bg-[color:var(--trade-surface-subtle)]'
        }`}
      >
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${displayTitle}`}
          onClick={onExpandedChange}
          className="inline-flex size-11 items-center justify-center self-start rounded-md text-[color:var(--trade-text-muted)] transition-colors hover:bg-[color:var(--trade-action-soft)] hover:text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] sm:self-auto"
        >
          {isExpanded ? (
            <ChevronDown aria-hidden="true" className="size-5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-5" />
          )}
        </button>

        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--trade-text-muted)]">
            Offer {offer.sequence} · {opponentParty.teamName}
          </p>
          <h3 className="mt-1 truncate text-sm font-bold text-[color:var(--trade-text)] sm:text-base">
            {displayTitle}
          </h3>
          <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="truncate font-semibold text-[color:var(--trade-send)]">
              {sendingHeading} {formatPackageSummary(sendingPlayers)}
            </span>
            <span className="truncate font-semibold text-[color:var(--trade-receive)]">
              {receivingHeading} {formatPackageSummary(receivingPlayers)}
            </span>
          </div>
        </div>

        <div className="pl-14 sm:pl-0">
          <TradeOfferStatus status={trade.status} />
        </div>

        <div className="flex items-center gap-2 pl-14 text-xs text-[color:var(--trade-text-muted)] sm:min-w-44 sm:justify-end sm:pl-0">
          <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            Expires{' '}
            <span className="font-semibold text-[color:var(--trade-text)]">
              {formatTradeDateTime(offer.expiresAt)}
            </span>
          </span>
        </div>
      </header>

      {isExpanded && (
        <TradeOfferDetails
          id={detailsId}
          leagueId={leagueId}
          trade={trade}
          sendingPlayers={sendingPlayers}
          receivingPlayers={receivingPlayers}
          sendingHeading={sendingHeading}
          receivingHeading={receivingHeading}
          perspectiveTeamName={perspectiveParty.teamName}
          opponentTeamName={opponentParty.teamName}
          displayTitle={displayTitle}
          playerStats={playerStats}
          rules={rules}
          isPending={isPending}
          onAction={onAction}
          onCounter={onCounter}
        />
      )}
    </article>
  );
}

function buildPackageTitle(
  sendingPlayers: TradeOfferPlayerDto[],
  receivingPlayers: TradeOfferPlayerDto[]
): string {
  return `${formatPackageTitle(sendingPlayers)} ↔ ${formatPackageTitle(receivingPlayers)}`;
}

function formatPackageTitle(players: TradeOfferPlayerDto[]): string {
  if (players.length === 0) return 'No players';
  const visibleNames = players.slice(0, 2).map((player) => lastName(player.name));
  const remaining = players.length - visibleNames.length;
  return `${visibleNames.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}`;
}

function formatPackageSummary(players: TradeOfferPlayerDto[]): string {
  if (players.length === 0) return 'no players';
  if (players.length === 1) return players[0].name;
  return `${players.length} players · ${players
    .slice(0, 2)
    .map((player) => lastName(player.name))
    .join(', ')}${players.length > 2 ? ` +${players.length - 2}` : ''}`;
}

function lastName(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? name;
}
