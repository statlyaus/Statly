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
    format: {
      leagueFormat: 'STANDARD',
      bloodsuckerMemberId: null,
      candidates: [{ memberId: 'member-2', teamName: 'Blues' }],
    },
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
      timeZone: 'Australia/Melbourne',
      autoPickRules: { enabled: true, strategy: 'queue-first' },
    },
    waiver: { waiverRule: 'weekly', faabBudget: 100 },
  },
};

describe('choosing Bloodsucker in league settings (BR-03)', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
    authenticatedFetchMock.mockResolvedValue({ ok: true, json: async () => settingsPayload });
  });

  it('saves rolling waivers with no FAAB and locks the weekly and FAAB inputs', async () => {
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

    const formatSelect = (await screen.findByLabelText('League format')) as HTMLSelectElement;
    await waitFor(() => expect(formatSelect.disabled).toBe(false));
    fireEvent.change(formatSelect, { target: { value: 'BLOODSUCKER' } });
    fireEvent.change(screen.getByLabelText(/^Bloodsucker/), { target: { value: 'member-2' } });

    expect((screen.getByRole('option', { name: /weekly/i }) as HTMLOptionElement).disabled).toBe(
      true
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save league settings' }));

    await waitFor(() =>
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/settings',
        expect.objectContaining({ method: 'PUT' }),
        'owner'
      )
    );
    const putCall = authenticatedFetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const body = JSON.parse(putCall?.[1].body as string);
    expect(body.format).toMatchObject({
      leagueFormat: 'BLOODSUCKER',
      bloodsuckerMemberId: 'member-2',
    });
    expect(body.waiver).toMatchObject({ waiverRule: 'rolling', faabBudget: null });
  });
});

describe('choosing No Losers in league settings (No Losers BR-01, BR-03, BR-04)', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
    authenticatedFetchMock.mockResolvedValue({ ok: true, json: async () => settingsPayload });
  });

  it('explains the result rule and saves the format with the weekly waivers and FAAB kept', async () => {
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

    const formatSelect = (await screen.findByLabelText('League format')) as HTMLSelectElement;
    await waitFor(() => expect(formatSelect.disabled).toBe(false));
    fireEvent.change(formatSelect, { target: { value: 'NO_LOSERS' } });

    expect(screen.getByText(/a loss by 6 or more counts nothing/)).toBeInTheDocument();
    expect(
      screen.getByText(/clangers, frees against and turnovers are zeroed too/)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Bloodsucker/)).not.toBeInTheDocument();
    expect((screen.getByRole('option', { name: /weekly/i }) as HTMLOptionElement).disabled).toBe(
      false
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save league settings' }));

    await waitFor(() =>
      expect(authenticatedFetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(
        true
      )
    );
    const putCall = authenticatedFetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const body = JSON.parse(putCall?.[1].body as string);
    expect(body.format).toMatchObject({ leagueFormat: 'NO_LOSERS' });
    expect(body.waiver).toMatchObject({ waiverRule: 'weekly', faabBudget: 100 });
  });
});
