import type { ReactElement } from 'react';

import { TradeStatusBadge } from '@/components/trades/TradeStatusBadge';
import type {
  TradeAuditEntry,
  TradeDetails,
  TradeItem,
  TradeSummary,
} from '@/components/trades/tradeApi';
import { buildTradeActivityPrompt } from '@/components/trades/tradeUiUtils';
import { formatStatValue, getDeltaClass } from '@/components/trades/tradeUiUtils';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

import { displayPlayerName, formatPlayerMeta, resolvePlayerMeta } from './tradePlayerUtils';
import type { RosterPlayer } from './tradeUiTypes';

type ActionType = 'accept' | 'decline' | 'cancel' | null;
type ReviewActionType = 'approve-review' | 'reject-review' | 'finalize-review' | 'veto';

type ReviewControls = {
  approveEnabled: boolean;
  rejectEnabled: boolean;
  vetoEnabled: boolean;
  finalizeEnabled: boolean;
  loadingAction: ReviewActionType | null;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onVeto: () => Promise<void>;
  onFinalize: () => Promise<void>;
};

function actorLabel(
  actorUserId: string | null | undefined,
  teamNameByUserId: Map<string, string>
): string {
  if (!actorUserId) return 'League manager';
  return teamNameByUserId.get(actorUserId) ?? 'League manager';
}

function auditLabel(
  entry: TradeAuditEntry,
  currentUserId: string | null,
  teamNameByUserId: Map<string, string>
): string {
  const actor =
    entry.actorUserId === currentUserId ? 'You' : actorLabel(entry.actorUserId, teamNameByUserId);
  switch (entry.event) {
    case 'TRADE_PROPOSED':
      return `${actor} proposed this trade`;
    case 'TRADE_ACCEPTED':
      return `${actor} accepted this trade`;
    case 'TRADE_DECLINED':
      return `${actor} declined this trade`;
    case 'TRADE_CANCELLED':
      return `${actor} retracted this trade`;
    case 'TRADE_COUNTERED':
      return `${actor} sent a counter offer`;
    case 'TRADE_EXECUTED':
      return `${actor} completed this trade`;
    default:
      return `${actor} updated this trade`;
  }
}

function auditMeta(entry: TradeAuditEntry, teamNameByUserId: Map<string, string>): string {
  if (entry.errorCode) return entry.errorCode;
  return actorLabel(entry.actorUserId, teamNameByUserId);
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
      return 'bg-destructive/10 text-destructive';
    default:
      return 'bg-muted text-foreground';
  }
}

type TradeReviewPanelProps = {
  selectedTrade: TradeSummary | null;
  selectedDetails: TradeDetails | null;
  detailLoading: boolean;
  gives: TradeItem[];
  receives: TradeItem[];
  currentUserId: string | null;
  teamNameByUserId: Map<string, string>;
  rosterCache: Record<string, RosterPlayer[]>;
  visibleKeys: CanonicalStatKey[];
  labels: Record<string, { label?: string; short?: string }>;
  reviewNetImpact: { net: number; label: string };
  reviewTopGains: Array<{ key: CanonicalStatKey; delta: number }>;
  reviewTopRisks: Array<{ key: CanonicalStatKey; delta: number }>;
  reviewImpactLoading: boolean;
  reviewImpact: {
    outTotals: Record<CanonicalStatKey, number>;
    inTotals: Record<CanonicalStatKey, number>;
    deltaTotals: Record<CanonicalStatKey, number>;
  };
  acceptEnabled: boolean;
  declineEnabled: boolean;
  counterEnabled: boolean;
  cancelEnabled: boolean;
  actionLoading: boolean;
  actionType: ActionType;
  actionTradeId: string | null;
  runAction: (action: 'accept' | 'decline' | 'cancel') => Promise<void>;
  beginCounter: () => Promise<void>;
  reviewControls?: ReviewControls;
};

export default function TradeReviewPanel({
  selectedTrade,
  selectedDetails,
  detailLoading,
  gives,
  receives,
  currentUserId,
  teamNameByUserId,
  rosterCache,
  visibleKeys,
  labels,
  reviewNetImpact,
  reviewTopGains,
  reviewTopRisks,
  reviewImpactLoading,
  reviewImpact,
  acceptEnabled,
  declineEnabled,
  counterEnabled,
  cancelEnabled,
  actionLoading,
  actionType,
  actionTradeId,
  runAction,
  beginCounter,
  reviewControls,
}: TradeReviewPanelProps): ReactElement {
  const counterpartName = selectedTrade
    ? (teamNameByUserId.get(
        selectedTrade.proposerUserId === currentUserId
          ? selectedTrade.recipientUserId
          : selectedTrade.proposerUserId
      ) ?? 'League manager')
    : null;
  const reviewStateLabel = !selectedTrade
    ? 'Select a trade to review.'
    : selectedTrade.status === 'PROPOSED'
      ? selectedTrade.recipientUserId === currentUserId
        ? `This offer needs your response.`
        : `This offer is waiting on ${counterpartName}.`
      : selectedTrade.status === 'REVIEW_PENDING'
        ? selectedTrade.reviewMode === 'ADMIN'
          ? 'This trade is awaiting commissioner approval.'
          : 'This trade is in the league review window.'
        : selectedTrade.status === 'REVIEW_REJECTED'
          ? 'This trade was rejected during review.'
          : selectedTrade.status === 'EXECUTED'
            ? 'This trade has been completed.'
            : selectedTrade.status === 'DECLINED'
              ? 'This offer was declined.'
              : selectedTrade.status === 'CANCELLED'
                ? 'This offer was retracted.'
                : selectedTrade.status === 'SUPERSEDED'
                  ? 'This offer was replaced by a counter.'
                  : 'This offer is no longer active.';
  const auditEntries = (selectedDetails?.audit ?? []).slice().sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  const activityPrompt = selectedTrade
    ? buildTradeActivityPrompt({
        trade: selectedTrade,
        currentUserId,
        teamNameByUserId,
      })
    : null;
  const reviewActionBusy = Boolean(reviewControls?.loadingAction);

  return (
    <section aria-label="Trade review" className="xl:col-start-2">
      <div className="overflow-hidden rounded-3xl border border-border bg-white shadow-sm divide-y divide-slate-100">
        <div className="border-b border-border bg-linear-to-r from-muted via-white to-muted px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Trade Review</p>
              <h2 className="text-2xl font-semibold text-foreground">Review &amp; respond</h2>
              <p className="text-sm text-muted-foreground">
                {selectedTrade
                  ? 'Review this offer and decide next action.'
                  : 'Select a trade below'}
              </p>
            </div>
            {selectedTrade ? (
              <div className="flex flex-col items-end gap-1 text-right">
                <TradeStatusBadge status={selectedTrade.status} />
                <span className="text-xs text-muted-foreground">
                  {new Date(selectedTrade.createdAt).toLocaleString()}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="px-6 py-7 space-y-8">
          {selectedTrade ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
              <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-canvas)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                  Trade state
                </p>
                <h3 className="mt-2 text-lg font-semibold text-[color:var(--league-text)]">
                  {reviewStateLabel}
                </h3>
                {activityPrompt ? (
                  <div className="mt-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${promptToneClass(activityPrompt.tone)}`}
                    >
                      {activityPrompt.label}
                    </span>
                  </div>
                ) : null}
                <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
                  {selectedTrade.status === 'REVIEW_PENDING'
                    ? selectedTrade.reviewMode === 'ADMIN'
                      ? 'League approval is required before rosters will update.'
                      : 'League managers can veto this trade until the review window closes.'
                    : selectedTrade.proposerUserId === currentUserId
                      ? `You sent this offer to ${counterpartName}.`
                      : `${counterpartName} sent this offer to you.`}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Activity
                </p>
                <div className="mt-3 space-y-3">
                  {auditEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No trade activity recorded yet.</p>
                  ) : (
                    auditEntries.slice(0, 4).map((entry) => (
                      <div
                        key={`${entry.event}:${entry.createdAt}`}
                        className="flex items-start justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {auditLabel(entry, currentUserId, teamNameByUserId)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {auditMeta(entry, teamNameByUserId)}
                          </p>
                        </div>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-muted p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                You give
              </h3>
              <ul className="mt-4 space-y-3 text-sm">
                {detailLoading ? (
                  <li className="text-muted-foreground">Loading players…</li>
                ) : gives.length === 0 ? (
                  <li className="text-muted-foreground">No outgoing players.</li>
                ) : (
                  gives.map((item) => (
                    <li
                      key={item.playerId}
                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm border border-border"
                    >
                      {(() => {
                        const rosterPlayer = resolvePlayerMeta(
                          item.playerId,
                          item.fromUserId,
                          rosterCache
                        );
                        const displayName =
                          displayPlayerName(rosterPlayer) || item.playerName || item.playerId;
                        const meta = formatPlayerMeta(rosterPlayer) || '—';
                        return (
                          <div>
                            <div className="font-semibold text-foreground">{displayName}</div>
                            <div className="mt-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {meta}
                            </div>
                          </div>
                        );
                      })()}
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="rounded-2xl border border-border bg-muted p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                You receive
              </h3>
              <ul className="mt-4 space-y-3 text-sm">
                {detailLoading ? (
                  <li className="text-muted-foreground">Loading players…</li>
                ) : receives.length === 0 ? (
                  <li className="text-muted-foreground">No incoming players.</li>
                ) : (
                  receives.map((item) => (
                    <li
                      key={item.playerId}
                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm border border-border"
                    >
                      {(() => {
                        const rosterPlayer = resolvePlayerMeta(
                          item.playerId,
                          item.fromUserId,
                          rosterCache
                        );
                        const displayName =
                          displayPlayerName(rosterPlayer) || item.playerName || item.playerId;
                        const meta = formatPlayerMeta(rosterPlayer) || '—';
                        return (
                          <div>
                            <div className="font-semibold text-foreground">{displayName}</div>
                            <div className="mt-1 inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                              {meta}
                            </div>
                          </div>
                        );
                      })()}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Trade Impact</p>
                <p className="text-sm font-semibold text-foreground">
                  Category deltas for your roster
                </p>
                {visibleKeys.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-muted-foreground">Net impact</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getDeltaClass(reviewNetImpact.net)}`}
                    >
                      {reviewNetImpact.label}
                    </span>
                    <span className="text-muted-foreground">across selected stats</span>
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 py-4 border-b border-border">
              {visibleKeys.length > 0 && (
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-success/20 bg-success/10 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-success">
                      Top gains
                    </p>
                    <div className="mt-2 space-y-1 text-xs">
                      {reviewTopGains.length === 0 ? (
                        <p className="text-success">No positive category change.</p>
                      ) : (
                        reviewTopGains.map((row) => (
                          <div key={row.key} className="flex items-center justify-between">
                            <span className="font-medium text-success">
                              {labels[row.key]?.label ?? row.key}
                            </span>
                            <span className="font-semibold">+{formatStatValue(row.delta)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-destructive">
                      Top risks
                    </p>
                    <div className="mt-2 space-y-1 text-xs">
                      {reviewTopRisks.length === 0 ? (
                        <p className="text-destructive">No negative category change.</p>
                      ) : (
                        reviewTopRisks.map((row) => (
                          <div key={row.key} className="flex items-center justify-between">
                            <span className="font-medium text-destructive">
                              {labels[row.key]?.label ?? row.key}
                            </span>
                            <span className="font-semibold">{formatStatValue(row.delta)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
                <div className="space-y-2">
                  <p className="uppercase tracking-[0.2em] text-muted-foreground text-[11px]">You send</p>
                  <div className="flex flex-wrap gap-2">
                    {gives.length === 0 ? (
                      <span className="text-muted-foreground">No players selected.</span>
                    ) : (
                      gives.map((item) => {
                        const meta = formatPlayerMeta(
                          resolvePlayerMeta(item.playerId, item.fromUserId, rosterCache)
                        );
                        const displayName =
                          displayPlayerName(
                            resolvePlayerMeta(item.playerId, item.fromUserId, rosterCache)
                          ) ||
                          item.playerName ||
                          item.playerId;
                        return (
                          <div
                            key={item.playerId}
                            className="flex min-w-[140px] flex-col rounded-full border border-border bg-muted px-3 py-1.5 shadow-sm"
                          >
                            <span className="text-foreground font-semibold text-sm">
                              {displayName}
                            </span>
                            <span className="text-[11px] text-muted-foreground">{meta || '—'}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="uppercase tracking-[0.2em] text-muted-foreground text-[11px]">
                    You receive
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {receives.length === 0 ? (
                      <span className="text-muted-foreground">No players selected.</span>
                    ) : (
                      receives.map((item) => {
                        const meta = formatPlayerMeta(
                          resolvePlayerMeta(item.playerId, item.fromUserId, rosterCache)
                        );
                        const displayName =
                          displayPlayerName(
                            resolvePlayerMeta(item.playerId, item.fromUserId, rosterCache)
                          ) ||
                          item.playerName ||
                          item.playerId;
                        return (
                          <div
                            key={item.playerId}
                            className="flex min-w-[140px] flex-col rounded-full border border-success/20 bg-success/10 px-3 py-1.5 shadow-sm"
                          >
                            <span className="text-foreground font-semibold text-sm">
                              {displayName}
                            </span>
                            <span className="text-[11px] text-success">{meta || '—'}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
            <details className="px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Full category table
              </summary>
              <div className="mt-3 max-h-64 overflow-auto px-1 pt-1">
                {reviewImpactLoading ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground">Computing impact…</div>
                ) : visibleKeys.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground">
                    No stat columns selected for this league.
                  </div>
                ) : (
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Category</th>
                        <th className="px-4 py-2 text-right font-semibold">You send</th>
                        <th className="px-4 py-2 text-right font-semibold">You receive</th>
                        <th
                          className="px-4 py-2 text-right font-semibold"
                          title="Positive = gain, negative = loss. Bigger magnitude is better."
                        >
                          Delta
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleKeys.map((category) => {
                        const delta = reviewImpact.deltaTotals[category] ?? 0;
                        return (
                          <tr key={category} className="border-t border-border">
                            <td
                              className="px-4 py-2 text-foreground"
                              title={
                                category === 'inside50s' ? 'Inside 50 entries per game' : undefined
                              }
                            >
                              {labels[category]?.label ?? category}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground">
                              {formatStatValue(reviewImpact.outTotals[category])}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground">
                              {formatStatValue(reviewImpact.inTotals[category])}
                            </td>
                            <td className="px-4 py-2 text-right font-semibold">
                              <span
                                className={`inline-flex min-w-[64px] items-center justify-end rounded-full px-2 py-0.5 ${getDeltaClass(
                                  delta
                                )}`}
                                title={
                                  category === 'inside50s'
                                    ? 'Inside 50 entries per game'
                                    : 'Higher is better'
                                }
                              >
                                {delta > 0 ? '+' : ''}
                                {formatStatValue(delta)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </details>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {reviewControls?.approveEnabled ? (
              <button
                type="button"
                className="rounded-md bg-[color:var(--league-success)] px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-60"
                disabled={reviewActionBusy}
                onClick={() => {
                  void reviewControls.onApprove();
                }}
              >
                {reviewControls.loadingAction === 'approve-review'
                  ? 'Approving...'
                  : 'Approve trade'}
              </button>
            ) : null}
            {reviewControls?.rejectEnabled ? (
              <button
                type="button"
                className="rounded-md border border-[color:var(--league-danger)] px-4 py-2 text-sm font-semibold text-[color:var(--league-danger)] hover:bg-[color:var(--league-danger-soft)] disabled:opacity-60"
                disabled={reviewActionBusy}
                onClick={() => {
                  void reviewControls.onReject();
                }}
              >
                {reviewControls.loadingAction === 'reject-review' ? 'Rejecting...' : 'Reject trade'}
              </button>
            ) : null}
            {reviewControls?.vetoEnabled ? (
              <button
                type="button"
                className="rounded-md border border-[color:var(--league-warning)] px-4 py-2 text-sm font-semibold text-[color:var(--league-warning)] hover:bg-[color:var(--league-warning-soft)] disabled:opacity-60"
                disabled={reviewActionBusy}
                onClick={() => {
                  void reviewControls.onVeto();
                }}
              >
                {reviewControls.loadingAction === 'veto' ? 'Vetoing...' : 'Veto trade'}
              </button>
            ) : null}
            {reviewControls?.finalizeEnabled ? (
              <button
                type="button"
                className="rounded-md bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[color:var(--league-primary-hover)] disabled:opacity-60"
                disabled={reviewActionBusy}
                onClick={() => {
                  void reviewControls.onFinalize();
                }}
              >
                {reviewControls.loadingAction === 'finalize-review'
                  ? 'Finalising...'
                  : 'Finalize review'}
              </button>
            ) : null}
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                acceptEnabled
                  ? 'bg-success text-white shadow hover:bg-success'
                  : 'bg-muted text-muted-foreground'
              }`}
              disabled={!acceptEnabled || actionLoading}
              onClick={() => runAction('accept')}
            >
              {actionLoading && actionType === 'accept' && actionTradeId === selectedTrade?.tradeId
                ? 'Accepting…'
                : 'Accept'}
            </button>
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                declineEnabled
                  ? 'border border-destructive/20 text-destructive hover:bg-destructive/10'
                  : 'bg-muted text-muted-foreground'
              }`}
              disabled={!declineEnabled || actionLoading}
              onClick={() => runAction('decline')}
            >
              {actionLoading && actionType === 'decline' && actionTradeId === selectedTrade?.tradeId
                ? 'Declining…'
                : 'Decline'}
            </button>
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                counterEnabled
                  ? 'border border-border text-foreground hover:bg-muted'
                  : 'bg-muted text-muted-foreground'
              }`}
              disabled={!counterEnabled || actionLoading}
              onClick={() => {
                void beginCounter();
              }}
            >
              Counter
            </button>
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                cancelEnabled
                  ? 'border border-border text-muted-foreground hover:bg-muted'
                  : 'border border-border text-muted-foreground'
              }`}
              disabled={!cancelEnabled || actionLoading}
              onClick={() => runAction('cancel')}
            >
              {actionLoading && actionType === 'cancel' && actionTradeId === selectedTrade?.tradeId
                ? 'Retracting…'
                : 'Retract offer'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
