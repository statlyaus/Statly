import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeagueSettingsPanel } from '@/components/league/LeagueSettingsPanels';
import type { League } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));
vi.mock('@/components/league/settings/CompetitionSettingsPanel', () => ({
  CompetitionSettingsPanel: () => null,
}));

const settingsPayload = {
  success: true,
  data: {
    league: { id: 'league-1', name: 'Premier', code: 'CODE', maxTeams: 8, locked: false },
    scoring: {
      scoringFormat: 'nine-category',
      categories: ['goals', 'tackles', 'intercepts'],
      scoringMode: 'H2H_EACH_CATEGORY',
      fixtureGenerationMode: 'AUTOMATIC',
      lineupSlots: { FWD: 5, DEF: 5, MID: 5, RUC: 1, UTIL: 3 },
      categoryDirections: {},
      scoringSettingsLockedAt: null,
    },
    locks: { scoring: null, draftStructure: null },
    roster: {
      rosterSize: 18,
      benchSize: 4,
      positionLimits: { DEF: 5, MID: 5, RUC: 1, FWD: 5, BENCH: 4 },
    },
    draft: {
      draftDate: '2026-03-01T00:00:00.000Z',
      draftType: 'snake',
      timePerPick: 120,
      pickOrder: 'random',
      timeZone: 'Australia/Perth',
      autoPickRules: { enabled: true, strategy: 'queue-first' },
    },
    waiver: { waiverRule: 'weekly', faabBudget: null },
  },
};

function renderPanel() {
  render(
    <LeagueSettingsPanel
      league={{ id: 'league-1', name: 'Premier', code: 'CODE', maxTeams: 8 } as League}
      memberCount={8}
      isAdmin
      canAccessCompetitionRules
      isActive
      currentUserId="owner"
    />
  );
}

function settingsGets() {
  return authenticatedFetchMock.mock.calls.filter(
    ([url, init]) => url === '/api/leagues/league-1/settings' && !init?.method
  );
}

function putCalls() {
  return authenticatedFetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
}

describe('league settings save waits for a successful load', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('keeps Save and the form disabled while the settings are still loading', async () => {
    authenticatedFetchMock.mockReturnValue(new Promise(() => {}));

    renderPanel();

    const save = screen.getByRole('button', { name: 'Save league settings' });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Draft Type')).toBeDisabled();

    fireEvent.click(save);
    await waitFor(() => expect(settingsGets()).toHaveLength(1));
    expect(putCalls()).toHaveLength(0);
  });

  it('replaces the form after a failed load and lets the commissioner try again', async () => {
    let settingsLoadFails = true;
    authenticatedFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/leagues/league-1/settings' && !init?.method && settingsLoadFails) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'Database unavailable' }),
        };
      }
      return { ok: true, json: async () => settingsPayload };
    });

    renderPanel();

    expect(await screen.findByText('Settings could not load.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save league settings' })).toBeNull();
    expect(screen.queryByLabelText('Draft Type')).toBeNull();

    settingsLoadFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    const save = await screen.findByRole('button', { name: 'Save league settings' });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByText('Settings could not load.')).toBeNull();
    expect(settingsGets()).toHaveLength(2);

    fireEvent.click(save);
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const body = JSON.parse(putCalls()[0][1].body as string);
    expect(body.draft.timeZone).toBe('Australia/Perth');
  });
});
