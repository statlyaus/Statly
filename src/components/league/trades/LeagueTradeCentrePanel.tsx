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
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const composerHeadingRef = useRef<HTMLHeadingElement>(null);
  const commandKeysRef = useRef(new Map<string, string>());
  const snapshot = initialSnapshot;

  useEffect(() => {
    if (!counterTrade) return;
    composerHeadingRef.current?.focus();
  }, [counterTrade]);

  function navigateToView(view: TradeView, cursor?: string): void {
    const next = new URLSearchParams(searchParams?.toString());
    next.set('tab', 'trades');
    next.set('tradeView', view);
    if (cursor) next.set('tradeCursor', cursor);
    else next.delete('tradeCursor');
    setMutationError(null);
    startNavigation(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  async function postCommand(
    path: string,
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<boolean> {
    setMutationError(null);
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
      setMutationError(error instanceof Error ? error.message : 'The trade request failed.');
      return false;
    }
  }

  async function submitComposer(submission: TradeComposerSubmission): Promise<boolean> {
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
          'Counteroffer sent.'
        );
        if (saved) {
          commandKeysRef.current.delete(commandSignature);
          setCounterTrade(null);
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
        'Trade proposal sent.'
      );
      if (saved) commandKeysRef.current.delete(commandSignature);
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
    setMutationError(null);
    setCounterTrade(trade);
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
      <section aria-labelledby="trade-centre-heading" className="space-y-4">
        <div>
          <h2 id="trade-centre-heading" className="text-xl font-semibold text-foreground">
            Trade Centre
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Propose and review league roster trades.
          </p>
        </div>
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">
            {initialError ?? 'The Trade Centre is unavailable.'}
          </p>
          <button type="button" onClick={() => router.refresh()} className={secondaryButtonClasses}>
            Try again
          </button>
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
    <section aria-labelledby="trade-centre-heading" className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {viewerTeam?.teamName ?? 'Your team'}
          </p>
          <h2 id="trade-centre-heading" className="mt-1 text-2xl font-semibold text-foreground">
            Trade Centre
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Build proposals from current league rosters, respond to managers, and follow every
            review decision in one place.
          </p>
        </div>
        <TradeRuleSummary rules={snapshot.rules} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <h3
          ref={composerHeadingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {counterTrade ? 'Build a counteroffer' : 'Propose a trade'}
        </h3>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          {counterTrade
            ? `Respond to offer ${counterTrade.currentOffer.sequence} with a new set of players.`
            : 'Select at least one player from each roster.'}
        </p>
        <TradeComposer
          key={counterTrade?.id ?? 'proposal'}
          teams={snapshot.teams}
          playerStats={snapshot.playerStats}
          initialPartnerMemberId={ownerMemberId}
          initialPlayerId={counterTrade ? null : requestedPlayerId}
          counterPartnerMemberId={counterPartnerId}
          isSubmitting={isComposerSubmitting}
          error={counterTrade ? mutationError : null}
          onSubmit={submitComposer}
          onCancelCounter={counterTrade ? () => setCounterTrade(null) : undefined}
        />
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Offers</h3>
            <p className="text-sm text-muted-foreground">
              Filter by the action or outcome you need.
            </p>
          </div>
          <nav aria-label="Trade offer views" className="overflow-x-auto">
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
              {TRADE_VIEWS.map((view) => {
                const isActive = snapshot.activeView === view;
                return (
                  <button
                    key={view}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    disabled={isNavigating}
                    onClick={() => navigateToView(view)}
                    className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {VIEW_LABELS[view]}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                      {snapshot.counts[view]}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {mutationError && !counterTrade && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive"
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
            onClick={() => navigateToView(snapshot.activeView, snapshot.nextCursor ?? undefined)}
            className={secondaryButtonClasses}
          >
            Next page
          </button>
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
  const reviewLabel =
    rules.reviewMode === 'admin'
      ? 'Commissioner approval'
      : rules.reviewMode === 'veto'
        ? `${rules.reviewHours}h veto window · ${rules.vetoThreshold} votes`
        : 'Completes on acceptance';
  return (
    <dl className="grid min-w-0 gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-2 xl:max-w-3xl xl:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">Review</dt>
        <dd className="mt-0.5 font-medium text-foreground">{reviewLabel}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Trade limit</dt>
        <dd className="mt-0.5 font-medium text-foreground">
          {rules.limit > 0 ? `${rules.limit} per team` : 'Unlimited'}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Deadline</dt>
        <dd className="mt-0.5 font-medium text-foreground">
          {rules.deadline ? formatShortDate(rules.deadline) : 'No deadline'}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Offer expiry</dt>
        <dd className="mt-0.5 font-medium text-foreground">
          {rules.offerExpiryHours}h after sending
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

function formatShortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not set'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

const secondaryButtonClasses =
  'mt-3 inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
