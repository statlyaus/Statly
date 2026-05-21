import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardClient from './DashboardClient';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
  }),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/DashboardLoading', () => ({
  default: () => <div>Restoring dashboard session</div>,
}));

vi.mock('@/components/UserDashboard', () => ({
  default: ({ user }: { user: { email?: string | null } }) => <div>Dashboard for {user.email}</div>,
}));

describe('DashboardClient auth restore behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not client-redirect away while Firebase auth is absent after server access was allowed', () => {
    mocks.useAuth.mockReturnValue({ user: null, loading: false });

    render(<DashboardClient />);

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText('Restoring dashboard session')).toBeInTheDocument();
  });

  it('renders the dashboard once Firebase auth is available', () => {
    mocks.useAuth.mockReturnValue({
      user: { email: 'tester@statly.dev' },
      loading: false,
    });

    render(<DashboardClient />);

    expect(screen.getByText('Dashboard for tester@statly.dev')).toBeInTheDocument();
  });
});
