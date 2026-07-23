'use client';

import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import type React from 'react';

import { getTeamAbbreviation, getTeamName } from '@/lib/teamLogos';
import type {
  TradePlayerDto,
  TradeRulesDto,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';
import { getPositionDeltas } from './tradeComposerState';

export interface TradeReviewStepProps {
  viewerTeam: TradeTeamDto;
  partnerTeam: TradeTeamDto;
  sendingPlayers: TradePlayerDto[];
  receivingPlayers: TradePlayerDto[];
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message: string;
  rules: TradeRulesDto;
  playerStats: LeaguePlayerStatDatasetDto;
  isSubmitting: boolean;
  error?: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onMessageChange(message: string): void;
  onBack(): void;
  onSubmit(): void;
  onCancelCounter?(): void;
}

export function TradeReviewStep({
  viewerTeam,
  partnerTeam,
  sendingPlayers,
  receivingPlayers,
  sendingPlayerIds,
  receivingPlayerIds,
  message,
  rules,
  playerStats,
  isSubmitting,
  error,
  headingRef,
  onMessageChange,
  onBack,
  onSubmit,
  onCancelCounter,
}: TradeReviewStepProps): React.JSX.Element {
  const reviewHeadingId = useId();
  const messageId = useId();
  const messageHelpId = `${messageId}-help`;
  const messageCountId = `${messageId}-count`;
  const positionDeltas = Object.entries(getPositionDeltas(sendingPlayers, receivingPlayers));
  const finalActionLabel = onCancelCounter ? 'Send counteroffer' : 'Send proposal';

  return (
    <section className="space-y-5" aria-labelledby={reviewHeadingId}>
      <header>
        <h4
          ref={headingRef}
          id={reviewHeadingId}
          tabIndex={-1}
          className="text-lg font-bold tracking-tight text-[color:var(--trade-text)] outline-none focus-visible:rounded focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
        >
          Review trade proposal
        </h4>
        <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
          Confirm the packages and league timing before sending.
        </p>
      </header>

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <PackageCard heading="You send" team={viewerTeam} players={sendingPlayers} />
        <PackageCard heading="You receive" team={partnerTeam} players={receivingPlayers} />
      </div>

      <TradeComparisonTable
        sendingTeamName={viewerTeam.teamName}
        receivingTeamName={partnerTeam.teamName}
        sendingPlayerIds={sendingPlayerIds}
        receivingPlayerIds={receivingPlayerIds}
        playerStats={playerStats}
        headingLevel={5}
      />

      <section
        aria-label="Package position change"
        className="rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] p-4"
      >
        <h5 className="text-base font-bold text-[color:var(--trade-text)]">
          Package position change
        </h5>
        <p className="mt-1 text-xs text-[color:var(--trade-text-muted)]">
          Package balance only; not a lineup projection.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Position count changes">
          {positionDeltas.map(([position, delta]) => (
            <li
              key={position}
              className="rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface-subtle)] px-2.5 py-1 text-sm font-bold tabular-nums text-[color:var(--trade-text)]"
            >
              {position} {formatSignedInteger(delta)}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] p-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <label
            htmlFor={messageId}
            className="text-sm font-semibold text-[color:var(--trade-text)]"
          >
            Message (optional)
          </label>
          <textarea
            id={messageId}
            value={message}
            maxLength={1000}
            rows={4}
            disabled={isSubmitting}
            aria-describedby={`${messageHelpId} ${messageCountId}`}
            onChange={(event) => onMessageChange(event.target.value)}
            className="mt-2 w-full resize-y rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-3 py-2 text-sm text-[color:var(--trade-text)] outline-none placeholder:text-[color:var(--trade-text-muted)] focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:cursor-not-allowed disabled:bg-[color:var(--trade-surface-subtle)] disabled:opacity-60"
            placeholder="Add a note about the proposal"
          />
          <div className="mt-1 flex justify-between gap-3 text-xs text-[color:var(--trade-text-muted)]">
            <p id={messageHelpId}>Add context for the other team.</p>
            <p id={messageCountId} className="shrink-0 tabular-nums">
              {message.length} / 1000
            </p>
          </div>
        </div>

        <dl className="grid content-start gap-2 text-sm md:min-w-60">
          <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-3 py-2">
            <dt className="text-xs font-semibold text-[color:var(--trade-text-muted)]">
              League deadline
            </dt>
            <dd className="mt-0.5 font-bold text-[color:var(--trade-text)]">
              {formatDeadline(rules.deadline)}
            </dd>
          </div>
          <div className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-3 py-2">
            <dt className="sr-only">Offer expiry</dt>
            <dd className="font-semibold text-[color:var(--trade-text)]">
              Expires {rules.offerExpiryHours} {rules.offerExpiryHours === 1 ? 'hour' : 'hours'}{' '}
              after sending
              {rules.deadline ? ' or at the league deadline, whichever comes first' : ''}
            </dd>
          </div>
        </dl>
      </div>

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

      <div className="flex flex-col-reverse gap-2 border-t border-[color:var(--trade-border)] pt-4 sm:flex-row sm:items-center sm:justify-end">
        {onCancelCounter && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancelCounter}
            className={secondaryButtonClasses}
          >
            Cancel counteroffer
          </button>
        )}
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
          className="inline-flex h-11 items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[color:var(--trade-border-strong)] disabled:text-[color:var(--trade-text-muted)]"
        >
          {isSubmitting ? 'Sending…' : finalActionLabel}
        </button>
      </div>
    </section>
  );
}

function PackageCard({
  heading,
  team,
  players,
}: {
  heading: 'You send' | 'You receive';
  team: TradeTeamDto;
  players: TradePlayerDto[];
}): React.JSX.Element {
  return (
    <section
      aria-label={`${heading} package`}
      className="min-w-0 overflow-hidden rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
    >
      <div className="border-b border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 py-3">
        <h5 className="text-base font-bold text-[color:var(--trade-text)]">{heading}</h5>
        <p className="mt-0.5 text-xs text-[color:var(--trade-text-muted)]">{team.teamName}</p>
      </div>
      <ul className="divide-y divide-[color:var(--trade-border)]">
        {players.map((player) => {
          const clubAbbreviation = getTeamAbbreviation(player.club);
          const clubName = getTeamName(player.club);

          return (
            <li key={player.id} className="px-4 py-2.5">
              <p className="text-sm font-semibold text-[color:var(--trade-text)]">{player.name}</p>
              <p className="mt-0.5 text-xs text-[color:var(--trade-text-muted)]">
                {clubAbbreviation} · {clubName} · {player.position}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatSignedInteger(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}`;
}

function formatDeadline(value: string | null): string {
  if (!value) return 'No league deadline';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'No league deadline'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const secondaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
