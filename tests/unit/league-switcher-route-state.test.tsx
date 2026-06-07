import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueSwitcher from '@/components/navigation/LeagueSwitcher';
import { LAST_LEAGUE_ID_COOKIE } from '@/lib/uiPreferences';

const mocks = vi.hoisted(() => ({
  pathname: '/leagues/new',
  push: vi.fn(),
  replace: vi.fn(),
  user: null as { uid: string } | null,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('LeagueSwitcher route state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/leagues/new';
    mocks.user = null;
    document.cookie = `${LAST_LEAGUE_ID_COOKIE}=; Max-Age=0; path=/`;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('does not persist reserved league routes as the last selected league', async () => {
    document.cookie = `${LAST_LEAGUE_ID_COOKIE}=league-123; path=/`;

    render(<LeagueSwitcher />);

    await screen.findByText('Select a league');

    expect(document.cookie).toContain(`${LAST_LEAGUE_ID_COOKIE}=league-123`);
    expect(document.cookie).not.toContain(`${LAST_LEAGUE_ID_COOKIE}=new`);
  });

  it('continues to persist real league ids from league detail routes', async () => {
    mocks.pathname = '/leagues/league-456';

    render(<LeagueSwitcher />);

    await waitFor(() => {
      expect(document.cookie).toContain(`${LAST_LEAGUE_ID_COOKIE}=league-456`);
    });
  });

  it('does not auto-navigate away from the leagues index after leagues load', async () => {
    mocks.pathname = '/leagues';
    mocks.user = { uid: 'user-1' };
    document.cookie = `${LAST_LEAGUE_ID_COOKIE}=league-123; path=/`;
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        data: {
          leagues: [{ id: 'league-123', name: 'Test Lab Alpha' }],
        },
      }),
    } as Response);

    render(<LeagueSwitcher />);

    await screen.findByText('Test Lab Alpha');

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
