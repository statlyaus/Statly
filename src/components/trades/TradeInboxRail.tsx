import type { ReactElement } from 'react';

import Button from '@/components/Button';
import { TradeStatusBadge } from '@/components/trades/TradeStatusBadge';
import {
  buildTradeActivityPrompt,
  isTradeActive,
  isTradeAwaitingManagerAction,
} from '@/components/trades/tradeUiUtils';
import { ScrollArea } from '@/components/ui';
import type { TradeDetails, TradeSummary } from '@/components/trades/tradeApi';

type InboxFilter = 'ALL' | 'PROPOSED' | 'COMPLETED';

type TradeInboxRailProps = {
  loading: boolean;
  inboxStatusFilter: InboxFilter;
  setInboxStatusFilter: (filter: InboxFilter) => void;
  filteredIncomingTrades: TradeSummary[];
  filteredOutgoingTrades: TradeSummary[];
  pendingIncomingCount: number;
  pendingOutgoingCount: number;
  closedTradeCount: number;
  selectedTradeId: string;
  currentUserId: string | null;
  details: Record<string, TradeDetails>;
  teamNameByUserId: Map<string, string>;
  setSelectedTradeId: (tradeId: string) => void;
  setShowCreate: (value: boolean) => void;
  actionLoading: boolean;
  actionType: 'accept' | 'decline' | 'cancel' | null;
  actionTradeId: string | null;
  runActionForTrade: (tradeId: string, action: 'accept' | 'decline' | 'cancel') => Promise<void>;
};

function summarizeTradeFlow(
  trade: TradeSummary,
  currentUserId: string | null,
  details: Record<string, TradeDetails>
) {
  const items = details[trade.tradeId]?.items ?? trade.items ?? [];
  if (!currentUserId || items.length === 0) return 'Offer details pending';
  const outgoing = items.filter((item) => item.fromUserId === currentUserId).length;
  const incoming = items.filter((item) => item.toUserId === currentUserId).length;
  return `${incoming} in • ${outgoing} out`;
}

function describeTradeState(trade: TradeSummary, currentUserId: string | null): string {
  if (!currentUserId) return 'Trade update unavailable';
  const isRecipient = trade.recipientUserId === currentUserId;
  const isProposer = trade.proposerUserId === currentUserId;

  switch (trade.status) {
    case 'PROPOSED':
      return isRecipient
        ? 'Awaiting your response'
        : isProposer
          ? 'Awaiting opponent response'
          : 'Pending';
    case 'REVIEW_PENDING':
      return 'Accepted and awaiting league review';
    case 'REVIEW_REJECTED':
      return 'Rejected during review';
    case 'EXECUTED':
      return 'Trade completed';
    case 'DECLINED':
      return isRecipient ? 'You declined this offer' : 'Opponent declined this offer';
    case 'CANCELLED':
      return isProposer ? 'You retracted this offer' : 'Offer was retracted';
    case 'SUPERSEDED':
      return 'Superseded by counter offer';
    case 'EXPIRED':
      return 'Offer expired';
    default:
      return trade.status;
  }
}

function formatCompactDate(value: string): string {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function promptToneClass(tone: 'primary' | 'warning' | 'success' | 'danger' | 'neutral') {
  switch (tone) {
    case 'primary':
      return 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]';
    case 'warning':
      return 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]';
    case 'success':
      return 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]';
    case 'danger':
      return 'bg-rose-50 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export default function TradeInboxRail({
  loading,
  inboxStatusFilter,
  setInboxStatusFilter,
  filteredIncomingTrades,
  filteredOutgoingTrades,
  pendingIncomingCount,
  pendingOutgoingCount,
  closedTradeCount,
  selectedTradeId,
  currentUserId,
  details,
  teamNameByUserId,
  setSelectedTradeId,
  setShowCreate,
  actionLoading,
  actionType,
  actionTradeId,
  runActionForTrade,
}: TradeInboxRailProps): ReactElement {
  return (
    <section
      aria-label="Trade inbox"
      className="space-y-4 xl:col-start-1 xl:row-start-1 xl:row-span-2"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: 'Need response',
            value: pendingIncomingCount,
            tone: 'border-[color:var(--league-warning-soft)] bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]',
          },
          {
            label: 'Awaiting reply',
            value: pendingOutgoingCount,
            tone: 'border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]',
          },
          {
            label: 'Closed trades',
            value: closedTradeCount,
            tone: 'border-[color:var(--league-border)] bg-white text-[color:var(--league-text)]',
          },
        ].map((card) => (
          <div key={card.label} className={`rounded-2xl border px-4 py-3 ${card.tone}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Inbox filters</p>
            <p className="text-sm font-semibold text-slate-800">Trade status</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'ALL', label: 'All' },
              { id: 'PROPOSED', label: 'Pending' },
              { id: 'COMPLETED', label: 'Completed' },
            ].map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setInboxStatusFilter(filter.id as InboxFilter)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  inboxStatusFilter === filter.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Incoming</p>
            <h3 className="text-base font-semibold text-slate-900">Offers to review</h3>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {filteredIncomingTrades.length} trades
          </span>
        </div>

        <ScrollArea className="max-h-[360px]">
          <ul className="divide-y divide-slate-200">
            {loading ? (
              <li className="px-4 py-8 text-sm text-slate-500">Loading trades…</li>
            ) : filteredIncomingTrades.length === 0 ? (
              <li className="px-4 py-8 text-sm">
                <p className="text-slate-500">No incoming trades for this filter.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {inboxStatusFilter !== 'ALL' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setInboxStatusFilter('ALL')}
                    >
                      Show all
                    </Button>
                  ) : null}
                  <Button type="button" className="text-xs" onClick={() => setShowCreate(true)}>
                    Create trade
                  </Button>
                </div>
              </li>
            ) : (
              filteredIncomingTrades.map((trade) => (
                <li key={trade.tradeId}>
                  <div
                    className={`space-y-3 px-4 py-4 ${
                      selectedTradeId === trade.tradeId ? 'bg-slate-50' : 'bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTradeId(trade.tradeId)}
                      className="flex w-full items-center justify-between text-left hover:opacity-90"
                      aria-current={selectedTradeId === trade.tradeId ? 'true' : undefined}
                    >
                      <div>
                        {(() => {
                          const proposerName =
                            teamNameByUserId.get(trade.proposerUserId) ?? 'League manager';
                          const prompt = buildTradeActivityPrompt({
                            trade,
                            currentUserId,
                            teamNameByUserId,
                          });
                          return (
                            <>
                              <p className="text-base font-semibold text-slate-900">
                                From {proposerName}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${promptToneClass(prompt.tone)}`}
                                >
                                  {prompt.label}
                                </span>
                                <span className="text-xs font-medium text-[color:var(--league-warning)]">
                                  {describeTradeState(trade, currentUserId)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {summarizeTradeFlow(trade, currentUserId, details)}
                              </p>
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <TradeStatusBadge status={trade.status} />
                        <span className="text-xs text-slate-400">
                          {formatCompactDate(trade.createdAt)}
                        </span>
                      </div>
                    </button>
                    {isTradeAwaitingManagerAction(trade) ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400"
                          disabled={actionLoading}
                          onClick={() => {
                            void runActionForTrade(trade.tradeId, 'accept');
                          }}
                        >
                          {actionLoading &&
                          actionType === 'accept' &&
                          actionTradeId === trade.tradeId
                            ? 'Accepting…'
                            : 'Accept'}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:border-slate-200 disabled:text-slate-400"
                          disabled={actionLoading}
                          onClick={() => {
                            void runActionForTrade(trade.tradeId, 'decline');
                          }}
                        >
                          {actionLoading &&
                          actionType === 'decline' &&
                          actionTradeId === trade.tradeId
                            ? 'Declining…'
                            : 'Decline'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Outgoing</p>
            <h3 className="text-base font-semibold text-slate-900">Trades you proposed</h3>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {filteredOutgoingTrades.length} trades
          </span>
        </div>

        <ScrollArea className="max-h-[360px]">
          <ul className="divide-y divide-slate-200">
            {loading ? (
              <li className="px-4 py-8 text-sm text-slate-500">Loading trades…</li>
            ) : filteredOutgoingTrades.length === 0 ? (
              <li className="px-4 py-8 text-sm">
                <p className="text-slate-500">No outgoing trades for this filter.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {inboxStatusFilter !== 'ALL' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setInboxStatusFilter('ALL')}
                    >
                      Show all
                    </Button>
                  ) : null}
                  <Button type="button" className="text-xs" onClick={() => setShowCreate(true)}>
                    Create trade
                  </Button>
                </div>
              </li>
            ) : (
              filteredOutgoingTrades.map((trade) => (
                <li key={trade.tradeId}>
                  <div
                    className={`space-y-3 px-4 py-4 ${
                      selectedTradeId === trade.tradeId ? 'bg-slate-50' : 'bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTradeId(trade.tradeId)}
                      className="flex w-full items-center justify-between text-left hover:opacity-90"
                      aria-current={selectedTradeId === trade.tradeId ? 'true' : undefined}
                    >
                      <div>
                        {(() => {
                          const recipientName =
                            teamNameByUserId.get(trade.recipientUserId) ?? 'League manager';
                          const prompt = buildTradeActivityPrompt({
                            trade,
                            currentUserId,
                            teamNameByUserId,
                          });
                          return (
                            <>
                              <p className="text-base font-semibold text-slate-900">
                                To {recipientName}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${promptToneClass(prompt.tone)}`}
                                >
                                  {prompt.label}
                                </span>
                                <span className="text-xs font-medium text-[color:var(--league-primary)]">
                                  {describeTradeState(trade, currentUserId)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {summarizeTradeFlow(trade, currentUserId, details)}
                              </p>
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <TradeStatusBadge status={trade.status} />
                        <span className="text-xs text-slate-400">
                          {formatCompactDate(trade.createdAt)}
                        </span>
                      </div>
                    </button>
                    {isTradeActive(trade) ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)] px-3 py-2">
                        <p className="text-xs font-medium text-[color:var(--league-primary)]">
                          {trade.status === 'REVIEW_PENDING'
                            ? 'This trade is still active while league review is in progress. You can retract it until the review completes.'
                            : 'This offer is live. You can retract it until the other manager responds.'}
                        </p>
                        <button
                          type="button"
                          className="rounded-md border border-[color:var(--league-primary)] bg-white px-3 py-1.5 text-xs font-semibold text-[color:var(--league-primary)] hover:bg-[color:var(--league-canvas)] disabled:border-slate-200 disabled:text-slate-400"
                          disabled={actionLoading}
                          onClick={() => {
                            void runActionForTrade(trade.tradeId, 'cancel');
                          }}
                        >
                          {actionLoading &&
                          actionType === 'cancel' &&
                          actionTradeId === trade.tradeId
                            ? 'Retracting…'
                            : 'Retract offer'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </div>
    </section>
  );
}
