import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LineupFieldBoard } from '@/components/league/matchups/LineupFieldBoard';
import type {
  LineupAssignment,
  LineupFieldSpot,
  LineupRosterPlayer,
} from '@/components/league/matchups/lineupBuilderTypes';

const forwardSpot: LineupFieldSpot = {
  id: 'FWD-0',
  label: 'Forward 1',
  slot: 'FWD',
  slotIndex: 0,
};

const rosterPlayers: LineupRosterPlayer[] = [
  { playerId: 'player-1', name: 'Assigned Player', position: 'FWD', club: 'AAA' },
  { playerId: 'player-2', name: 'Available Player', position: 'MID', club: 'BBB' },
];

const assignments: LineupAssignment[] = [
  { playerId: 'player-1', slot: 'FWD', slotIndex: 0, lockedAt: null },
];

describe('LineupFieldBoard disabled state', () => {
  it('removes an assignment target from focus until a player is selected', () => {
    render(
      <LineupFieldBoard
        spots={[forwardSpot]}
        interchangeSpots={[]}
        assignments={assignments}
        rosterPlayers={rosterPlayers}
        availablePlayers={[rosterPlayers[1]]}
        selectedPlayerId={null}
        getDragPlayerId={() => null}
        onSelectPlayer={vi.fn()}
        setDragPlayer={vi.fn()}
        onAssignPlayer={vi.fn()}
        onClearSpot={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Forward 1, FWD · AAA/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Clear Assigned Player/ })).toBeEnabled();
  });

  it('removes lineup actions from focus and suppresses drag, drop, selection, and clear', () => {
    const onSelectPlayer = vi.fn();
    const setDragPlayer = vi.fn();
    const onAssignPlayer = vi.fn();
    const onClearSpot = vi.fn();

    render(
      <LineupFieldBoard
        spots={[forwardSpot]}
        interchangeSpots={[]}
        assignments={assignments}
        rosterPlayers={rosterPlayers}
        availablePlayers={[rosterPlayers[1]]}
        selectedPlayerId="player-2"
        getDragPlayerId={() => 'player-2'}
        onSelectPlayer={onSelectPlayer}
        setDragPlayer={setDragPlayer}
        onAssignPlayer={onAssignPlayer}
        onClearSpot={onClearSpot}
        disabled
        disabledReason="No matchup is scheduled for this round."
      />
    );

    const board = screen.getByRole('group', { name: 'AFL field lineup builder' });
    expect(board).toHaveAttribute('aria-disabled', 'true');
    expect(board).toHaveAccessibleDescription('No matchup is scheduled for this round.');

    const slotButton = screen.getByRole('button', { name: /Forward 1, Unavailable/ });
    const rosterButton = screen.getByRole('button', { name: /Available Player/ });
    expect(slotButton).toBeDisabled();
    expect(rosterButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Clear Assigned Player/ })).not.toBeInTheDocument();

    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'all',
      getData: vi.fn(() => 'player-2'),
      setData: vi.fn(),
    };
    fireEvent.dragStart(rosterButton, { dataTransfer });
    fireEvent.drop(slotButton.parentElement as HTMLElement, { dataTransfer });
    fireEvent.click(slotButton);
    fireEvent.click(rosterButton);

    expect(onSelectPlayer).not.toHaveBeenCalled();
    expect(setDragPlayer).not.toHaveBeenCalled();
    expect(onAssignPlayer).not.toHaveBeenCalled();
    expect(onClearSpot).not.toHaveBeenCalled();
  });
});
