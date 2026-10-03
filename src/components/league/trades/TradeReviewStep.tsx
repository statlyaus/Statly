'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type React from 'react';

import type {
  TradePlayerDto,
  TradeRulesDto,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';
import { TradeSendCheckpoint, type TradeComposerMode } from './TradeSendCheckpoint';
import { TradeSquadImpact, TradeVerdictHeadline } from './TradeVerdictStrip';
import { buildTradeVerdict, squadPositionImpact } from './tradeVerdict';

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

/**
 * The confirm step, in the trade panel: who moves, the verdict, what it does to your squad, a
 * message, the terms and Send. The full numbers stay one tap away.
 */
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
  const breakdownId = useId();
  const messageHelpId = `${messageId}-help`;
  const messageCountId = `${messageId}-count`;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const verdict = buildTradeVerdict(sendingPlayerIds, receivingPlayerIds, playerStats);

  return (
    <section aria-label="Confirm trade" className="min-w-0">
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
      >
        <TradeVerdictHeadline verdict={verdict} />
        <TradeSquadImpact
          changes={squadPositionImpact(viewerTeam.players, sendingPlayers, receivingPlayers)}
        />
        <div>
          <label
            htmlFor={messageId}
            className="text-sm font-semibold text-[color:var(--trade-text)]"
          >
            Note (optional)
          </label>
          <textarea
            id={messageId}
            value={message}
            maxLength={1000}
            rows={3}
            disabled={isSubmitting}
            aria-describedby={`${messageHelpId} ${messageCountId}`}
            onChange={(event) => onMessageChange(event.target.value)}
            className="mt-1.5 w-full resize-y rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-3 py-2 text-sm text-[color:var(--trade-text)] outline-none placeholder:text-[color:var(--trade-text-muted)] focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:cursor-not-allowed disabled:bg-[color:var(--trade-surface-subtle)] disabled:opacity-60"
          />
          <div className="mt-1 flex justify-between gap-3 text-xs text-[color:var(--trade-text-muted)]">
            <p id={messageHelpId}>They’ll see this with the offer.</p>
            <p id={messageCountId} className="shrink-0 tabular-nums">
              {message.length} / 1000
            </p>
          </div>
        </div>
      </TradeSendCheckpoint>

      <div className="border-t border-[color:var(--trade-border)] px-4 py-2">
        <button
          type="button"
          aria-expanded={showBreakdown}
          aria-controls={breakdownId}
          onClick={() => setShowBreakdown((current) => !current)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-[color:var(--trade-text)] hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)]"
        >
          {showBreakdown ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4" />
          )}
          All categories
        </button>
        {showBreakdown ? (
          <div id={breakdownId} className="mt-2 pb-2">
            <TradeComparisonTable
              sendingTeamName={viewerTeam.teamName}
              receivingTeamName={partnerTeam.teamName}
              sendingPlayerIds={sendingPlayerIds}
              receivingPlayerIds={receivingPlayerIds}
              playerStats={playerStats}
              headingLevel={5}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
