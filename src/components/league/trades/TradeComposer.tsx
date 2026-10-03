'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import type React from 'react';

import { TeamMark } from '@/components/scores/MatchupScore';
import type { TradeRulesDto, TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeReviewStep } from './TradeReviewStep';
import { TradeRosterWorkspace } from './TradeRosterWorkspace';
import { TradeBuildPanel } from './TradeBuildPanel';
import {
  createTradeComposerState,
  getSelectedPlayers,
  isTradeSelectionComplete,
  tradeComposerReducer,
} from './tradeComposerState';
import { buildTradeVerdict, squadPositionImpact } from './tradeVerdict';

export interface TradeComposerSubmission {
  recipientMemberId: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message?: string;
}

interface TradeComposerProps {
  teams: TradeTeamDto[];
  rules: TradeRulesDto;
  playerStats: LeaguePlayerStatDatasetDto;
  initialPartnerMemberId?: string | null;
  initialPlayerId?: string | null;
  counterPartnerMemberId?: string | null;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (submission: TradeComposerSubmission) => Promise<boolean>;
  onCancelCounter?: () => void;
  /** The page's h3 ("New trade" / "Counteroffer"); the team picker sits beside it. */
  heading?: React.ReactNode;
  /** Trailing header content, such as Back to offers. */
  headerAction?: React.ReactNode;
}

export function TradeComposer({
  teams,
  rules,
  playerStats,
  initialPartnerMemberId,
  initialPlayerId,
  counterPartnerMemberId,
  isSubmitting,
  error,
  onSubmit,
  onCancelCounter,
  heading,
  headerAction,
}: TradeComposerProps): React.JSX.Element {
  const errorId = useId();
  const viewerTeam = teams.find((team) => team.isViewer) ?? null;
  const partners = teams.filter((team) => !team.isViewer);
  const isCounter = Boolean(counterPartnerMemberId);
  const requestedPlayerOwner = initialPlayerId
    ? teams.find((team) => team.players.some((player) => player.id === initialPlayerId))
    : null;
  const counterPartner = counterPartnerMemberId
    ? partners.find((team) => team.memberId === counterPartnerMemberId)
    : null;
  const requestedPlayerPartner =
    requestedPlayerOwner && !requestedPlayerOwner.isViewer ? requestedPlayerOwner : null;
  const hintedPartner = initialPartnerMemberId
    ? partners.find((team) => team.memberId === initialPartnerMemberId)
    : null;
  const preferredPartnerId =
    (isCounter
      ? counterPartner?.memberId
      : (requestedPlayerPartner?.memberId ?? hintedPartner?.memberId ?? partners[0]?.memberId)) ??
    '';
  const initialSendingPlayerId =
    !isCounter && initialPlayerId && requestedPlayerOwner?.isViewer ? initialPlayerId : null;
  const initialReceivingPlayerId =
    !isCounter && initialPlayerId && requestedPlayerPartner?.memberId === preferredPartnerId
      ? initialPlayerId
      : null;
  const deepLinkInitialization = {
    partnerId: preferredPartnerId,
    sendingPlayerIds: initialSendingPlayerId ? [initialSendingPlayerId] : [],
    receivingPlayerIds: initialReceivingPlayerId ? [initialReceivingPlayerId] : [],
  };
  const [state, dispatch] = useReducer(
    tradeComposerReducer,
    deepLinkInitialization,
    createTradeComposerState
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<'review-heading' | 'review-button' | null>(null);
  const lastInitializationRef = useRef({
    counterPartnerMemberId,
    playerId: initialPlayerId,
    ownerMemberId: initialPartnerMemberId,
  });
  const initializationChanged = isCounter
    ? counterPartnerMemberId !== lastInitializationRef.current.counterPartnerMemberId
    : Boolean(lastInitializationRef.current.counterPartnerMemberId) ||
      initialPlayerId !== lastInitializationRef.current.playerId ||
      initialPartnerMemberId !== lastInitializationRef.current.ownerMemberId;
  const statePartnerIsValid = partners.some((team) => team.memberId === state.partnerId);
  const needsPartnerReconciliation =
    !isCounter &&
    !initializationChanged &&
    Boolean(preferredPartnerId) &&
    state.partnerId !== preferredPartnerId &&
    !statePartnerIsValid;
  const composerState = initializationChanged
    ? createTradeComposerState(deepLinkInitialization)
    : needsPartnerReconciliation
      ? tradeComposerReducer(state, { type: 'selectPartner', partnerId: preferredPartnerId })
      : state;
  const partner = partners.find((team) => team.memberId === composerState.partnerId) ?? null;
  const viewerPlayerIds = new Set(viewerTeam?.players.map((player) => player.id) ?? []);
  const partnerPlayerIds = new Set(partner?.players.map((player) => player.id) ?? []);
  const validSendingPlayerIds = composerState.sendingPlayerIds.filter((playerId) =>
    viewerPlayerIds.has(playerId)
  );
  const validReceivingPlayerIds = composerState.receivingPlayerIds.filter((playerId) =>
    partnerPlayerIds.has(playerId)
  );
  const selectionComplete = isTradeSelectionComplete({
    ...composerState,
    sendingPlayerIds: validSendingPlayerIds,
    receivingPlayerIds: validReceivingPlayerIds,
  });
  const sendingPlayers = getSelectedPlayers(viewerTeam?.players ?? [], validSendingPlayerIds);
  const receivingPlayers = getSelectedPlayers(partner?.players ?? [], validReceivingPlayerIds);
  const verdict = buildTradeVerdict(validSendingPlayerIds, validReceivingPlayerIds, playerStats);

  useEffect(() => {
    if (initializationChanged) {
      lastInitializationRef.current = {
        counterPartnerMemberId,
        playerId: initialPlayerId,
        ownerMemberId: initialPartnerMemberId,
      };
      dispatch({
        type: 'initializeDeepLink',
        partnerId: preferredPartnerId,
        sendingPlayerIds: initialSendingPlayerId ? [initialSendingPlayerId] : [],
        receivingPlayerIds: initialReceivingPlayerId ? [initialReceivingPlayerId] : [],
      });
      return;
    }

    if (needsPartnerReconciliation) {
      dispatch({ type: 'selectPartner', partnerId: preferredPartnerId });
    }
  }, [
    counterPartnerMemberId,
    initialPartnerMemberId,
    initialPlayerId,
    initialReceivingPlayerId,
    initialSendingPlayerId,
    initializationChanged,
    needsPartnerReconciliation,
    preferredPartnerId,
  ]);

  useEffect(() => {
    if (
      initializationChanged ||
      needsPartnerReconciliation ||
      (arePlayerIdsEqual(state.sendingPlayerIds, validSendingPlayerIds) &&
        arePlayerIdsEqual(state.receivingPlayerIds, validReceivingPlayerIds))
    ) {
      return;
    }
    dispatch({
      type: 'syncSelections',
      sendingPlayerIds: validSendingPlayerIds,
      receivingPlayerIds: validReceivingPlayerIds,
    });
  }, [
    state.receivingPlayerIds,
    state.sendingPlayerIds,
    validReceivingPlayerIds,
    validSendingPlayerIds,
  ]);

  useEffect(() => {
    if (pendingFocusRef.current === 'review-heading' && composerState.step === 'review') {
      reviewHeadingRef.current?.focus();
      pendingFocusRef.current = null;
      return;
    }
    if (pendingFocusRef.current === 'review-button' && composerState.step === 'edit') {
      reviewButtonRef.current?.focus();
      pendingFocusRef.current = null;
    }
  }, [composerState.step]);

  function showReview(): void {
    setValidationError(null);
    if (!composerState.partnerId) {
      setValidationError('Pick a team to trade with.');
      return;
    }
    if (!selectionComplete) {
      setValidationError('Pick at least one player from each side.');
      return;
    }
    pendingFocusRef.current = 'review-heading';
    dispatch({ type: 'review' });
  }

  function returnToEdit(): void {
    pendingFocusRef.current = 'review-button';
    dispatch({ type: 'edit' });
  }

  async function submitReview(): Promise<void> {
    setValidationError(null);
    if (!composerState.partnerId || !selectionComplete) {
      setValidationError('A player in this trade has changed. Edit it and check again.');
      return;
    }

    const saved = await onSubmit({
      recipientMemberId: composerState.partnerId,
      sendingPlayerIds: validSendingPlayerIds,
      receivingPlayerIds: validReceivingPlayerIds,
      message: composerState.message.trim() || undefined,
    });
    if (saved) {
      dispatch({ type: 'reset' });
    }
  }

  if (!viewerTeam) {
    return (
      <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-4 text-sm text-[color:var(--trade-text-muted)]">
        You need a roster before you can trade.
      </div>
    );
  }

  if (isCounter && !counterPartner) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="alert">
          <p className="text-base font-bold text-[color:var(--trade-text)]">
            Can’t counter this offer
          </p>
          <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
            The other team is no longer in the league.
          </p>
        </div>
        {onCancelCounter && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancelCounter}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel counter
          </button>
        )}
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-5 text-sm text-[color:var(--trade-text-muted)]">
        No other teams to trade with yet.
      </div>
    );
  }

  const reviewing = composerState.step === 'review' && partner !== null;
  const lockedPartner = Boolean(counterPartnerMemberId) || isSubmitting;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color:var(--trade-border)] pb-3">
        <div className="order-1">{heading}</div>
        <div className="order-3 flex w-full min-w-0 items-center gap-2.5 sm:order-2 sm:w-auto">
          <span aria-hidden="true" className="text-lg text-[color:var(--trade-text-muted)]">
            with
          </span>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            {partner ? (
              <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2">
                <TeamMark teamName={partner.teamName} logoUrl={partner.teamLogoUrl} size="sm" />
              </span>
            ) : null}
            <select
              aria-label="Trade with"
              value={composerState.partnerId}
              disabled={lockedPartner}
              onChange={(event) =>
                dispatch({ type: 'selectPartner', partnerId: event.target.value })
              }
              className="h-11 w-full cursor-pointer sm:h-10 sm:w-auto appearance-none truncate rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] pl-10 pr-9 text-base font-semibold text-[color:var(--trade-text)] transition-colors hover:border-[color:var(--trade-text-muted)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] disabled:cursor-not-allowed disabled:bg-[color:var(--trade-surface-subtle)] disabled:opacity-80"
            >
              {partners.map((team) => (
                <option key={team.memberId} value={team.memberId}>
                  {team.teamName}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[color:var(--trade-text-muted)]"
            />
          </div>
        </div>
        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 sm:order-3">
          {counterPartnerMemberId && onCancelCounter && !reviewing && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancelCounter}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              Cancel counter
            </button>
          )}
          {headerAction}
        </div>
      </div>

      <div
        data-trade-composer
        aria-describedby={validationError || error ? errorId : undefined}
        className="grid min-w-0 items-start gap-4 pb-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:pb-0"
      >
        <div data-trade-composer-content className="min-w-0 space-y-4">
          {partner && (
            <TradeRosterWorkspace
              viewerTeam={viewerTeam}
              partnerTeam={partner}
              playerStats={playerStats}
              sendingPlayerIds={validSendingPlayerIds}
              receivingPlayerIds={validReceivingPlayerIds}
              activeRoster={composerState.activeRoster}
              disabled={isSubmitting || reviewing}
              onToggleSendingPlayer={(playerId) =>
                dispatch({ type: 'toggleSendingPlayer', playerId })
              }
              onToggleReceivingPlayer={(playerId) =>
                dispatch({ type: 'toggleReceivingPlayer', playerId })
              }
              onActiveRosterChange={(roster) => dispatch({ type: 'showRoster', roster })}
            />
          )}

          {!reviewing && (validationError || error) && (
            <p
              id={errorId}
              role="alert"
              className="rounded-lg border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--trade-text)]"
            >
              {validationError ?? error}
            </p>
          )}
        </div>

        {/* The trade panel: a sticky side column on wide screens, a bottom sheet on phones. */}
        <aside
          aria-label={reviewing ? 'Confirm trade' : 'Your trade'}
          className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border-t border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] shadow-[0_-8px_24px_rgb(0_0_0/0.14)] lg:sticky lg:top-20 lg:z-auto lg:max-h-[calc(100dvh-11rem)] lg:rounded-lg lg:border lg:shadow-none ${
            reviewing ? 'max-h-[85dvh] overflow-y-auto' : 'max-h-[75dvh]'
          }`}
        >
          {reviewing && partner ? (
            <div className="min-h-0 overflow-y-auto pb-20 lg:pb-0">
              <TradeReviewStep
                viewerTeam={viewerTeam}
                partnerTeam={partner}
                sendingPlayers={sendingPlayers}
                receivingPlayers={receivingPlayers}
                sendingPlayerIds={validSendingPlayerIds}
                receivingPlayerIds={validReceivingPlayerIds}
                message={composerState.message}
                rules={rules}
                mode={isCounter ? 'counteroffer' : 'proposal'}
                playerStats={playerStats}
                isSubmitting={isSubmitting}
                error={validationError ?? error}
                headingRef={reviewHeadingRef}
                onMessageChange={(message) => dispatch({ type: 'setMessage', message })}
                onBack={returnToEdit}
                onSubmit={() => void submitReview()}
                onCancelCounter={counterPartnerMemberId ? onCancelCounter : undefined}
              />
            </div>
          ) : (
            <TradeBuildPanel
              partnerTeamName={partner?.teamName ?? 'your trade partner'}
              give={sendingPlayers}
              get={receivingPlayers}
              playerStats={playerStats}
              verdict={verdict}
              squadChanges={squadPositionImpact(
                viewerTeam.players,
                sendingPlayers,
                receivingPlayers
              )}
              selectionComplete={selectionComplete}
              disabled={isSubmitting}
              reviewButtonRef={reviewButtonRef}
              sheetOpen={sheetOpen}
              onToggleSheet={() => setSheetOpen((open) => !open)}
              onRemoveGive={(playerId) => dispatch({ type: 'toggleSendingPlayer', playerId })}
              onRemoveGet={(playerId) => dispatch({ type: 'toggleReceivingPlayer', playerId })}
              onClear={() => {
                setValidationError(null);
                dispatch({ type: 'clearSelections' });
              }}
              onReview={showReview}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function arePlayerIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((playerId, index) => playerId === right[index]);
}
