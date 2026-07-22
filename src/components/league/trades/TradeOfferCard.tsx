'use client';

import { ArrowLeftRight, Clock3, ShieldCheck } from 'lucide-react';

import { LeagueSocialDiscussButton } from '@/components/league/LeagueSocialDiscussButton';
import type {
  LeagueTradeDto,
  TradeActionName,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeOfferAssets, type TradeOfferAssetTone } from './TradeOfferAssets';
import { TRADE_STATUS_LABELS, TradeOfferStatus } from './TradeOfferStatus';

interface TradeOfferCardProps {
  leagueId: string;
  trade: LeagueTradeDto;
  teams: TradeTeamDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  isPending: boolean;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

const ACTION_LABELS: Record<Exclude<TradeActionName, 'counter'>, string> = {
  accept: 'Accept trade',
  decline: 'Decline',
  withdraw: 'Withdraw',
  approve: 'Approve trade',
  reject: 'Reject trade',
  veto: 'Veto trade',
};

export function TradeOfferCard({
  leagueId,
  trade,
  teams,
  playerStats,
  isPending,
  onAction,
  onCounter,
}: TradeOfferCardProps): React.JSX.Element {
  const offer = trade.currentOffer;
  const memberOne = teams.find((team) => team.memberId === trade.memberOne.memberId);
  const memberTwo = teams.find((team) => team.memberId === trade.memberTwo.memberId);
  const title = `${trade.memberOne.teamName} and ${trade.memberTwo.teamName}`;
  const displayTitle = memberOne?.isViewer
    ? `Trade with ${trade.memberTwo.teamName}`
    : memberTwo?.isViewer
      ? `Trade with ${trade.memberOne.teamName}`
      : `${trade.memberOne.teamName} ↔ ${trade.memberTwo.teamName}`;
  const memberOnePresentation = assetPresentation(
    trade.memberOne.teamName,
    Boolean(memberOne?.isViewer),
    Boolean(memberTwo?.isViewer)
  );
  const memberTwoPresentation = assetPresentation(
    trade.memberTwo.teamName,
    Boolean(memberTwo?.isViewer),
    Boolean(memberOne?.isViewer)
  );

  return (
    <article className="overflow-hidden rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] text-[color:var(--trade-text)] shadow-[var(--trade-card-shadow)]">
      <header className="flex flex-col gap-4 border-b border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--trade-action-soft)] text-[color:var(--trade-action)]">
            <ArrowLeftRight aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--trade-text-muted)]">
              Offer {offer.sequence} · {formatDate(offer.createdAt)}
            </p>
            <h3 className="mt-1 text-base font-bold text-[color:var(--trade-text)]">
              {displayTitle}
            </h3>
          </div>
        </div>
        <TradeOfferStatus status={trade.status} />
      </header>

      <div className="grid min-w-0 gap-4 p-4 sm:p-5 xl:grid-cols-2">
        <TradeOfferAssets
          heading={memberOnePresentation.heading}
          teamName={trade.memberOne.teamName}
          players={offer.players.filter(
            (player) => player.fromMemberId === trade.memberOne.memberId
          )}
          playerStats={playerStats}
          tone={memberOnePresentation.tone}
        />
        <TradeOfferAssets
          heading={memberTwoPresentation.heading}
          teamName={trade.memberTwo.teamName}
          players={offer.players.filter(
            (player) => player.fromMemberId === trade.memberTwo.memberId
          )}
          playerStats={playerStats}
          tone={memberTwoPresentation.tone}
        />
      </div>

      {offer.message && (
        <blockquote className="mx-4 mb-4 rounded-lg border-l-[3px] border-[color:var(--trade-action)] bg-[color:var(--trade-action-soft)] px-4 py-3 text-sm leading-5 text-[color:var(--trade-text-muted)] sm:mx-5 sm:mb-5">
          {offer.message}
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-4 text-xs font-medium text-[color:var(--trade-text-muted)] sm:px-5 sm:pb-5">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 aria-hidden="true" className="size-3.5" />
          Expires {formatDate(offer.expiresAt)}
        </span>
        {offer.reviewEndsAt && (
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            Review ends {formatDate(offer.reviewEndsAt)}
          </span>
        )}
        {trade.status === 'ACCEPTED_PENDING_REVIEW' && offer.reviewMode === 'veto' && (
          <span>
            {offer.vetoCount} of {offer.vetoThreshold} vetoes
          </span>
        )}
        {memberOne?.isViewer && <span>You manage {memberOne.teamName}</span>}
        {memberTwo?.isViewer && <span>You manage {memberTwo.teamName}</span>}
      </div>

      <footer
        aria-label={`Actions for ${title}`}
        className="flex flex-wrap gap-2 border-t border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 py-3 sm:px-5"
      >
        {trade.allowedActions.map((action) =>
          action === 'counter' ? (
            <button
              key={action}
              type="button"
              disabled={isPending}
              onClick={() => onCounter(trade)}
              className={secondaryButtonClasses}
            >
              Counteroffer
            </button>
          ) : (
            <button
              key={action}
              type="button"
              disabled={isPending}
              onClick={() => onAction(trade, action)}
              className={
                action === 'accept' || action === 'approve'
                  ? primaryButtonClasses
                  : secondaryButtonClasses
              }
            >
              {isPending ? 'Working…' : ACTION_LABELS[action]}
            </button>
          )
        )}
        <LeagueSocialDiscussButton
          leagueId={leagueId}
          label="Discuss trade"
          context={{
            type: 'trade',
            id: trade.id,
            title,
            subtitle: TRADE_STATUS_LABELS[trade.status],
            metadata: { offerId: offer.id, status: trade.status },
          }}
          className="!min-h-11 !rounded-lg !border-[color:var(--trade-border-strong)] !bg-[color:var(--trade-surface)] !px-4 !text-sm !text-[color:var(--trade-text)] hover:!bg-[color:var(--trade-action-soft)] focus-visible:!ring-[3px] focus-visible:!ring-[color:var(--trade-focus)]"
        />
      </footer>

      {(trade.offerHistory.length > 1 || trade.events.length > 0) && (
        <details className="border-t border-[color:var(--trade-border)] px-4 py-3 sm:px-5">
          <summary className="cursor-pointer rounded text-sm font-semibold text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]">
            Trade history
          </summary>
          {trade.offerHistory.length > 1 && <TradeOfferHistory trade={trade} />}
          {trade.events.length > 0 && (
            <section aria-label="Trade decisions" className="mt-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-[color:var(--trade-text-muted)]">
                Decisions
              </h4>
              <ol className="mt-2 space-y-2 border-l border-[color:var(--trade-border)] pl-4 text-xs text-[color:var(--trade-text-muted)]">
                {trade.events.map((event) => (
                  <li key={event.id}>
                    <span className="font-semibold text-[color:var(--trade-text)]">
                      {formatLifecycleLabel(event.type)}
                    </span>{' '}
                    · {formatDate(event.createdAt)}
                    {event.reason && (
                      <p className="mt-1 text-[color:var(--trade-text)]">Reason: {event.reason}</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </details>
      )}
    </article>
  );
}

function TradeOfferHistory({ trade }: { trade: LeagueTradeDto }): React.JSX.Element {
  const offers = [...trade.offerHistory].sort((left, right) => left.sequence - right.sequence);
  return (
    <section aria-label="Previous offer terms" className="mt-4">
      <h4 className="text-xs font-bold uppercase tracking-wide text-[color:var(--trade-text-muted)]">
        Offer terms
      </h4>
      <ol className="mt-2 space-y-3">
        {offers.map((offer) => (
          <li
            key={offer.id}
            className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-3 text-xs"
          >
            <p className="font-semibold text-[color:var(--trade-text)]">
              Offer {offer.sequence} · {formatLifecycleLabel(offer.status)} ·{' '}
              {formatDate(offer.createdAt)}
            </p>
            <p className="mt-1 text-[color:var(--trade-text-muted)]">
              {offer.players.map((player) => player.name).join(', ')}
            </p>
            {offer.message && (
              <blockquote className="mt-2 border-l-2 border-[color:var(--trade-action)] pl-2 text-[color:var(--trade-text-muted)]">
                {offer.message}
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function assetPresentation(
  teamName: string,
  isViewer: boolean,
  otherTeamIsViewer: boolean
): { heading: string; tone: TradeOfferAssetTone } {
  if (isViewer) return { heading: 'You send', tone: 'outgoing' };
  if (otherTeamIsViewer) return { heading: `You receive from ${teamName}`, tone: 'incoming' };
  return { heading: `${teamName} sends`, tone: 'neutral' };
}

function formatLifecycleLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const primaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-4 text-sm font-bold text-white transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const secondaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
