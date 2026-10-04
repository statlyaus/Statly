'use client';

import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';

import { LeagueSocialDiscussButton } from '@/components/league/LeagueSocialDiscussButton';
import type {
  LeagueTradeDto,
  TradeOfferPlayerDto,
  TradePlayerDto,
  TradeRulesDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';
import { TradeOfferAssets } from './TradeOfferAssets';
import { TRADE_STATUS_LABELS } from './TradeOfferStatus';
import { TradeSquadImpact, TradeVerdictStrip } from './TradeVerdictStrip';
import { formatTradeDateTime } from './tradeDateFormatting';
import { squadPositionImpact, type TradeVerdict } from './tradeVerdict';

interface TradeOfferDetailsProps {
  id: string;
  leagueId: string;
  trade: LeagueTradeDto;
  sendingPlayers: TradeOfferPlayerDto[];
  receivingPlayers: TradeOfferPlayerDto[];
  sendingHeading: string;
  receivingHeading: string;
  perspectiveTeamName: string;
  opponentTeamName: string;
  displayTitle: string;
  playerStats: LeaguePlayerStatDatasetDto;
  verdict: TradeVerdict;
  /** "you", or the proposing team when a commissioner is reviewing. */
  youLabel: string;
  /** The perspective team's current squad, for the position impact; null when unknown. */
  perspectiveSquad: TradePlayerDto[] | null;
  /** League rules are summarised once in the Trade Centre header, not repeated per offer. */
  rules?: TradeRulesDto;
}

/**
 * An expanded offer: what each side gives, the verdict, what it does to the squad, the message,
 * and the full numbers on request. Decisions live in the offer header.
 */
export function TradeOfferDetails({
  id,
  leagueId,
  trade,
  sendingPlayers,
  receivingPlayers,
  sendingHeading,
  receivingHeading,
  perspectiveTeamName,
  opponentTeamName,
  displayTitle,
  playerStats,
  verdict,
  youLabel,
  perspectiveSquad,
}: TradeOfferDetailsProps): React.JSX.Element {
  const breakdownId = useId();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const offer = trade.currentOffer;
  const proposerTeamName =
    offer.proposerMemberId === trade.memberOne.memberId
      ? trade.memberOne.teamName
      : trade.memberTwo.teamName;

  return (
    <div id={id} className="border-t border-[color:var(--trade-border)]">
      <div className="grid min-w-0 gap-x-6 gap-y-4 px-4 pt-4 sm:px-5 lg:grid-cols-2">
        <TradeOfferAssets
          heading={sendingHeading}
          teamName={perspectiveTeamName}
          players={sendingPlayers}
          playerStats={playerStats}
          direction="send"
        />
        <TradeOfferAssets
          heading={receivingHeading}
          teamName={opponentTeamName}
          players={receivingPlayers}
          playerStats={playerStats}
          direction="receive"
        />
      </div>

      {offer.message && (
        <figure className="mx-4 mt-4 border-l-2 border-[color:var(--trade-border-strong)] pl-3 sm:mx-5">
          <figcaption className="text-xs font-semibold text-[color:var(--trade-text-muted)]">
            Note from {proposerTeamName}
          </figcaption>
          <blockquote className="mt-0.5 text-sm leading-5 text-[color:var(--trade-text)]">
            {offer.message}
          </blockquote>
        </figure>
      )}

      <div className="mx-4 mt-4 grid min-w-0 gap-x-10 gap-y-5 border-t border-[color:var(--trade-border)] pt-4 sm:mx-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <TradeVerdictStrip
          verdict={verdict}
          otherSide={opponentTeamName}
          youLabel={youLabel}
          season={playerStats.context.season}
          compact
        />
        {perspectiveSquad ? (
          <TradeSquadImpact
            changes={squadPositionImpact(perspectiveSquad, sendingPlayers, receivingPlayers)}
            teamLabel={youLabel === 'you' ? 'Your squad' : `${youLabel}'s squad`}
            showBasis={false}
          />
        ) : null}
      </div>
      <p className="mx-4 mt-3 text-xs text-[color:var(--trade-text-muted)] sm:mx-5">
        Per-game averages, {playerStats.context.season} season. Dual-position players count in both.
      </p>

      <div className="px-4 pb-4 pt-2 sm:px-5">
        <button
          type="button"
          aria-expanded={showBreakdown}
          aria-controls={breakdownId}
          onClick={() => setShowBreakdown((current) => !current)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-[color:var(--trade-text)] hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)]"
        >
          {showBreakdown ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4" />
          )}
          All categories
        </button>
        {showBreakdown ? (
          <div id={breakdownId} className="mt-2">
            <TradeComparisonTable
              sendingTeamName={sendingHeading}
              receivingTeamName={receivingHeading}
              sendingPlayerIds={sendingPlayers.map((player) => player.id)}
              receivingPlayerIds={receivingPlayers.map((player) => player.id)}
              playerStats={playerStats}
            />
          </div>
        ) : null}
      </div>

      {(offer.reviewEndsAt ||
        (trade.status === 'ACCEPTED_PENDING_REVIEW' && offer.reviewMode === 'veto')) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-4 text-xs font-medium text-[color:var(--trade-text-muted)] sm:px-5">
          {offer.reviewEndsAt && (
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Review ends {formatTradeDateTime(offer.reviewEndsAt)}
            </span>
          )}
          {trade.status === 'ACCEPTED_PENDING_REVIEW' && offer.reviewMode === 'veto' && (
            <span>
              {offer.vetoCount} of {offer.vetoThreshold} vetoes
            </span>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 py-2 sm:px-5">
        <LeagueSocialDiscussButton
          leagueId={leagueId}
          label="Discuss trade"
          context={{
            type: 'trade',
            id: trade.id,
            title: displayTitle,
            subtitle: TRADE_STATUS_LABELS[trade.status],
            metadata: { offerId: offer.id, status: trade.status },
          }}
          className="!min-h-11 !rounded-md !border-transparent !bg-transparent !px-3 !text-sm !text-[color:var(--trade-text)] hover:!bg-[color:var(--trade-action-soft)] focus-visible:!ring-2 focus-visible:!ring-[color:var(--trade-focus)]"
        />
      </footer>

      {(trade.offerHistory.length > 1 || trade.events.length > 0) && <TradeHistory trade={trade} />}
    </div>
  );
}

function TradeHistory({ trade }: { trade: LeagueTradeDto }): React.JSX.Element {
  const offers = [...trade.offerHistory].sort((left, right) => left.sequence - right.sequence);

  return (
    <details className="border-t border-[color:var(--trade-border)] px-4 py-3 sm:px-5">
      <summary className="cursor-pointer rounded text-sm font-semibold text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)]">
        Trade history
      </summary>
      {offers.length > 1 && (
        <section aria-label="Previous offer terms" className="mt-4">
          <h4 className="text-sm font-semibold text-[color:var(--trade-text)]">Offer terms</h4>
          <ol className="mt-2 divide-y divide-[color:var(--trade-border)] border-y border-[color:var(--trade-border)]">
            {offers.map((offer) => (
              <li key={offer.id} className="py-2.5 text-xs">
                <p className="font-semibold text-[color:var(--trade-text)]">
                  Offer {offer.sequence} · {formatLifecycleLabel(offer.status)} ·{' '}
                  {formatTradeDateTime(offer.createdAt)}
                </p>
                <p className="mt-1 text-[color:var(--trade-text-muted)]">
                  {offer.players.map((player) => player.name).join(', ')}
                </p>
                {offer.message && (
                  <blockquote className="mt-2 border-l-2 border-[color:var(--trade-border-strong)] pl-2 text-[color:var(--trade-text-muted)]">
                    {offer.message}
                  </blockquote>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {trade.events.length > 0 && (
        <section aria-label="Trade decisions" className="mt-4">
          <h4 className="text-sm font-semibold text-[color:var(--trade-text)]">Decisions</h4>
          <ol className="mt-2 space-y-2 border-l border-[color:var(--trade-border)] pl-4 text-xs text-[color:var(--trade-text-muted)]">
            {trade.events.map((event) => (
              <li key={event.id}>
                <span className="font-semibold text-[color:var(--trade-text)]">
                  {formatLifecycleLabel(event.type)}
                </span>{' '}
                · {formatTradeDateTime(event.createdAt)}
                {event.reason && (
                  <p className="mt-1 text-[color:var(--trade-text)]">Reason: {event.reason}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </details>
  );
}

function formatLifecycleLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}
