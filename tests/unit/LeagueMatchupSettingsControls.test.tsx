import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LineupFieldBoard } from '@/components/league/matchups/LineupFieldBoard';
import type {
  LineupAssignment,
  LineupFieldSpot,
  LineupRosterPlayer,
} from '@/components/league/matchups/lineupBuilderTypes';
import { CompetitionSettingsPanel } from '@/components/league/settings/CompetitionSettingsPanel';
import type { LeagueFixtureGenerationMode } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

const fieldSpot: LineupFieldSpot = {
  id: 'FWD-0',
  slot: 'FWD',
  slotIndex: 0,
  label: 'Forward 1',
};

const rosterPlayers: LineupRosterPlayer[] = [
  { playerId: 'player-1', name: 'Assigned Player', position: 'FWD', club: 'Club A' },
  { playerId: 'player-2', name: 'Available Player', position: 'MID', club: 'Club B' },
];

const assignments: LineupAssignment[] = [
  { playerId: 'player-1', slot: 'FWD', slotIndex: 0, lockedAt: null },
];

const automaticRules = {
  seasonStartAflRound: 1,
  regularSeasonRounds: 11,
  finalsTeams: 4 as const,
  fixtureGenerationMode: 'AUTOMATIC' as const,
  lockPolicy: 'INDIVIDUAL_GAME_START' as const,
  leagueTimeZone: 'Australia/Melbourne',
  interchangeSlots: 3,
  standingsTieBreakCategory: 'goals' as const,
  excludedAflRounds: [],
};

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

function competitionSnapshot() {
  return {
    success: true,
    data: {
      canManage: true,
      teamCount: 12,
      rosterSize: 22,
      categories: ['goals'],
      status: 'SETUP',
      fixtureVersion: 0,
      publishedAt: null,
      rules: automaticRules,
      rounds: [],
      audit: [],
    },
  };
}

describe('LineupFieldBoard disabled controls', () => {
  it('removes mutation controls from interaction and announces the disabled reason', () => {
    const onSelectPlayer = vi.fn();
    const setDragPlayer = vi.fn();
    const onAssignPlayer = vi.fn();
    const onClearSpot = vi.fn();

    render(
      <LineupFieldBoard
        spots={[fieldSpot]}
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
        disabledReason="This lineup is locked."
      />
    );

    const board = screen.getByRole('group', { name: 'AFL field lineup builder' });
    expect(board).toHaveAttribute('aria-disabled', 'true');
    expect(board).toHaveAccessibleDescription('This lineup is locked.');

    const spotButton = screen.getByRole('button', { name: /Forward 1/ });
    const availablePlayerButton = screen.getByText('Available Player').closest('button');
    expect(spotButton).toBeDisabled();
    expect(availablePlayerButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Clear Assigned Player/ })).not.toBeInTheDocument();

    fireEvent.drop(spotButton.parentElement as HTMLElement, {
      dataTransfer: { getData: () => 'player-2' },
    });
    fireEvent.dragStart(availablePlayerButton as HTMLButtonElement, {
      dataTransfer: { effectAllowed: '', setData: vi.fn() },
    });
    fireEvent.click(availablePlayerButton as HTMLButtonElement);

    expect(onAssignPlayer).not.toHaveBeenCalled();
    expect(setDragPlayer).not.toHaveBeenCalled();
    expect(onSelectPlayer).not.toHaveBeenCalled();
  });
});

describe('CompetitionSettingsPanel fixture generation', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('saves the fixture mode selected through the controlled semantic select', async () => {
    authenticatedFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { rules: typeof automaticRules };
        return Promise.resolve(response({ success: true, data: { rules: body.rules } }));
      }
      return Promise.resolve(response(competitionSnapshot()));
    });

    function Harness() {
      const [mode, setMode] = useState<LeagueFixtureGenerationMode>('AUTOMATIC');
      return (
        <CompetitionSettingsPanel
          leagueId="league-1"
          currentUserId="user-1"
          fixtureGenerationMode={mode}
          onFixtureGenerationModeChange={setMode}
        />
      );
    }

    render(<Harness />);

    const fixtureSelect = await screen.findByRole('combobox', { name: 'Fixture generation' });
    fireEvent.change(fixtureSelect, { target: { value: 'MANUAL' } });
    expect(fixtureSelect).toHaveValue('MANUAL');

    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => {
      const saveCall = authenticatedFetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(saveCall).toBeDefined();
      const body = JSON.parse(String(saveCall?.[1]?.body)) as {
        rules: { fixtureGenerationMode: LeagueFixtureGenerationMode };
      };
      expect(body.rules.fixtureGenerationMode).toBe('MANUAL');
    });
  });
});
