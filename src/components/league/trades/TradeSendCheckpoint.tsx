'use client';

import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import type React from 'react';

import type { TradePlayerDto, TradeRulesDto } from '@/server/leagues/trades/tradeContracts';

import {
  getTradeAcceptanceConsequence,
  getTradeDeadlineDescription,
  getTradeOfferExpiryDescription,
} from './tradeRulePresentation';

export type TradeComposerMode = 'proposal' | 'counteroffer';

interface TradeSendCheckpointProps {
  recipientTeamName: string;
  sendingPlayers: TradePlayerDto[];
  receivingPlayers: TradePlayerDto[];
  rules: TradeRulesDto;
  mode: TradeComposerMode;
  isSubmitting: boolean;
  error?: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onBack(): void;
  onSubmit(): void;
  onCancelCounter?(): void;
}

export function TradeSendCheckpoint({
  recipientTeamName,
  sendingPlayers,
  receivingPlayers,
  rules,
  mode,
  isSubmitting,
  error,
  headingRef,
  onBack,
  onSubmit,
  onCancelCounter,
}: TradeSendCheckpointProps): React.JSX.Element {
  const headingId = useId();
  const consequenceId = `${headingId}-consequence`;
  const isCounteroffer = mode === 'counteroffer';
  const actionName = isCounteroffer ? 'counteroffer' : 'proposal';
  const actionLabel = isSubmitting
    ? `Sending ${actionName} to ${recipientTeamName}…`
    : `Send ${actionName} to ${recipientTeamName}`;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={consequenceId}
      aria-busy={isSubmitting}
      className="overflow-hidden rounded-2xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] shadow-[var(--trade-card-shadow)]"
    >
      <header className="bg-[color:var(--trade-surface-dark)] px-5 py-5 text-white sm:px-6 sm:py-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/65">
          Final send checkpoint
        </p>
        <h4
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="mt-2 text-2xl font-bold tracking-tight text-white outline-none focus-visible:rounded focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
        >
          Send to {recipientTeamName}?
        </h4>
        <p className="mt-2 text-sm leading-5 text-white/75">
          The other manager receives this offer after submission.
        </p>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        <dl className="overflow-hidden rounded-xl border border-[color:var(--trade-border)]">
          <CheckpointRow label="You send">
            <PlayerList players={sendingPlayers} />
          </CheckpointRow>
          <CheckpointRow label="You receive">
            <PlayerList players={receivingPlayers} />
          </CheckpointRow>
          <CheckpointRow label="Expires">
            <p>{getTradeOfferExpiryDescription(rules)}</p>
          </CheckpointRow>
          <CheckpointRow label="Deadline" isLast>
            <p>{getTradeDeadlineDescription(rules.deadline)}</p>
          </CheckpointRow>
        </dl>

        <p
          id={consequenceId}
          className="rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 py-3 text-sm font-medium leading-6 text-[color:var(--trade-text-muted)]"
        >
          <strong className="font-bold text-[color:var(--trade-text)]">On acceptance: </strong>
          {getTradeAcceptanceConsequence(rules, recipientTeamName)}
        </p>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[color:var(--trade-warning)]/30 bg-[color:var(--trade-warning-soft)] p-3 text-sm font-semibold text-[color:var(--trade-text)]"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-[color:var(--trade-warning)]"
            />
            <p>{error}</p>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onBack}
            className={secondaryButtonClasses}
          >
            Back to edit
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onSubmit}
            className="inline-flex h-11 min-w-0 items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-4 text-center text-sm font-bold text-white shadow-sm transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[color:var(--trade-border-strong)] disabled:text-[color:var(--trade-text-muted)]"
          >
            {actionLabel}
          </button>
          {isCounteroffer && onCancelCounter && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancelCounter}
              className={`${secondaryButtonClasses} sm:col-span-2`}
            >
              Cancel counteroffer
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function CheckpointRow({
  label,
  children,
  isLast = false,
}: {
  label: 'You send' | 'You receive' | 'Expires' | 'Deadline';
  children: React.ReactNode;
  isLast?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start sm:gap-4 ${isLast ? '' : 'border-b border-[color:var(--trade-border)]'}`}
    >
      <dt className="font-semibold text-[color:var(--trade-text-muted)]">{label}</dt>
      <dd className="min-w-0 font-semibold text-[color:var(--trade-text)] sm:text-right">
        {children}
      </dd>
    </div>
  );
}

function PlayerList({ players }: { players: TradePlayerDto[] }): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {players.map((player) => (
        <li key={player.id} className="min-w-0">
          <span className="break-words font-bold">{player.name}</span>
          <span className="ml-2 text-xs text-[color:var(--trade-text-muted)]">
            {player.club} · {player.position}
          </span>
        </li>
      ))}
    </ul>
  );
}

const secondaryButtonClasses =
  'inline-flex h-11 min-w-0 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-center text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
