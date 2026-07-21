'use client';

import { useEffect, useState, type FormEvent } from 'react';

import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';

export interface TradeComposerSubmission {
  recipientMemberId: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message?: string;
}

interface TradeComposerProps {
  teams: TradeTeamDto[];
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
  initialPartnerMemberId,
  initialPlayerId,
  counterPartnerMemberId,
  isSubmitting,
  error,
  onSubmit,
  onCancelCounter,
}: TradeComposerProps): React.JSX.Element {
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
    initialPlayerId && requestedPlayerOwner && !requestedPlayerOwner.isViewer ? [initialPlayerId] : []
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
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Your active roster is not available, so a proposal cannot be created yet.
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
        Another active team must join before you can propose a trade.
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
      <div>
        <label htmlFor="trade-partner" className="text-sm font-medium text-foreground">
          Trade partner
        </label>
        <select
          id="trade-partner"
          value={partnerId}
          disabled={Boolean(counterPartnerMemberId) || isSubmitting}
          onChange={(event) => setPartnerId(event.target.value)}
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {partners.map((team) => (
            <option key={team.memberId} value={team.memberId}>
              {team.teamName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerChecklist
          legend={`Players from ${viewerTeam.teamName}`}
          description="Choose the players you will send."
          players={viewerTeam.players}
          selectedIds={sendingPlayerIds}
          disabled={isSubmitting}
          onChange={setSendingPlayerIds}
        />
        <PlayerChecklist
          legend={`Players from ${partner?.teamName ?? 'the other team'}`}
          description="Choose the players you want to receive."
          players={partner?.players ?? []}
          selectedIds={receivingPlayerIds}
          disabled={isSubmitting}
          onChange={setReceivingPlayerIds}
        />
      </div>

      <div>
        <label htmlFor="trade-message" className="text-sm font-medium text-foreground">
          Message <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="trade-message"
          value={message}
          maxLength={1000}
          disabled={isSubmitting}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add context for the other manager"
          className="mt-2 min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-muted-foreground">{message.length}/1000 characters</p>
      </div>

      {(validationError || error) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {validationError ?? error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {isSubmitting
            ? 'Sending…'
            : counterPartnerMemberId
              ? 'Send counteroffer'
              : 'Send proposal'}
        </button>
        {counterPartnerMemberId && onCancelCounter && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancelCounter}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel counteroffer
          </button>
        )}
      </div>
    </form>
  );
}

function PlayerChecklist({
  legend,
  description,
  players,
  selectedIds,
  disabled,
  onChange,
}: {
  legend: string;
  description: string;
  players: TradeTeamDto['players'];
  selectedIds: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}): React.JSX.Element {
  return (
    <fieldset className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">{legend}</legend>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      {players.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rostered players are available.</p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {players.map((player) => {
            const checked = selectedIds.includes(player.id);
            return (
              <div
                key={player.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-border hover:bg-background has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
              >
                <input
                  id={`trade-player-${player.id}`}
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      checked
                        ? selectedIds.filter((id) => id !== player.id)
                        : [...selectedIds, player.id]
                    )
                  }
                  className="mt-0.5 size-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label htmlFor={`trade-player-${player.id}`} className="min-w-0 cursor-pointer">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {player.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[player.position, player.club].filter(Boolean).join(' · ')}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
