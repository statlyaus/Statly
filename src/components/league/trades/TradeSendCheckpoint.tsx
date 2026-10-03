'use client';

import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import type React from 'react';

import { GuernseyIcon } from '@/components/league/myteam/FieldArt';
import { guernseyFor } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';
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
  /** Extra review content (verdict, squad impact, message) shown between the facts and the send. */
  children?: React.ReactNode;
}

/** The last step before an offer goes out: who moves, the terms, and Send. */
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
  children,
}: TradeSendCheckpointProps): React.JSX.Element {
  const headingId = useId();
  const consequenceId = `${headingId}-consequence`;
  const isCounteroffer = mode === 'counteroffer';
  const actionName = isCounteroffer ? 'counter' : 'offer';
  const actionLabel = isSubmitting
    ? `Sending ${actionName} to ${recipientTeamName}…`
    : `Send ${actionName} to ${recipientTeamName}`;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={consequenceId}
      aria-busy={isSubmitting}
      className="min-w-0"
    >
      <header className="border-b border-[color:var(--trade-border)] px-4 py-3">
        <h4
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="text-lg font-bold leading-tight text-[color:var(--trade-text)] outline-none focus-visible:rounded focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
        >
          Send to {recipientTeamName}?
        </h4>
      </header>

      <div className="space-y-4 px-4 py-3">
        <dl className="divide-y divide-[color:var(--trade-border)] text-sm">
          <CheckpointRow label="You send">
            <PlayerList label="You send package" players={sendingPlayers} />
          </CheckpointRow>
          <CheckpointRow label="You receive">
            <PlayerList label="You receive package" players={receivingPlayers} />
          </CheckpointRow>
          <CheckpointRow label="Expires">
            <p>{getTradeOfferExpiryDescription(rules)}</p>
          </CheckpointRow>
          <CheckpointRow label="Deadline">
            <p>{getTradeDeadlineDescription(rules.deadline)}</p>
          </CheckpointRow>
        </dl>

        {children}

        <p
          id={consequenceId}
          className="rounded-md bg-[color:var(--trade-surface-subtle)] px-3 py-2 text-xs leading-5 text-[color:var(--trade-text-muted)]"
        >
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

        <div className="grid gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onBack}
            className={secondaryButtonClasses}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onSubmit}
            className="order-first inline-flex h-11 min-w-0 items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-4 text-center text-sm font-bold text-white shadow-sm transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[color:var(--trade-border-strong)] disabled:text-[color:var(--trade-text-muted)]"
          >
            {actionLabel}
          </button>
          {isCounteroffer && onCancelCounter && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancelCounter}
              className={secondaryButtonClasses}
            >
              Cancel counter
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
}: {
  label: 'You send' | 'You receive' | 'Expires' | 'Deadline';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="font-semibold text-[color:var(--trade-text-muted)]">{label}</dt>
      <dd className="min-w-0 font-semibold text-[color:var(--trade-text)]">{children}</dd>
    </div>
  );
}

function PlayerList({
  label,
  players,
}: {
  label: string;
  players: TradePlayerDto[];
}): React.JSX.Element {
  return (
    <section aria-label={label}>
      <ul className="space-y-1.5">
        {players.map((player) => (
          <li key={player.id} className="flex min-w-0 items-center gap-2">
            <GuernseyIcon guernsey={guernseyFor(player.club)} className="h-6 w-5 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate font-bold">{player.name}</span>
              <span className="block text-xs font-medium text-[color:var(--trade-text-muted)]">
                {getTeamAbbreviation(player.club)} · {player.position}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const secondaryButtonClasses =
  'inline-flex h-11 min-w-0 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-center text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
