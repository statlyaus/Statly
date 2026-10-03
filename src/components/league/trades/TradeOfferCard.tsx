'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId } from 'react';

import { TeamMark } from '@/components/scores/MatchupScore';
import type {
  LeagueTradeDto,
  TradeActionName,
  TradeOfferPlayerDto,
  TradeRulesDto,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeOfferActions } from './TradeOfferActions';
import { TradeOfferDetails } from './TradeOfferDetails';
import { TradeOfferStatus } from './TradeOfferStatus';
import { VERDICT_TONE_CLASS } from './TradeVerdictStrip';
import { formatTradeDateTime } from './tradeDateFormatting';
import { buildTradeVerdict, type TradeVerdict } from './tradeVerdict';

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
  const youLabel = viewerParty ? 'you' : perspectiveParty.teamName;
  const verdict = fromPerspective(
    buildTradeVerdict(
      sendingPlayers.map((player) => player.id),
      receivingPlayers.map((player) => player.id),
      playerStats
    ),
    youLabel
  );
  const perspectiveSquad =
    teams.find((team) => team.memberId === perspectiveMemberId)?.players ?? null;

  return (
    <article className="bg-[color:var(--trade-surface)] text-[color:var(--trade-text)]">
      <header
        className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-3 py-3 transition-colors sm:px-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center ${
          isExpanded ? '' : 'hover:bg-[color:var(--trade-surface-subtle)]'
        }`}
      >
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${displayTitle}`}
          onClick={onExpandedChange}
          className="inline-flex size-11 items-center justify-center self-start rounded-md text-[color:var(--trade-text-muted)] transition-colors hover:bg-[color:var(--trade-action-soft)] hover:text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)] lg:self-auto"
        >
          {isExpanded ? (
            <ChevronDown aria-hidden="true" className="size-5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-5" />
          )}
        </button>

        <div className="flex min-w-0 items-start gap-3">
          <TeamMark teamName={opponentParty.teamName} logoUrl={null} />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[color:var(--trade-text-muted)]">
              {`${opponentParty.teamName} · Offer ${offer.sequence}`}
            </p>
            <h3 className="truncate font-display text-lg font-bold leading-tight text-[color:var(--trade-text)]">
              {displayTitle}
            </h3>
            <p className="truncate text-xs text-[color:var(--trade-text-muted)]">
              {sendingHeading}{' '}
              <span className="font-semibold text-[color:var(--trade-text)]">
                {formatPackageSummary(sendingPlayers)}
              </span>{' '}
              · {receivingHeading}{' '}
              <span className="font-semibold text-[color:var(--trade-text)]">
                {formatPackageSummary(receivingPlayers)}
              </span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                className={`rounded-full border border-current px-2 py-0.5 font-bold ${VERDICT_TONE_CLASS[verdict.tone]}`}
              >
                {verdict.short}
              </span>
              <TradeOfferStatus status={trade.status} />
              <span className="text-[color:var(--trade-text-muted)]">
                Expires{' '}
                <span className="font-semibold text-[color:var(--trade-text)]">
                  {formatTradeDateTime(offer.expiresAt)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="col-start-2 lg:col-start-auto">
          <TradeOfferActions
            trade={trade}
            title={displayTitle}
            isPending={isPending}
            onAction={onAction}
            onCounter={onCounter}
          />
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
          verdict={verdict}
          youLabel={youLabel}
          perspectiveSquad={perspectiveSquad}
          rules={rules}
        />
      )}
    </article>
  );
}

/** Verdict wording is written for "you"; a commissioner reads it for the proposing team. */
function fromPerspective(verdict: TradeVerdict, youLabel: string): TradeVerdict {
  if (youLabel === 'you') return verdict;
  return {
    ...verdict,
    headline: verdict.headline.replace('for you', `for ${youLabel}`),
    short: verdict.short.replace(/\byou\b/, youLabel),
  };
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
