import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import JoinLeaguePage, { normalizeInviteCode } from './page';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useAuth: vi.fn(),
  fetchApi: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
  useSearchParams: () => mocks.searchParams,
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

vi.mock('@/components/ui', () => ({
  LoadingSpinner: () => <span>Loading</span>,
}));

vi.mock('@/components/Button', () => ({
  default: ({
    href,
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: string;
    children: ReactNode;
  }) => (href ? <a href={href}>{children}</a> : <button {...props}>{children}</button>),
}));

describe('JoinLeaguePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.useAuth.mockReturnValue({ user: { uid: 'user-1' } });
    mocks.fetchApi.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          name: 'Gippsland Fantasy',
        },
      },
    });
  });

  it('normalizes invite codes to the canonical 8-character code', () => {
    expect(normalizeInviteCode(' ab12-cd34-extra ')).toBe('AB12CD34');
  });

  it('preserves invite code and team name through the login redirect', () => {
    mocks.useAuth.mockReturnValue({ user: null });
    mocks.searchParams = new URLSearchParams('code=ab12-cd34-extra&team=Gippsland Giants');

    render(<JoinLeaguePage />);

    const loginLink = screen.getByRole('link', { name: 'Log in to continue' });
    expect(loginLink).toHaveAttribute('href', expect.stringContaining('code%3DAB12CD34'));
    expect(loginLink).toHaveAttribute('href', expect.stringContaining('team%3DGippsland'));
  });

  it('blocks short invite codes before calling the join API', async () => {
    render(<JoinLeaguePage />);

    const codeInput = screen.getByLabelText(/League Code/);
    fireEvent.change(codeInput, { target: { value: 'AB12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join League' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invite code must be 8 characters');
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.fetchApi).not.toHaveBeenCalled();

    fireEvent.change(codeInput, { target: { value: 'AB12CD34' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(codeInput).not.toHaveAttribute('aria-invalid');
  });

  it('submits normalized league details and renders the success state', async () => {
    render(<JoinLeaguePage />);

    fireEvent.change(screen.getByLabelText(/League Code/), {
      target: { value: 'ab12-cd34' },
    });
    fireEvent.change(screen.getByLabelText(/Team Name/), {
      target: { value: 'Gippsland Giants' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join League' }));

    await waitFor(() => {
      expect(mocks.fetchApi).toHaveBeenCalledWith('leagues/join', {
        method: 'POST',
        body: JSON.stringify({
          code: 'AB12CD34',
          teamName: 'Gippsland Giants',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Successfully Joined Gippsland Fantasy!'
    );
  });
});
