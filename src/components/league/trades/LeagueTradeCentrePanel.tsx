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

import { TradeCards } from './TradeCards';
import { TradeComposer, type TradeComposerSubmission } from './TradeComposer';
import {
  getTradeDeadlineSummary,
  getTradeOfferExpirySummary,
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
      setRequestError(error instanceof Error ? error.message : 'The trade request failed.');
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
          'Counteroffer sent.',
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
        'Trade proposal sent.',
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
    if (
      (action === 'accept' || action === 'approve') &&
      !window.confirm(
        action === 'accept'
          ? 'Accept this trade? Roster ownership may change immediately under league rules.'
          : 'Approve this trade and complete the roster exchange?'
      )
    ) {
      return;
    }

    let reason: string | undefined;
    if (action === 'reject') {
      const response = window.prompt('Why is this trade being rejected?');
      if (response === null) return;
      reason = response.trim();
      if (!reason) {
        setMutationError('A rejection reason is required.');
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
        className="league-trade-centre -m-5 bg-[color:var(--trade-canvas)] p-5 text-[color:var(--trade-text)] sm:-m-6 sm:p-6"
      >
        <div className="mx-auto max-w-[96rem] space-y-5">
          <div>
            <h2 id="trade-centre-heading" className="text-[1.75rem] font-bold tracking-tight">
              Trade Centre
            </h2>
            <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
              Propose and review league roster trades.
            </p>
          </div>
          <div
            role="alert"
            className="rounded-xl border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-4"
          >
            <p className="text-sm font-semibold text-[color:var(--trade-text)]">
              {initialError ?? 'The Trade Centre is unavailable.'}
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

  const viewerTeam = snapshot.teams.find((team) => team.isViewer);
  const counterPartnerId = counterTrade
    ? counterTrade.memberOne.memberId === snapshot.viewerMemberId
      ? counterTrade.memberTwo.memberId
      : counterTrade.memberOne.memberId
    : null;

  return (
    <section
      aria-labelledby="trade-centre-heading"
      className="league-trade-centre -m-5 min-h-[70vh] bg-[color:var(--trade-canvas)] p-5 text-[color:var(--trade-text)] sm:-m-6 sm:p-6"
    >
      <div className="mx-auto max-w-[96rem] space-y-8">
        <header className="rounded-2xl bg-[color:var(--trade-surface-dark)] px-5 py-5 text-white shadow-[var(--trade-card-shadow)] sm:px-6 sm:py-6 lg:flex lg:items-start lg:justify-between lg:gap-8">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/65">
              {viewerTeam?.teamName ?? 'Your team'}
            </p>
            <h2
              id="trade-centre-heading"
              className="mt-2 text-[1.75rem] font-bold leading-[2.125rem] tracking-tight text-white"
            >
              Trade Centre
            </h2>
            <p className="mt-2 text-sm leading-5 text-white/75">
              Build proposals from current league rosters, respond to managers, and follow every
              review decision in one place.
            </p>
          </div>
          <TradeRuleSummary rules={snapshot.rules} />
        </header>

        {workspaceMode === 'compose' ? (
          <section
            aria-labelledby="trade-composer-heading"
            className="rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] p-4 shadow-[var(--trade-card-shadow)] sm:p-6"
          >
            <div className="mb-6 flex flex-col gap-4 border-b border-[color:var(--trade-border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--trade-text-muted)]">
                  Trade Centre
                </p>
                <h3
                  id="trade-composer-heading"
                  ref={composerHeadingRef}
                  tabIndex={-1}
                  className="mt-1 text-lg font-bold tracking-tight text-[color:var(--trade-text)] outline-none focus-visible:rounded focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
                >
                  {counterTrade ? 'Counteroffer workspace' : 'Proposal workspace'}
                </h3>
                <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
                  {counterTrade
                    ? `Respond to offer ${counterTrade.currentOffer.sequence} with revised terms.`
                    : 'Build and review a proposal before it is sent.'}
                </p>
              </div>
              <button
                type="button"
                onClick={showOffers}
                className={workspaceSecondaryButtonClasses}
              >
                Back to offers
              </button>
            </div>
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
            />
          </section>
        ) : (
          <section aria-labelledby="trade-offers-heading" className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--trade-text-muted)]">
                  Trade ledger
                </p>
                <h3
                  id="trade-offers-heading"
                  ref={offersHeadingRef}
                  tabIndex={-1}
                  className="text-lg font-bold tracking-tight text-[color:var(--trade-text)] outline-none focus-visible:rounded focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
                >
                  Offers
                </h3>
                <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
                  Filter by the action or outcome you need.
                </p>
              </div>
              <button
                type="button"
                onClick={openComposer}
                className={workspacePrimaryButtonClasses}
              >
                New proposal
              </button>
            </div>
            <nav aria-label="Trade offer views" className="max-w-full overflow-x-auto pb-1">
              <div className="inline-flex rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-1">
                {TRADE_VIEWS.map((view) => {
                  const isActive = snapshot.activeView === view;
                  return (
                    <button
                      key={view}
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      disabled={isNavigating}
                      onClick={() => navigateToView(view)}
                      className={`inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60 ${
                        isActive
                          ? 'bg-[color:var(--trade-selection)] text-white shadow-sm'
                          : 'text-[color:var(--trade-text-muted)] hover:bg-[color:var(--trade-action-soft)] hover:text-[color:var(--trade-text)]'
                      }`}
                    >
                      {VIEW_LABELS[view]}
                      <span
                        className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs tabular-nums ${
                          isActive
                            ? 'bg-white/15 text-white'
                            : 'bg-[color:var(--trade-border)]/55 text-[color:var(--trade-text)]'
                        }`}
                      >
                        {snapshot.counts[view]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>

            {mutationError && (
              <p
                role="alert"
                className="rounded-lg border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-3 text-sm font-semibold text-[color:var(--trade-text)]"
              >
                {mutationError}
              </p>
            )}
            <p aria-live="polite" className="sr-only">
              {isNavigating ? 'Loading trade offers.' : announcement}
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
  return (
    <dl className="mt-5 grid min-w-0 grid-cols-2 gap-2 text-xs lg:mt-0 lg:w-[42rem] lg:grid-cols-4">
      <div className="rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2.5">
        <dt className="text-white/60">Review</dt>
        <dd className="mt-1 font-semibold leading-4 text-white">{getTradeReviewSummary(rules)}</dd>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2.5">
        <dt className="text-white/60">Trade limit</dt>
        <dd className="mt-1 font-semibold leading-4 text-white">
          {rules.limit > 0 ? `${rules.limit} per team` : 'Unlimited'}
        </dd>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2.5">
        <dt className="text-white/60">Deadline</dt>
        <dd className="mt-1 font-semibold leading-4 text-white">
          {getTradeDeadlineSummary(rules.deadline)}
        </dd>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2.5">
        <dt className="text-white/60">Offer expiry</dt>
        <dd className="mt-1 font-semibold leading-4 text-white">
          {getTradeOfferExpirySummary(rules.offerExpiryHours)}
        </dd>
      </div>
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
  'mt-3 inline-flex h-11 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const workspacePrimaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-4 text-sm font-bold text-white transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2';
const workspaceSecondaryButtonClasses =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2';
