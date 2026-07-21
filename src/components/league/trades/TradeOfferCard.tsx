'use client';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { LeagueSocialDiscussButton } from '@/components/league/LeagueSocialDiscussButton';
import type {
  LeagueTradeDto,
  TradeActionName,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

interface TradeOfferCardProps {
  leagueId: string;
  trade: LeagueTradeDto;
  teams: TradeTeamDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  isPending: boolean;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

const STATUS_LABELS: Record<LeagueTradeDto['status'], string> = {
  PENDING: 'Awaiting response',
  ACCEPTED_PENDING_REVIEW: 'Accepted · review pending',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
  COMMISSIONER_REJECTED: 'Commissioner rejected',
  VETOED: 'Vetoed',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};

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

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <header className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Offer {offer.sequence} · {formatDate(offer.createdAt)}
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {trade.memberOne.teamName} ↔ {trade.memberTwo.teamName}
          </h3>
        </div>
        <span className="w-fit rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
          {STATUS_LABELS[trade.status]}
        </span>
      </header>

      <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-2">
        <TradeAssets
          teamName={trade.memberOne.teamName}
          players={offer.players.filter(
            (player) => player.fromMemberId === trade.memberOne.memberId
          )}
          playerStats={playerStats}
        />
        <TradeAssets
          teamName={trade.memberTwo.teamName}
          players={offer.players.filter(
            (player) => player.fromMemberId === trade.memberTwo.memberId
          )}
          playerStats={playerStats}
        />
      </div>

      {offer.message && (
        <blockquote className="mx-4 mb-4 rounded-md border-l-4 border-primary/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {offer.message}
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-4 text-xs text-muted-foreground">
        <span>Expires {formatDate(offer.expiresAt)}</span>
        {offer.reviewEndsAt && <span>Review ends {formatDate(offer.reviewEndsAt)}</span>}
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
        className="flex flex-wrap gap-2 border-t border-border bg-muted/20 px-4 py-3"
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
            subtitle: STATUS_LABELS[trade.status],
            metadata: { offerId: offer.id, status: trade.status },
          }}
        />
      </footer>

      {(trade.offerHistory.length > 1 || trade.events.length > 0) && (
        <details className="border-t border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Trade history
          </summary>
          {trade.offerHistory.length > 1 && <TradeOfferHistory trade={trade} />}
          {trade.events.length > 0 && (
            <section aria-label="Trade decisions" className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Decisions
              </h4>
              <ol className="mt-2 space-y-2 border-l border-border pl-4 text-xs text-muted-foreground">
                {trade.events.map((event) => (
                  <li key={event.id}>
                    <span className="font-medium text-foreground">
                      {formatLifecycleLabel(event.type)}
                    </span>{' '}
                    · {formatDate(event.createdAt)}
                    {event.reason && <p className="mt-1 text-foreground">Reason: {event.reason}</p>}
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

function TradeAssets({
  teamName,
  players,
  playerStats,
}: {
  teamName: string;
  players: LeagueTradeDto['currentOffer']['players'];
  playerStats: LeaguePlayerStatDatasetDto;
}): React.JSX.Element {
  return (
    <section
      aria-label={`Players sent by ${teamName}`}
      className="min-w-0 rounded-lg border border-border"
    >
      <h4 className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
        {teamName} sends
      </h4>
      {players.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No players from this team</p>
      ) : (
        <>
          {/* A focus target is required so keyboard users can scroll the wide asset table. */}
          <div
            tabIndex={0}
            aria-label={`${teamName} player averages, horizontally scrollable`}
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <table className="w-full min-w-max text-left text-xs">
              <caption className="sr-only">
                Season {playerStats.context.season} per-game averages.
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2">
                    Player
                  </th>
                  {playerStats.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className="px-3 py-2 text-right"
                      title={column.label}
                    >
                      {column.shortLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2 font-medium text-foreground">
                      {player.name}
                      <span className="block font-normal text-muted-foreground">
                        {[player.position, player.club].filter(Boolean).join(' · ')}
                      </span>
                    </th>
                    {playerStats.columns.map((column) => (
                      <td key={column.key} className="px-3 py-2 text-right tabular-nums">
                        {formatStatValue(
                          playerStats.playersById[player.id]?.values[column.key],
                          FANTASY_CATEGORIES[column.key]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TradeOfferHistory({ trade }: { trade: LeagueTradeDto }): React.JSX.Element {
  const offers = [...trade.offerHistory].sort((left, right) => left.sequence - right.sequence);
  return (
    <section aria-label="Previous offer terms" className="mt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Offer terms
      </h4>
      <ol className="mt-2 space-y-3">
        {offers.map((offer) => (
          <li key={offer.id} className="rounded-md border border-border bg-muted/20 p-3 text-xs">
            <p className="font-medium text-foreground">
              Offer {offer.sequence} · {formatLifecycleLabel(offer.status)} ·{' '}
              {formatDate(offer.createdAt)}
            </p>
            <p className="mt-1 text-muted-foreground">
              {offer.players.map((player) => player.name).join(', ')}
            </p>
            {offer.message && (
              <blockquote className="mt-2 border-l-2 border-primary/40 pl-2 text-muted-foreground">
                {offer.message}
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
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
  'inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const secondaryButtonClasses =
  'inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
