import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InviteModal from './InviteModal';
import type { League } from '@/types/leagues';

const league = {
  id: 'league-1',
  name: 'Gippsland Fantasy',
  code: 'AB12CD34',
  type: 'private',
  ownerId: 'owner-1',
  maxTeams: 12,
  categories: ['goals'],
  tradeSettings: { tradeLimit: 5, tradeReview: 'admin' },
  waiverWire: { waiverOrder: [], waiverPeriodHours: 24, waiverResetPolicy: 'weekly' },
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'preseason',
} as League;

describe('InviteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: new URL('https://statly.test/leagues/league-1'),
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it('renders as an accessible dialog and closes on Escape', async () => {
    const onClose = vi.fn();

    render(<InviteModal league={league} isOpen={true} onClose={onClose} />);

    expect(
      screen.getByRole('dialog', { name: 'Invite managers to Gippsland Fantasy' })
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close invite managers dialog' })).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies the invite code and direct join link independently', async () => {
    render(<InviteModal league={league} isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite code AB12CD34' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('AB12CD34');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Invite code copied.');

    fireEvent.click(screen.getByRole('button', { name: 'Copy direct join link' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://statly.test/leagues/join?code=AB12CD34'
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('Direct join link copied.');
  });
});
