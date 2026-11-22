'use client';

import { ArrowRight } from 'lucide-react';
import { useId } from 'react';

import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeRosterTable } from './TradeRosterTable';

type RosterSide = 'sending' | 'receiving';

export interface TradeRosterWorkspaceProps {
  viewerTeam: TradeTeamDto;
  partnerTeam: TradeTeamDto;
  playerStats: LeaguePlayerStatDatasetDto;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  activeRoster: RosterSide;
  disabled: boolean;
  onToggleSendingPlayer: (playerId: string) => void;
  onToggleReceivingPlayer: (playerId: string) => void;
  onActiveRosterChange: (roster: RosterSide) => void;
}

/**
 * Both rosters in one card, one at a time so each table gets the full width for its stats. The
 * underlined tabs name the two sides of the deal, "You give" (your roster) and "You get" (theirs).
 */
export function TradeRosterWorkspace({
  viewerTeam,
  partnerTeam,
  playerStats,
  sendingPlayerIds,
  receivingPlayerIds,
  activeRoster,
  disabled,
  onToggleSendingPlayer,
  onToggleReceivingPlayer,
  onActiveRosterChange,
}: TradeRosterWorkspaceProps): React.JSX.Element {
  const id = useId();
  const sendingPanelId = `${id}-sending-roster`;
  const receivingPanelId = `${id}-receiving-roster`;
  const onSending = activeRoster === 'sending';
  const otherSideEmpty = onSending
    ? sendingPlayerIds.length > 0 && receivingPlayerIds.length === 0
    : receivingPlayerIds.length > 0 && sendingPlayerIds.length === 0;
  const nextStep =
    otherSideEmpty && !disabled ? (
      <button
        type="button"
        onClick={() => onActiveRosterChange(onSending ? 'receiving' : 'sending')}
        className="inline-flex h-9 items-center gap-1.5 rounded-cut px-2 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        {onSending ? `Next: pick from ${partnerTeam.teamName}` : 'Next: pick who you give'}
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
    ) : (
      <span />
    );

  return (
    <div className="min-w-0 overflow-hidden border border-border bg-card">
      <div
        role="group"
        aria-label="Choose roster"
        className="flex overflow-x-auto border-b border-border px-2"
      >
        <RosterSideButton
          direction="You give"
          teamName={viewerTeam.teamName}
          selectedCount={sendingPlayerIds.length}
          controls={sendingPanelId}
          pressed={onSending}
          onClick={() => onActiveRosterChange('sending')}
        />
        <RosterSideButton
          direction="You get"
          teamName={partnerTeam.teamName}
          selectedCount={receivingPlayerIds.length}
          controls={receivingPanelId}
          pressed={!onSending}
          onClick={() => onActiveRosterChange('receiving')}
        />
      </div>

      <div id={sendingPanelId} className={`min-w-0 ${onSending ? 'block' : 'hidden'}`}>
        <TradeRosterTable
          team={viewerTeam}
          playerStats={playerStats}
          selectedIds={sendingPlayerIds}
          disabled={disabled}
          onTogglePlayer={onToggleSendingPlayer}
          toolbarEnd={onSending ? nextStep : <span />}
        />
      </div>
      <div id={receivingPanelId} className={`min-w-0 ${onSending ? 'hidden' : 'block'}`}>
        <TradeRosterTable
          team={partnerTeam}
          playerStats={playerStats}
          selectedIds={receivingPlayerIds}
          disabled={disabled}
          onTogglePlayer={onToggleReceivingPlayer}
          toolbarEnd={onSending ? <span /> : nextStep}
        />
      </div>
    </div>
  );
}

function RosterSideButton({
  direction,
  teamName,
  selectedCount,
  controls,
  pressed,
  onClick,
}: {
  direction: 'You give' | 'You get';
  teamName: string;
  selectedCount: number;
  controls: string;
  pressed: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={`${direction} from ${teamName}, ${selectedCount} selected`}
      aria-pressed={pressed}
      aria-controls={controls}
      onClick={onClick}
      className={`-mb-px inline-flex h-12 min-w-0 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        pressed
          ? 'border-brand-bar text-foreground'
          : 'border-transparent text-muted-foreground hover:border-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="font-semibold">{direction}</span>
      <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
        ·
      </span>
      <span className="hidden max-w-[12rem] truncate sm:inline">{teamName}</span>
      <span
        className={`min-w-5 px-1.5 text-center text-xs font-bold leading-5 tabular-nums ${
          selectedCount > 0 ? 'bg-brand-bar text-brand-bar-foreground' : 'text-muted-foreground'
        }`}
      >
        {selectedCount}
      </span>
    </button>
  );
}
