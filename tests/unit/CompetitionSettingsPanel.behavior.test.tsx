import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompetitionSettingsPanel } from '@/components/league/settings/CompetitionSettingsPanel';
import type { LeagueFixtureGenerationMode } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

function competitionRules(fixtureGenerationMode: LeagueFixtureGenerationMode) {
  return {
    seasonStartAflRound: 1,
    regularSeasonRounds: 18,
    finalsTeams: 4 as const,
    fixtureGenerationMode,
    lockPolicy: 'INDIVIDUAL_GAME_START' as const,
    leagueTimeZone: 'Australia/Melbourne',
    interchangeSlots: 4,
    standingsTieBreakCategory: 'goals' as const,
    excludedAflRounds: [],
  };
}

function competitionPayload(fixtureGenerationMode: LeagueFixtureGenerationMode) {
  return {
    success: true,
    data: {
      canManage: true,
      teamCount: 8,
      rosterSize: 22,
      categories: ['goals'],
      status: 'SETUP',
      fixtureVersion: 0,
      publishedAt: null,
      rules: competitionRules(fixtureGenerationMode),
      rounds: [],
      audit: [],
    },
  };
}

function response(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}

function Harness({ leagueId }: { leagueId: string }) {
  const [fixtureGenerationMode, setFixtureGenerationMode] =
    useState<LeagueFixtureGenerationMode>('AUTOMATIC');

  return (
    <CompetitionSettingsPanel
      leagueId={leagueId}
      currentUserId="user-1"
      fixtureGenerationMode={fixtureGenerationMode}
      onFixtureGenerationModeChange={setFixtureGenerationMode}
    />
  );
}

describe('CompetitionSettingsPanel fixture generation', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('saves the fixture mode selected through the shared competition rules state', async () => {
    authenticatedFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          rules: ReturnType<typeof competitionRules>;
        };
        return Promise.resolve(response({ success: true, data: { rules: body.rules } }));
      }
      return Promise.resolve(response(competitionPayload('AUTOMATIC')));
    });

    render(<Harness leagueId="league-1" />);

    const fixtureSelect = await screen.findByLabelText('Fixture generation');
    fireEvent.change(fixtureSelect, { target: { value: 'MANUAL' } });
    expect(fixtureSelect).toHaveValue('MANUAL');
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => {
      const putCall = authenticatedFetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT'
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(String((putCall?.[1] as RequestInit).body)) as {
        rules: { fixtureGenerationMode: string };
      };
      expect(body.rules.fixtureGenerationMode).toBe('MANUAL');
    });
    expect(await screen.findByText(/Competition rules saved/)).toBeInTheDocument();
  });

  it('ignores a stale competition response after the league changes', async () => {
    let resolveFirst: ((value: ReturnType<typeof response>) => void) | undefined;
    const firstResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveFirst = resolve;
    });

    authenticatedFetchMock.mockImplementation((url: string) => {
      if (url.includes('/league-1/')) return firstResponse;
      return Promise.resolve(response(competitionPayload('MANUAL')));
    });

    const { rerender } = render(<Harness leagueId="league-1" />);
    rerender(<Harness leagueId="league-2" />);

    expect(await screen.findByLabelText('Fixture generation')).toHaveValue('MANUAL');
    resolveFirst?.(response(competitionPayload('AUTOMATIC')));
    await firstResponse;

    expect(screen.getByLabelText('Fixture generation')).toHaveValue('MANUAL');
  });

  it('preserves publication feedback while refreshing the published snapshot', async () => {
    let published = false;
    authenticatedFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        published = true;
        return Promise.resolve(response({ success: true, data: { fixtureVersion: 1 } }));
      }

      const payload = competitionPayload('AUTOMATIC');
      if (published) {
        payload.data.status = 'PUBLISHED';
        payload.data.fixtureVersion = 1;
      }
      return Promise.resolve(response(payload));
    });

    render(<Harness leagueId="league-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Publish competition' }));

    expect(
      await screen.findByText('Competition published as fixture version 1.')
    ).toBeInTheDocument();
    expect(await screen.findByText(/Fixture version 1 was published/)).toBeInTheDocument();
  });
});
