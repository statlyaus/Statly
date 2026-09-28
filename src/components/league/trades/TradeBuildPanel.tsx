'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import type React from 'react';

import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradePlayerChip } from './TradePlayerChip';
import { TradeSelectionTray } from './TradeSelectionTray';
import { TradeSquadImpact, TradeVerdictStrip } from './TradeVerdictStrip';
import type { SquadPositionChange, TradeVerdict } from './tradeVerdict';

export interface TradeBuildPanelProps {
  partnerTeamName: string;
  give: TradePlayerDto[];
  get: TradePlayerDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  verdict: TradeVerdict;
  squadChanges: SquadPositionChange[];
  selectionComplete: boolean;
  disabled: boolean;
  reviewButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** Phones show the panel as a bottom sheet that starts folded to its footer. */
  sheetOpen: boolean;
  onToggleSheet: () => void;
  onRemoveGive: (playerId: string) => void;
  onRemoveGet: (playerId: string) => void;
  onClear: () => void;
  onReview: () => void;
}

/**
 * The deal being built, beside the rosters: what you give, what you get, the verdict, the squad
 * change and Review. Sections share one label style and are split by dividers, with no boxes
 * inside the card.
 */
export function TradeBuildPanel({
  partnerTeamName,
  give,
  get,
  playerStats,
  verdict,
  squadChanges,
  selectionComplete,
  disabled,
  reviewButtonRef,
  sheetOpen,
  onToggleSheet,
  onRemoveGive,
  onRemoveGet,
  onClear,
  onReview,
}: TradeBuildPanelProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col">
      <button
        type="button"
        aria-expanded={sheetOpen}
        aria-controls="trade-build-panel-body"
        onClick={onToggleSheet}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)] lg:hidden"
      >
        <span>
          Your trade{' '}
          <span className="font-normal text-[color:var(--trade-text-muted)]">
            · give {give.length} · get {get.length}
          </span>
        </span>
        {sheetOpen ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronUp aria-hidden="true" className="size-4" />
        )}
      </button>

      <div
        id="trade-build-panel-body"
        className={`${sheetOpen ? 'block' : 'hidden'} min-h-0 overflow-y-auto lg:block`}
      >
        <header className="hidden h-12 items-center border-b border-[color:var(--trade-border)] px-4 lg:flex">
          <h4 className="text-sm font-semibold text-[color:var(--trade-text)]">Your trade</h4>
        </header>

        <div className="divide-y divide-[color:var(--trade-border)]">
          <DealList
            title="You give"
            empty="Tick players on the You give tab."
            players={give}
            playerStats={playerStats}
            disabled={disabled}
            onRemove={onRemoveGive}
          />
          <DealList
            title="You get"
            empty={`Tick players on the You get tab.`}
            players={get}
            playerStats={playerStats}
            disabled={disabled}
            onRemove={onRemoveGet}
          />
          {selectionComplete ? (
            <>
              <div className="px-4 py-3">
                <TradeVerdictStrip
                  verdict={verdict}
                  otherSide={partnerTeamName}
                  season={playerStats.context.season}
                  compact
                />
              </div>
              <div className="px-4 py-3">
                <TradeSquadImpact changes={squadChanges} showBasis={false} />
              </div>
              <p className="px-4 py-2.5 text-xs text-[color:var(--trade-text-muted)]">
                Per-game averages, {playerStats.context.season} season. Dual-position players count
                in both.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <TradeSelectionTray
        selectedCount={give.length + get.length}
        selectionComplete={selectionComplete}
        disabled={disabled}
        reviewButtonRef={reviewButtonRef}
        onClear={onClear}
        onReview={onReview}
        verdict={verdict}
      />
    </div>
  );
}

function DealList({
  title,
  empty,
  players,
  playerStats,
  disabled,
  onRemove,
}: {
  title: string;
  empty: string;
  players: TradePlayerDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  disabled: boolean;
  onRemove: (playerId: string) => void;
}): React.JSX.Element {
  return (
    <section aria-label={title} className="min-w-0 px-4 py-3">
      <h5 className="text-sm font-semibold text-[color:var(--trade-text)]">
        {title}
        {players.length > 0 ? (
          <span className="ml-1.5 font-normal tabular-nums text-[color:var(--trade-text-muted)]">
            {players.length}
          </span>
        ) : null}
      </h5>
      {players.length === 0 ? (
        <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">{empty}</p>
      ) : (
        <ul className="mt-0.5 divide-y divide-[color:var(--trade-border)]">
          {players.map((player) => (
            <li key={player.id}>
              <TradePlayerChip
                player={player}
                playerStats={playerStats}
                bare
                onRemove={disabled ? undefined : () => onRemove(player.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
