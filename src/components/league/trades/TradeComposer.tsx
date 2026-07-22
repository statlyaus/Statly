'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';

import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';
import { TradeRosterTable } from './TradeRosterTable';

export interface TradeComposerSubmission {
  recipientMemberId: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message?: string;
}

interface TradeComposerProps {
  teams: TradeTeamDto[];
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
  const messageHelpId = useId();
  const viewerTeam = teams.find((team) => team.isViewer) ?? null;
  const partners = teams.filter((team) => !team.isViewer);
  const requestedPlayerOwner = initialPlayerId
    ? teams.find((team) => team.players.some((player) => player.id === initialPlayerId))
    : null;
  const preferredPartnerId =
    counterPartnerMemberId ??
    (initialPartnerMemberId && initialPartnerMemberId !== viewerTeam?.memberId
      ? initialPartnerMemberId
      : requestedPlayerOwner && !requestedPlayerOwner.isViewer
        ? requestedPlayerOwner.memberId
        : null);
  const [partnerId, setPartnerId] = useState(preferredPartnerId ?? partners[0]?.memberId ?? '');
  const [sendingPlayerIds, setSendingPlayerIds] = useState<string[]>(() =>
    initialPlayerId && requestedPlayerOwner?.isViewer ? [initialPlayerId] : []
  );
  const [receivingPlayerIds, setReceivingPlayerIds] = useState<string[]>(() =>
    initialPlayerId && requestedPlayerOwner && !requestedPlayerOwner.isViewer
      ? [initialPlayerId]
      : []
  );
  const [message, setMessage] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const partner = partners.find((team) => team.memberId === partnerId) ?? null;

  useEffect(() => {
    if (!preferredPartnerId || !partners.some((team) => team.memberId === preferredPartnerId)) {
      return;
    }
    setPartnerId(preferredPartnerId);
  }, [preferredPartnerId, teams]);

  useEffect(() => {
    const partnerPlayerIds = new Set(
      teams.find((team) => team.memberId === partnerId)?.players.map((player) => player.id) ?? []
    );
    setReceivingPlayerIds((selected) =>
      selected.filter((playerId) => partnerPlayerIds.has(playerId))
    );
  }, [partnerId, teams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setValidationError(null);

    if (!partnerId) {
      setValidationError('Choose a trade partner.');
      return;
    }
    if (sendingPlayerIds.length === 0 || receivingPlayerIds.length === 0) {
      setValidationError('Select at least one player from each team.');
      return;
    }

    const saved = await onSubmit({
      recipientMemberId: partnerId,
      sendingPlayerIds,
      receivingPlayerIds,
      message: message.trim() || undefined,
    });
    if (saved) {
      setSendingPlayerIds([]);
      setReceivingPlayerIds([]);
      setMessage('');
    }
  }

  if (!viewerTeam) {
    return (
      <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-4 text-sm text-[color:var(--trade-text-muted)]">
        Your active roster is not available, so a proposal cannot be created yet.
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

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      aria-describedby={validationError || error ? errorId : undefined}
      className="space-y-6"
    >
      <div className="max-w-md">
        <label
          htmlFor="trade-partner"
          className="text-sm font-semibold text-[color:var(--trade-text)]"
        >
          Trade partner
        </label>
        <select
          id="trade-partner"
          value={partnerId}
          disabled={Boolean(counterPartnerMemberId) || isSubmitting}
          onChange={(event) => setPartnerId(event.target.value)}
          className="mt-2 h-11 w-full rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-3 text-sm font-medium text-[color:var(--trade-text)] shadow-sm outline-none transition focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:cursor-not-allowed disabled:bg-[color:var(--trade-surface-subtle)] disabled:opacity-60"
        >
          {partners.map((team) => (
            <option key={team.memberId} value={team.memberId}>
              {team.teamName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <div className="min-w-0 [--trade-direction:var(--trade-send)] [--trade-direction-soft:var(--trade-send-soft)]">
          <TradeRosterTable
            label="You send"
            description={viewerTeam.teamName}
            players={viewerTeam.players}
            playerStats={playerStats}
            selectedIds={sendingPlayerIds}
            disabled={isSubmitting}
            onSelectionChange={setSendingPlayerIds}
          />
        </div>
        <div className="min-w-0 [--trade-direction:var(--trade-receive)] [--trade-direction-soft:var(--trade-receive-soft)]">
          <TradeRosterTable
            label={`You receive from ${partner?.teamName ?? 'the other team'}`}
            description="Select one or more players"
            players={partner?.players ?? []}
            playerStats={playerStats}
            selectedIds={receivingPlayerIds}
            disabled={isSubmitting}
            onSelectionChange={setReceivingPlayerIds}
          />
        </div>
      </div>

      <TradeComparisonTable
        sendingPlayerIds={sendingPlayerIds}
        receivingPlayerIds={receivingPlayerIds}
        playerStats={playerStats}
      />

      {(validationError || error) && (
        <p
          id={errorId}
          role="alert"
          className="rounded-lg border border-[color:var(--trade-negative)]/25 bg-[color:var(--trade-error-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--trade-negative)]"
        >
          {validationError ?? error}
        </p>
      )}

      <div className="-mx-4 -mb-4 border-t border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 pb-4 pt-5 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-6">
        <div>
          <label
            htmlFor="trade-message"
            className="text-sm font-semibold text-[color:var(--trade-text)]"
          >
            Message{' '}
            <span className="font-normal text-[color:var(--trade-text-muted)]">(optional)</span>
          </label>
          <textarea
            id="trade-message"
            value={message}
            maxLength={1000}
            disabled={isSubmitting}
            aria-describedby={messageHelpId}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Add context for the other manager"
            className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-3 py-2 text-sm text-[color:var(--trade-text)] shadow-sm outline-none placeholder:text-[color:var(--trade-text-muted)] focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p
            id={messageHelpId}
            className="mt-1 text-right text-xs tabular-nums text-[color:var(--trade-text-muted)]"
          >
            {message.length}/1000 characters
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:mt-0">
          {counterPartnerMemberId && onCancelCounter && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancelCounter}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
            >
              Cancel counteroffer
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[color:var(--trade-border-strong)] disabled:text-[color:var(--trade-text-muted)] sm:w-auto"
          >
            {isSubmitting
              ? 'Sending…'
              : counterPartnerMemberId
                ? 'Send counteroffer'
                : 'Send proposal'}
          </button>
        </div>
      </div>
    </form>
  );
}
