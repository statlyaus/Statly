'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import {
  TRADE_VIEWS,
  type LeagueTradeCentreSnapshot,
  type LeagueTradeDto,
  type TradeActionName,
  type TradeView,
} from '@/server/leagues/trades/tradeContracts';

import { useConfirmDialog } from '@/components/ui/ConfirmDialog';

import { TradeCards } from './TradeCards';
import { TradeComposer, type TradeComposerSubmission } from './TradeComposer';
import {
  getTradeDeadlineSummary,
  getTradeOfferExpirySummary,
  getTradeAcceptanceSummary,
  getTradeReviewSummary,
} from './tradeRulePresentation';

interface LeagueTradeCentrePanelProps {
  leagueId: string;
  currentUserId?: string;
  initialSnapshot: LeagueTradeCentreSnapshot | null;
  initialError?: string | null;
  requestedPlayerId?: string | null;
  ownerMemberId?: string | null;
}

const VIEW_LABELS: Record<TradeView, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  history: 'History',
  review: 'Review',
};

export function LeagueTradeCentrePanel({
  leagueId,
  currentUserId,
  initialSnapshot,
  initialError,
  requestedPlayerId,
  ownerMemberId,
}: LeagueTradeCentrePanelProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const [pendingTradeId, setPendingTradeId] = useState<string | null>(null);
  const [isComposerSubmitting, setIsComposerSubmitting] = useState(false);
  const [counterTrade, setCounterTrade] = useState<LeagueTradeDto | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'offers' | 'compose'>(() =>
    requestedPlayerId || ownerMemberId ? 'compose' : 'offers'
  );
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const { confirm, requestText, dialog: confirmDialog } = useConfirmDialog();
  const [announcement, setAnnouncement] = useState('');
  const composerHeadingRef = useRef<HTMLHeadingElement>(null);
  const offersHeadingRef = useRef<HTMLHeadingElement>(null);
  const commandKeysRef = useRef(new Map<string, string>());
  const snapshot = initialSnapshot;

  useEffect(() => {
    if (composerFocusRequest === 0) return;
    if (workspaceMode === 'compose') composerHeadingRef.current?.focus();
    else offersHeadingRef.current?.focus();
  }, [composerFocusRequest, workspaceMode]);

  function navigateToView(view: TradeView, cursor?: string): void {
    const next = new URLSearchParams(searchParams?.toString());
    next.set('tab', 'trades');
    next.set('tradeView', view);
    if (cursor) next.set('tradeCursor', cursor);
    else next.delete('tradeCursor');
    setComposerError(null);
    setMutationError(null);
    startNavigation(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  async function postCommand(
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
    setRequestError: (message: string | null) => void = setMutationError
  ): Promise<boolean> {
    setRequestError(null);
    try {
      const response = await authenticatedFetch(
        path,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        currentUserId
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        status?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || `Trade request failed (${response.status}).`);
      }
      setAnnouncement(successMessage);
      router.refresh();
      return true;
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "That didn't go through. Try again."
      );
      return false;
    }
  }

  async function submitComposer(submission: TradeComposerSubmission): Promise<boolean> {
    setMutationError(null);
    setIsComposerSubmitting(true);
    try {
      if (counterTrade) {
        const commandSignature = JSON.stringify({
          command: 'counter',
          tradeId: counterTrade.id,
          version: counterTrade.version,
          submission,
        });
        const saved = await postCommand(
          `/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(counterTrade.id)}/actions`,
          {
            action: 'counter',
            expectedVersion: counterTrade.version,
            sendingPlayerIds: submission.sendingPlayerIds,
            receivingPlayerIds: submission.receivingPlayerIds,
            message: submission.message,
            idempotencyKey: getCommandKey(commandSignature, 'counter'),
          },
          'Counter sent.',
          setComposerError
        );
        if (saved) {
          commandKeysRef.current.delete(commandSignature);
          setCounterTrade(null);
          showOffers();
        }
        return saved;
      }

      const commandSignature = JSON.stringify({ command: 'proposal', submission });
      const saved = await postCommand(
        `/api/leagues/${encodeURIComponent(leagueId)}/trades`,
        {
          ...submission,
          idempotencyKey: getCommandKey(commandSignature, 'proposal'),
        },
        'Offer sent.',
        setComposerError
      );
      if (saved) {
        commandKeysRef.current.delete(commandSignature);
        showOffers();
      }
      return saved;
    } finally {
      setIsComposerSubmitting(false);
    }
  }

  async function handleAction(
    trade: LeagueTradeDto,
    action: Exclude<TradeActionName, 'counter'>
  ): Promise<void> {
    if (action === 'accept' || action === 'approve') {
      const confirmed = await confirm(
        action === 'accept'
          ? {
              title: 'Accept this trade?',
              description: snapshot ? getTradeAcceptanceSummary(snapshot.rules) : undefined,
              confirmLabel: 'Accept trade',
            }
          : {
              title: 'Approve this trade?',
              description: 'The players swap straight away.',
              confirmLabel: 'Approve trade',
            }
      );
      if (!confirmed) return;
    }

    let reason: string | undefined;
    if (action === 'reject') {
      const response = await requestText({
        title: 'Reject this trade?',
        description: 'Both teams see your reason.',
        inputLabel: 'Reason',
        required: true,
        confirmLabel: 'Reject trade',
        tone: 'danger',
      });
      if (response === null) return;
      reason = response.trim();
      if (!reason) {
        setMutationError('Add a reason to reject.');
        return;
      }
    }

    setComposerError(null);
    setPendingTradeId(trade.id);
    try {
      const commandSignature = JSON.stringify({
        command: action,
        tradeId: trade.id,
        version: trade.version,
        reason: reason ?? null,
      });
      const saved = await postCommand(
        `/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(trade.id)}/actions`,
        {
          action,
          expectedVersion: trade.version,
          idempotencyKey: getCommandKey(commandSignature, action),
          ...(reason ? { reason } : {}),
        },
        actionSuccessMessage(action)
      );
      if (saved) commandKeysRef.current.delete(commandSignature);
    } finally {
      setPendingTradeId(null);
    }
  }

  function startCounter(trade: LeagueTradeDto): void {
    setComposerError(null);
    setMutationError(null);
    setCounterTrade(trade);
    setWorkspaceMode('compose');
    requestWorkspaceHeadingFocus();
  }

  function cancelCounter(): void {
    setComposerError(null);
    setCounterTrade(null);
    showOffers();
  }

  function openComposer(): void {
    setComposerError(null);
    setMutationError(null);
    setCounterTrade(null);
    setWorkspaceMode('compose');
    requestWorkspaceHeadingFocus();
  }

  function showOffers(): void {
    setComposerError(null);
    setCounterTrade(null);
    setWorkspaceMode('offers');
    requestWorkspaceHeadingFocus();
  }

  function requestWorkspaceHeadingFocus(): void {
    setComposerFocusRequest((request) => request + 1);
  }

  function getCommandKey(signature: string, command: string): string {
    const existing = commandKeysRef.current.get(signature);
    if (existing) return existing;
    const created = createIdempotencyKey(command);
    commandKeysRef.current.set(signature, created);
    return created;
  }

  if (!snapshot) {
    return (
      <section
        aria-labelledby="trade-centre-heading"
        className="league-trade-centre text-[color:var(--trade-text)]"
      >
        <div className="space-y-4">
          <div>
            <h2 id="trade-centre-heading" className="font-display text-2xl font-bold leading-tight">
              Trades
            </h2>
          </div>
          <div
            role="alert"
            className="rounded-lg border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-4"
          >
            <p className="text-sm font-semibold text-[color:var(--trade-text)]">
              {initialError ?? "Trades can't load right now."}
            </p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className={secondaryButtonClasses}
            >
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  const counterPartnerId = counterTrade
    ? counterTrade.memberOne.memberId === snapshot.viewerMemberId
      ? counterTrade.memberTwo.memberId
      : counterTrade.memberOne.memberId
    : null;

  return (
    <section
      aria-labelledby="trade-centre-heading"
      className="league-trade-centre text-[color:var(--trade-text)]"
    >
      <div className="space-y-5">
        {confirmDialog}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2
              id="trade-centre-heading"
              className="font-display text-2xl font-bold leading-tight text-[color:var(--trade-text)]"
            >
              Trades
            </h2>
            <TradeRuleSummary rules={snapshot.rules} />
          </div>
          {workspaceMode === 'offers' && (
            <button type="button" onClick={openComposer} className={workspacePrimaryButtonClasses}>
              Propose trade
            </button>
          )}
        </header>

        {workspaceMode === 'compose' ? (
          <section aria-labelledby="trade-composer-heading" className="space-y-4">
            <TradeComposer
              key={counterTrade?.id ?? 'proposal'}
              teams={snapshot.teams}
              rules={snapshot.rules}
              playerStats={snapshot.playerStats}
              initialPartnerMemberId={ownerMemberId}
              initialPlayerId={counterTrade ? null : requestedPlayerId}
              counterPartnerMemberId={counterPartnerId}
              isSubmitting={isComposerSubmitting}
              error={composerError}
              onSubmit={submitComposer}
              onCancelCounter={counterTrade ? cancelCounter : undefined}
              heading={
                <h3
                  id="trade-composer-heading"
                  ref={composerHeadingRef}
                  tabIndex={-1}
                  className="text-lg font-bold text-[color:var(--trade-text)] outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)]"
                >
                  {counterTrade ? 'Counteroffer' : 'New trade'}
                </h3>
              }
              headerAction={
                <button
                  type="button"
                  onClick={showOffers}
                  className={workspaceSecondaryButtonClasses}
                >
                  Back to offers
                </button>
              }
            />
          </section>
        ) : (
          <section aria-labelledby="trade-offers-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-[color:var(--trade-border)]">
              <h3
                id="trade-offers-heading"
                ref={offersHeadingRef}
                tabIndex={-1}
                className="pb-2.5 text-lg font-bold leading-tight text-[color:var(--trade-text)] outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)]"
              >
                Offers
              </h3>
              <nav aria-label="Trade offer views" className="-mb-px max-w-full overflow-x-auto">
                <div className="flex">
                  {TRADE_VIEWS.map((view) => {
                    const isActive = snapshot.activeView === view;
                    const count = snapshot.counts[view];
                    return (
                      <button
                        key={view}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        disabled={isNavigating}
                        onClick={() => navigateToView(view)}
                        className={`inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)] disabled:cursor-wait disabled:opacity-60 ${
                          isActive
                            ? 'border-[color:var(--trade-brand)] text-[color:var(--trade-text)]'
                            : 'border-transparent text-[color:var(--trade-text-muted)] hover:border-[color:var(--trade-border-strong)] hover:text-[color:var(--trade-text)]'
                        }`}
                      >
                        {VIEW_LABELS[view]}
                        <span
                          className={`min-w-5 rounded-sm px-1.5 text-center text-xs font-bold leading-5 tabular-nums ${
                            count > 0
                              ? 'bg-[color:var(--trade-brand)] text-white'
                              : 'text-[color:var(--trade-text-muted)]'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </nav>
            </div>

            {mutationError && (
              <p
                role="alert"
                className="rounded-lg border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-3 text-sm font-semibold text-[color:var(--trade-text)]"
              >
                {mutationError}
              </p>
            )}
            <p aria-live="polite" className="sr-only">
              {isNavigating ? 'Loading offers.' : announcement}
            </p>
            <div aria-busy={isNavigating} className={isNavigating ? 'opacity-60' : undefined}>
              <TradeCards
                trades={snapshot.trades}
                teams={snapshot.teams}
                playerStats={snapshot.playerStats}
                rules={snapshot.rules}
                leagueId={leagueId}
                pendingTradeId={pendingTradeId}
                onAction={(trade, action) => void handleAction(trade, action)}
                onCounter={startCounter}
              />
            </div>
            {snapshot.nextCursor && (
              <button
                type="button"
                disabled={isNavigating}
                onClick={() =>
                  navigateToView(snapshot.activeView, snapshot.nextCursor ?? undefined)
                }
                className={secondaryButtonClasses}
              >
                Next page
              </button>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

function TradeRuleSummary({
  rules,
}: {
  rules: LeagueTradeCentreSnapshot['rules'];
}): React.JSX.Element {
  const items = [
    { label: 'Review', value: getTradeReviewSummary(rules) },
    {
      label: 'Trade limit',
      value: rules.limit > 0 ? `${rules.limit} trades per team` : 'No trade limit',
    },
    { label: 'Deadline', value: getTradeDeadlineSummary(rules.deadline) },
    { label: 'Offer expiry', value: getTradeOfferExpirySummary(rules.offerExpiryHours) },
  ];
  return (
    <dl className="mt-1 text-sm leading-6 text-[color:var(--trade-text-muted)]">
      {items.map((item, index) => (
        <div key={item.label} className="inline">
          <dt className="sr-only">{item.label}</dt>
          <dd className="inline whitespace-nowrap">{item.value}</dd>
          {index < items.length - 1 ? (
            <>
              <span aria-hidden="true" className="pl-2 pr-1">
                ·
              </span>{' '}
            </>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function createIdempotencyKey(action: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `trade:${action}:${suffix}`;
}

function actionSuccessMessage(action: Exclude<TradeActionName, 'counter'>): string {
  const messages: Record<Exclude<TradeActionName, 'counter'>, string> = {
    accept: 'Trade accepted.',
    decline: 'Trade declined.',
    withdraw: 'Trade withdrawn.',
    approve: 'Trade approved.',
    reject: 'Trade rejected.',
    veto: 'Veto recorded.',
  };
  return messages[action];
}

const secondaryButtonClasses =
  'mt-3 inline-flex h-11 items-center justify-center rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const workspacePrimaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-md bg-[color:var(--trade-action)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2';
const workspaceSecondaryButtonClasses =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2';
