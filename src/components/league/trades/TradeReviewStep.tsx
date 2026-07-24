'use client';

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
import { TradeSendCheckpoint, type TradeComposerMode } from './TradeSendCheckpoint';
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
  mode: TradeComposerMode;
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
  mode,
  playerStats,
  isSubmitting,
  error,
  headingRef,
  onMessageChange,
  onBack,
  onSubmit,
  onCancelCounter,
}: TradeReviewStepProps): React.JSX.Element {
  const messageId = useId();
  const messageHelpId = `${messageId}-help`;
  const messageCountId = `${messageId}-count`;
  const positionDeltas = Object.entries(getPositionDeltas(sendingPlayers, receivingPlayers));
  const meaningfulPositionDeltas = positionDeltas.filter(([, delta]) => delta !== 0);

  return (
    <section className="space-y-5" aria-label="Trade proposal review">
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
        {meaningfulPositionDeltas.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-[color:var(--trade-text)]">
            No positional balance change
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Position count changes">
            {meaningfulPositionDeltas.map(([position, delta]) => (
              <li
                key={position}
                className="rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface-subtle)] px-2.5 py-1 text-sm font-bold tabular-nums text-[color:var(--trade-text)]"
              >
                {position} {formatSignedInteger(delta)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] p-4">
        <label htmlFor={messageId} className="text-sm font-semibold text-[color:var(--trade-text)]">
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

      <TradeSendCheckpoint
        recipientTeamName={partnerTeam.teamName}
        sendingPlayers={sendingPlayers}
        receivingPlayers={receivingPlayers}
        rules={rules}
        mode={mode}
        isSubmitting={isSubmitting}
        error={error}
        headingRef={headingRef}
        onBack={onBack}
        onSubmit={onSubmit}
        onCancelCounter={onCancelCounter}
      />
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
