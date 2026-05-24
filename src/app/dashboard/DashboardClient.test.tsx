import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardClient from './DashboardClient';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

  it('keeps the dashboard shell in a restoring state while Firebase auth is absent', () => {
    mocks.useAuth.mockReturnValue({ user: null, loading: false });

    render(<DashboardClient />);

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
