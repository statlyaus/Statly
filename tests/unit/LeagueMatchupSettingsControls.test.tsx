import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompetitionSettingsPanel } from '@/components/league/settings/CompetitionSettingsPanel';
import type { LeagueFixtureGenerationMode } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

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
