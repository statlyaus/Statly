'use client';

import { useId } from 'react';

import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeRosterTable } from './TradeRosterTable';

export interface TradeRosterWorkspaceProps {
  viewerTeam: TradeTeamDto;
  partnerTeam: TradeTeamDto;
  playerStats: LeaguePlayerStatDatasetDto;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  activeRoster: 'sending' | 'receiving';
  disabled: boolean;
  onToggleSendingPlayer: (playerId: string) => void;
  onToggleReceivingPlayer: (playerId: string) => void;
  onActiveRosterChange: (roster: 'sending' | 'receiving') => void;
}

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

  return (
    <div className="min-w-0 space-y-4">
      <div
        role="group"
        aria-label="Choose roster"
        className="grid grid-cols-2 gap-1 rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface-subtle)] p-1 lg:hidden"
      >
        <RosterSwitchButton
          label="Send"
          teamName={viewerTeam.teamName}
          selectedCount={sendingPlayerIds.length}
          controls={sendingPanelId}
          pressed={activeRoster === 'sending'}
          onClick={() => onActiveRosterChange('sending')}
        />
        <RosterSwitchButton
          label="Receive"
          teamName={partnerTeam.teamName}
          selectedCount={receivingPlayerIds.length}
          controls={receivingPanelId}
          pressed={activeRoster === 'receiving'}
          onClick={() => onActiveRosterChange('receiving')}
        />
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div
          id={sendingPanelId}
          className={`min-w-0 ${activeRoster === 'sending' ? 'block' : 'hidden lg:block'}`}
        >
          <TradeRosterTable
            team={viewerTeam}
            playerStats={playerStats}
            selectedIds={sendingPlayerIds}
            disabled={disabled}
            onTogglePlayer={onToggleSendingPlayer}
          />
        </div>
        <div
          id={receivingPanelId}
          className={`min-w-0 ${activeRoster === 'receiving' ? 'block' : 'hidden lg:block'}`}
        >
          <TradeRosterTable
            team={partnerTeam}
            playerStats={playerStats}
            selectedIds={receivingPlayerIds}
            disabled={disabled}
            onTogglePlayer={onToggleReceivingPlayer}
          />
        </div>
      </div>
    </div>
  );
}

function RosterSwitchButton({
  label,
  teamName,
  selectedCount,
  controls,
  pressed,
  onClick,
}: {
  label: 'Send' | 'Receive';
  teamName: string;
  selectedCount: number;
  controls: string;
  pressed: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={`${label} ${teamName}, ${selectedCount} selected`}
      aria-pressed={pressed}
      aria-controls={controls}
      onClick={onClick}
      className={`inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] ${
        pressed
          ? 'bg-[color:var(--trade-selection)] text-white shadow-sm'
          : 'bg-[color:var(--trade-surface)] text-[color:var(--trade-text-muted)] hover:bg-[color:var(--trade-action-soft)] hover:text-[color:var(--trade-text)]'
      }`}
    >
      <span>{label}</span>
      <span className="truncate text-xs tabular-nums">{selectedCount} selected</span>
    </button>
  );
}
