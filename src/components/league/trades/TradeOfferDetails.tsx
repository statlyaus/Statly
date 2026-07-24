import { MessageSquareText, ShieldCheck } from 'lucide-react';

import { LeagueSocialDiscussButton } from '@/components/league/LeagueSocialDiscussButton';
import type {
  LeagueTradeDto,
  TradeActionName,
  TradeOfferPlayerDto,
  TradeRulesDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';
import { TradeOfferAssets } from './TradeOfferAssets';
import { TRADE_STATUS_LABELS } from './TradeOfferStatus';
import { formatTradeDateTime } from './tradeDateFormatting';

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
  rules?: TradeRulesDto;
  isPending: boolean;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}

const ACTION_LABELS: Record<Exclude<TradeActionName, 'counter'>, string> = {
  accept: 'Accept trade',
  decline: 'Decline',
  withdraw: 'Withdraw offer',
  approve: 'Approve trade',
  reject: 'Reject trade',
  veto: 'Veto trade',
};

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
  rules,
  isPending,
  onAction,
  onCounter,
}: TradeOfferDetailsProps): React.JSX.Element {
  const offer = trade.currentOffer;

  return (
    <div id={id} className="border-t border-[color:var(--trade-border)]">
      <div className="grid min-w-0 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
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

      <dl className="grid gap-px border-y border-[color:var(--trade-border)] bg-[color:var(--trade-border)] text-xs sm:grid-cols-3">
        <MetadataItem
          label="Position balance"
          value={summarizePositionBalance(sendingPlayers, receivingPlayers)}
        />
        <MetadataItem label="Trade deadline" value={formatDeadline(rules?.deadline)} />
        <MetadataItem label="Offer expiry" value={formatTradeDateTime(offer.expiresAt)} />
      </dl>

      <div className="p-4 sm:p-5">
        <TradeComparisonTable
          sendingTeamName={sendingHeading}
          receivingTeamName={receivingHeading}
          sendingPlayerIds={sendingPlayers.map((player) => player.id)}
          receivingPlayerIds={receivingPlayers.map((player) => player.id)}
          playerStats={playerStats}
        />
      </div>

      {offer.message && (
        <blockquote className="mx-4 mb-4 rounded-lg border-l-[3px] border-[color:var(--trade-action)] bg-[color:var(--trade-action-soft)] px-4 py-3 text-sm leading-5 text-[color:var(--trade-text-muted)] sm:mx-5 sm:mb-5">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[color:var(--trade-text)]">
            <MessageSquareText aria-hidden="true" className="size-3.5" />
            Offer message
          </span>
          {offer.message}
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-4 text-xs font-medium text-[color:var(--trade-text-muted)] sm:px-5 sm:pb-5">
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

      <footer
        aria-label={`Actions for ${displayTitle}`}
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
            title: displayTitle,
            subtitle: TRADE_STATUS_LABELS[trade.status],
            metadata: { offerId: offer.id, status: trade.status },
          }}
          className="!min-h-11 !rounded-lg !border-[color:var(--trade-border-strong)] !bg-[color:var(--trade-surface)] !px-4 !text-sm !text-[color:var(--trade-text)] hover:!bg-[color:var(--trade-action-soft)] focus-visible:!ring-[3px] focus-visible:!ring-[color:var(--trade-focus)]"
        />
      </footer>

      {(trade.offerHistory.length > 1 || trade.events.length > 0) && <TradeHistory trade={trade} />}
    </div>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="bg-[color:var(--trade-surface-subtle)] px-4 py-3 sm:px-5">
      <dt className="font-semibold text-[color:var(--trade-text-muted)]">{label}</dt>
      <dd className="mt-1 font-bold text-[color:var(--trade-text)]">{value}</dd>
    </div>
  );
}

function TradeHistory({ trade }: { trade: LeagueTradeDto }): React.JSX.Element {
  const offers = [...trade.offerHistory].sort((left, right) => left.sequence - right.sequence);

  return (
    <details className="border-t border-[color:var(--trade-border)] px-4 py-3 sm:px-5">
      <summary className="cursor-pointer rounded text-sm font-semibold text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]">
        Trade history
      </summary>
      {offers.length > 1 && (
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
                  {formatTradeDateTime(offer.createdAt)}
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
      )}
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

function summarizePositionBalance(
  sendingPlayers: TradeOfferPlayerDto[],
  receivingPlayers: TradeOfferPlayerDto[]
): string {
  const deltas = new Map<string, number>();
  for (const player of sendingPlayers) {
    deltas.set(player.position, (deltas.get(player.position) ?? 0) - 1);
  }
  for (const player of receivingPlayers) {
    deltas.set(player.position, (deltas.get(player.position) ?? 0) + 1);
  }
  const summary = [...deltas.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([position, delta]) => `${position} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
  return summary.length > 0 ? summary.join(' · ') : 'Balanced';
}

function formatLifecycleLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatDeadline(value: string | null | undefined): string {
  if (!value) return 'No deadline';
  return formatTradeDateTime(value);
}

const primaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-4 text-sm font-bold text-white transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const secondaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
