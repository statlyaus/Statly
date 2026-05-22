import type { ReactNode } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeaguesClient from './LeaguesClient';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchApi: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/lib/api', () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('LeaguesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({
      user: { uid: 'user-1' },
      loading: false,
    });
    mocks.fetchApi.mockResolvedValue({ data: { leagues: [] } });
  });

  it('renders guided empty state actions when the manager has no leagues', async () => {
    render(<LeaguesClient />);

    expect(await screen.findByRole('heading', { name: 'Start your league workspace' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Create league' }).at(-1)).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.getAllByRole('link', { name: 'Join league' }).at(-1)).toHaveAttribute(
      'href',
      '/leagues/join'
    );
  });

  it('renders a retryable error state without hiding create or join actions', async () => {
    const user = userEvent.setup();
    mocks.fetchApi.mockRejectedValueOnce(new Error('HTTP 500'));
    mocks.fetchApi.mockResolvedValueOnce({ data: { leagues: [] } });

    render(<LeaguesClient />);

    expect(await screen.findByRole('heading', { name: 'League list unavailable' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500');
    expect(screen.getAllByRole('link', { name: 'Create league' }).at(-1)).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.getAllByRole('link', { name: 'Join league' }).at(-1)).toHaveAttribute(
      'href',
      '/leagues/join'
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mocks.fetchApi).toHaveBeenCalledTimes(2);
    });
  });
});
