'use client';

import { useEffect, useId, useReducer, useRef, useState } from 'react';

import type { TradeRulesDto, TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';
import { TradeReviewStep } from './TradeReviewStep';
import { TradeRosterWorkspace } from './TradeRosterWorkspace';
import { TradeSelectionTray } from './TradeSelectionTray';
import {
  createTradeComposerState,
  getSelectedPlayers,
  isTradeSelectionComplete,
  tradeComposerReducer,
} from './tradeComposerState';

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
      setValidationError('Choose a trade partner.');
      return;
    }
    if (!selectionComplete) {
      setValidationError('Select at least one player from each team.');
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
      setValidationError('The selected trade package is incomplete. Return to edit and review it.');
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
        Your active roster is not available, so a proposal cannot be created yet.
      </div>
    );
  }

  if (isCounter && !counterPartner) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="alert">
          <p className="text-base font-bold text-[color:var(--trade-text)]">
            Counteroffer unavailable
          </p>
          <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
            This counteroffer is no longer available because the original trade partner is not
            active.
          </p>
        </div>
        {onCancelCounter && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancelCounter}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel counteroffer
          </button>
        )}
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-5 text-sm text-[color:var(--trade-text-muted)]">
        Another active team must join before you can propose a trade.
      </div>
    );
  }

  if (composerState.step === 'review' && partner) {
    return (
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
    );
  }

  return (
    <div
      data-trade-composer
      aria-describedby={validationError || error ? errorId : undefined}
      className="flex h-[clamp(28rem,65dvh,42rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
    >
      <div
        data-trade-composer-content
        className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5"
      >
        <div className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="trade-partner"
              className="text-sm font-semibold text-[color:var(--trade-text)]"
            >
              Trade partner
            </label>
            <select
              id="trade-partner"
              value={composerState.partnerId}
              disabled={Boolean(counterPartnerMemberId) || isSubmitting}
              onChange={(event) =>
                dispatch({ type: 'selectPartner', partnerId: event.target.value })
              }
              className="mt-2 h-11 w-full rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-3 text-sm font-medium text-[color:var(--trade-text)] shadow-sm outline-none transition focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:cursor-not-allowed disabled:bg-[color:var(--trade-surface-subtle)] disabled:opacity-60"
            >
              {partners.map((team) => (
                <option key={team.memberId} value={team.memberId}>
                  {team.teamName}
                </option>
              ))}
            </select>
          </div>
          {counterPartnerMemberId && onCancelCounter && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancelCounter}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              Cancel counteroffer
            </button>
          )}
        </div>

        {partner && (
          <>
            <TradeRosterWorkspace
              viewerTeam={viewerTeam}
              partnerTeam={partner}
              playerStats={playerStats}
              sendingPlayerIds={validSendingPlayerIds}
              receivingPlayerIds={validReceivingPlayerIds}
              activeRoster={composerState.activeRoster}
              disabled={isSubmitting}
              onToggleSendingPlayer={(playerId) =>
                dispatch({ type: 'toggleSendingPlayer', playerId })
              }
              onToggleReceivingPlayer={(playerId) =>
                dispatch({ type: 'toggleReceivingPlayer', playerId })
              }
              onActiveRosterChange={(roster) => dispatch({ type: 'showRoster', roster })}
            />
            <TradeComparisonTable
              sendingTeamName={viewerTeam.teamName}
              receivingTeamName={partner.teamName}
              sendingPlayerIds={validSendingPlayerIds}
              receivingPlayerIds={validReceivingPlayerIds}
              playerStats={playerStats}
            />
          </>
        )}

        {(validationError || error) && (
          <p
            id={errorId}
            role="alert"
            className="rounded-lg border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--trade-text)]"
          >
            {validationError ?? error}
          </p>
        )}
      </div>

      <TradeSelectionTray
        selectedCount={validSendingPlayerIds.length + validReceivingPlayerIds.length}
        selectionComplete={selectionComplete}
        disabled={isSubmitting}
        reviewButtonRef={reviewButtonRef}
        onClear={() => {
          setValidationError(null);
          dispatch({ type: 'clearSelections' });
        }}
        onReview={showReview}
      />
    </div>
  );
}

function arePlayerIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((playerId, index) => playerId === right[index]);
}
