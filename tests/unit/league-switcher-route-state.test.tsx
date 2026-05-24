import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueSwitcher from '@/components/navigation/LeagueSwitcher';
import { LAST_LEAGUE_ID_COOKIE } from '@/lib/uiPreferences';

const mocks = vi.hoisted(() => ({
  pathname: '/leagues/new',
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: null }),
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
    document.cookie = `${LAST_LEAGUE_ID_COOKIE}=; Max-Age=0; path=/`;
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
});
