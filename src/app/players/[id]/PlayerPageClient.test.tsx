import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PlayerPageClient from './PlayerPageClient';

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  replace: vi.fn(),
  notFound: vi.fn(),
  useAuth: vi.fn(),
  useUserLeagues: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  useParams: () => ({ id: 'player-1' }),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/hooks/useUserLeagues', () => ({
  useUserLeagues: mocks.useUserLeagues,
}));

vi.mock('@/lib/api', () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock('@/components/PlayerDetail', () => ({
  PlayerDetail: ({ player }: { player: { name: string } }) => <div>{player.name} details</div>,
}));

describe('PlayerPageClient degraded states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({ user: { uid: 'user-1' } });
    mocks.useUserLeagues.mockReturnValue({ leagues: [] });
  });

  it('surfaces player API failures with retry and keeps the page non-fatal', async () => {
    mocks.fetchApi
      .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
      .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
      .mockResolvedValue({ data: { id: 'player-1', name: 'Player One' } });

    render(<PlayerPageClient />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Player unavailable');
    expect(screen.getByText(/HTTP 503 Service Unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to players/i })).toHaveAttribute(
      'href',
      '/players'
    );

    await userEvent.click(screen.getByRole('button', { name: /retry player load/i }));

    await waitFor(() => {
      expect(screen.getByText('Player One details')).toBeInTheDocument();
    });
    expect(mocks.fetchApi).toHaveBeenCalledWith('players/player-1', expect.any(Object));
  });
});
