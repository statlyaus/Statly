'use client';

import type {
  LeagueTradeDto,
  TradeActionName,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';

interface TradeCardsProps {
  trades: LeagueTradeDto[];
  teams: TradeTeamDto[];
  pendingTradeId?: string | null;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

const STATUS_LABELS: Record<LeagueTradeDto['status'], string> = {
  open: 'Awaiting response',
  pending_admin_review: 'Commissioner review',
  pending_veto_review: 'Veto window open',
  completed: 'Completed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
  vetoed: 'Vetoed',
  expired: 'Expired',
  invalidated: 'Invalidated',
};

const ACTION_LABELS: Record<Exclude<TradeActionName, 'counter'>, string> = {
  accept: 'Accept trade',
  decline: 'Decline',
  withdraw: 'Withdraw',
  approve: 'Approve trade',
  reject: 'Reject trade',
  veto: 'Veto trade',
};

export function TradeCards({
  trades,
  teams,
  pendingTradeId,
  onAction,
  onCounter,
}: TradeCardsProps): React.JSX.Element {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Trade offers will appear here as managers take action.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {trades.map((trade) => {
        const offer = trade.currentOffer;
        const memberOne = teams.find((team) => team.memberId === trade.memberOne.memberId);
        const memberTwo = teams.find((team) => team.memberId === trade.memberTwo.memberId);
        const isPending = pendingTradeId === trade.id;
        const actionId = `trade-${trade.id}-actions`;

        return (
          <article
            key={trade.id}
            className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm"
          >
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

            <div className="grid gap-4 p-4 md:grid-cols-2">
              <TradeSide
                teamName={trade.memberOne.teamName}
                players={offer.players.filter(
                  (player) => player.fromMemberId === trade.memberOne.memberId
                )}
                emptyLabel="No players from this team"
              />
              <TradeSide
                teamName={trade.memberTwo.teamName}
                players={offer.players.filter(
                  (player) => player.fromMemberId === trade.memberTwo.memberId
                )}
                emptyLabel="No players from this team"
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
              {trade.status === 'pending_veto_review' && (
                <span>
                  {offer.vetoCount} of {offer.vetoThreshold} vetoes
                </span>
              )}
              {memberOne?.isViewer && <span>You manage {memberOne.teamName}</span>}
              {memberTwo?.isViewer && <span>You manage {memberTwo.teamName}</span>}
            </div>

            {trade.allowedActions.length > 0 && (
              <footer
                id={actionId}
                aria-label={`Actions for ${trade.memberOne.teamName} and ${trade.memberTwo.teamName}`}
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
              </footer>
            )}

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
                          <span className="font-medium capitalize text-foreground">
                            {event.type.replaceAll('_', ' ')}
                          </span>{' '}
                          · {formatDate(event.createdAt)}
                          {event.reason && (
                            <p className="mt-1 text-foreground">Reason: {event.reason}</p>
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
      })}
    </div>
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
        {offers.map((offer) => {
          const memberOnePlayers = offer.players
            .filter((player) => player.fromMemberId === trade.memberOne.memberId)
            .map((player) => player.name);
          const memberTwoPlayers = offer.players
            .filter((player) => player.fromMemberId === trade.memberTwo.memberId)
            .map((player) => player.name);

          return (
            <li key={offer.id} className="rounded-md border border-border bg-muted/20 p-3 text-xs">
              <p className="font-medium text-foreground">
                Offer {offer.sequence} · <span className="capitalize">{offer.status}</span> ·{' '}
                {formatDate(offer.createdAt)}
              </p>
              <dl className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">{trade.memberOne.teamName} sends</dt>
                  <dd>{memberOnePlayers.join(', ') || 'No players'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">{trade.memberTwo.teamName} sends</dt>
                  <dd>{memberTwoPlayers.join(', ') || 'No players'}</dd>
                </div>
              </dl>
              {offer.message && (
                <blockquote className="mt-2 border-l-2 border-primary/40 pl-2 text-muted-foreground">
                  {offer.message}
                </blockquote>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TradeSide({
  teamName,
  players,
  emptyLabel,
}: {
  teamName: string;
  players: LeagueTradeDto['currentOffer']['players'];
  emptyLabel: string;
}): React.JSX.Element {
  return (
    <section
      aria-label={`Players sent by ${teamName}`}
      className="rounded-lg border border-border p-3"
    >
      <h4 className="text-sm font-semibold text-foreground">{teamName} sends</h4>
      {players.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {players.map((player) => (
            <li key={player.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">{player.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {[player.position, player.club].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'date unavailable'
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

const primaryButtonClasses =
  'inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const secondaryButtonClasses =
  'inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
