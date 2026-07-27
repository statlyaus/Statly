import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RoundMatchesPage from '@/app/(app)/matches/[round]/page';

const firebase = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({ get: firebase.get }),
    }),
  },
}));

vi.mock('@/lib/matchMapper', () => ({
  mapMatchEventToDTO: vi.fn(),
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/RoundMatches', () => ({
  RoundMatches: ({ round }: { round: number }) => <div>Round matches {round}</div>,
}));

describe('RoundMatchesPage navigation', () => {
  beforeEach(() => {
    firebase.get.mockResolvedValue({ docs: [] });
  });

  it('renders a non-interactive Previous control for round one', async () => {
    render(await RoundMatchesPage({ params: Promise.resolve({ round: '1' }) }));

    const previous = screen.getByRole('button', { name: '← Previous' });
    expect(previous).toBeDisabled();
    expect(previous).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute('href', '/matches/2');
    expect(screen.getByText('Round matches 1')).toBeVisible();
  });

  it('renders normal Previous and Next links after round one', async () => {
    render(await RoundMatchesPage({ params: Promise.resolve({ round: '2' }) }));

    expect(screen.getByRole('link', { name: '← Previous' })).toHaveAttribute('href', '/matches/1');
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute('href', '/matches/3');
    expect(screen.getByText('Round matches 2')).toBeVisible();
  });
});
