import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DraftManager from '@/components/league/DraftManager';
import type { League, LeagueMember } from '@/types/leagues';

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
}));

vi.mock('@/lib/api', () => ({
  fetchApi: apiMocks.fetchApi,
}));

const league: League = {
  id: 'league-1',
  name: 'Friendly Draft League',
  code: 'DRAFT123',
  type: 'private',
  ownerId: 'owner-user',
  maxTeams: 12,
  categories: ['goals', 'tackles', 'inside50s'],
  tradeSettings: {
    tradeLimit: 10,
    tradeReview: 'none',
  },
  waiverWire: {
    waiverOrder: [],
    waiverPeriodHours: 24,
    waiverResetPolicy: 'weekly',
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'preseason',
};

function buildMembers(): LeagueMember[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `member-${index + 1}`,
    leagueId: league.id,
    userId: index === 0 ? league.ownerId : `user-${index + 1}`,
    role: index === 0 ? 'owner' : 'member',
    teamName: index === 0 ? 'Owner Team' : `Team ${index + 1}`,
    joinedAt: `2026-06-0${index + 1}T00:00:00.000Z`,
    isActive: true,
  }));
}

describe('DraftManager calendar UX', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T09:45:00+10:00'));
    apiMocks.fetchApi.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses separate date and time controls with friendly quick start actions', async () => {
    const { container } = render(
      <DraftManager league={league} members={buildMembers()} currentUserId={league.ownerId} />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMocks.fetchApi).toHaveBeenCalledWith('leagues/league-1/draft');

    expect(screen.getByText('Prepare the league draft room')).toBeInTheDocument();
    expect(screen.getByText('Draft setup preview')).toBeInTheDocument();
    expect(screen.getByText('18 roster spots per team, 4 bench')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare draft settings' }));

    expect(screen.getByText('Format and Clock')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft date')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start in 10 minutes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start tonight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start tomorrow' })).toBeInTheDocument();
    expect(screen.getByText(/Draft starts/i)).toBeInTheDocument();
    expect(container.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();
  });
});
