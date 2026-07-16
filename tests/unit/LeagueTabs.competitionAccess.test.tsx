import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, LeagueMember } from '@/types/leagues';

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'league-settings' : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: mocks.authenticatedFetch,
}));

vi.mock('@/components/league/settings/CompetitionSettingsPanel', () => ({
  CompetitionSettingsPanel: () => (
    <section data-testid="competition-settings-panel">Competition panel only</section>
  ),
}));

const league: League = {
  id: 'league-1',
  name: 'Access League',
  code: 'ACCESS01',
  type: 'private',
  ownerId: 'owner-user',
  maxTeams: 10,
  categories: ['goals'],
  tradeSettings: { tradeLimit: 10, tradeReview: 'none' },
  waiverWire: { waiverOrder: [], waiverPeriodHours: 24, waiverResetPolicy: 'weekly' },
  createdAt: '2026-07-01T00:00:00.000Z',
  status: 'preseason',
};

const coCommissioner: LeagueMember = {
  id: 'member-1',
  leagueId: 'league-1',
  userId: 'co-user',
  role: 'member',
  isCoCommissioner: true,
  teamName: 'Co Team',
  joinedAt: '2026-07-01T00:00:00.000Z',
  isActive: true,
};

describe('LeagueTabs co-commissioner competition access', () => {
  beforeEach(() => {
    mocks.authenticatedFetch.mockReset();
    mocks.push.mockReset();
    mocks.authenticatedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ trades: [] }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ claims: [], playersIndex: {} }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows Competition Rules without loading or exposing unrelated admin settings', async () => {
    render(<LeagueTabs league={league} members={[coCommissioner]} currentUserId="co-user" />);

    expect(await screen.findByTestId('competition-settings-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Competition Rules' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.queryByText('Basic Information')).not.toBeInTheDocument();
    expect(screen.queryByText('Scoring Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Settings')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.authenticatedFetch).not.toHaveBeenCalledWith(
        '/api/leagues/league-1/settings',
        expect.anything(),
        expect.anything()
      );
    });
  });
});
