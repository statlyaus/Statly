import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import LivePickHeader from '@/components/LivePickHeader';

const draftData = {
  id: 'draft-1',
  currentPick: 1,
  totalPicks: 12,
  round: 1,
  direction: 'FORWARD',
  status: 'LIVE',
  pickDeadlineAt: new Date(Date.now() + 120_000).toISOString(),
  participants: [
    {
      slot: 1,
      member: {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Alpha',
        email: 'alpha@example.com',
      },
    },
    {
      slot: 2,
      member: {
        id: 'member-2',
        userId: 'user-2',
        displayName: 'Beta',
        email: 'beta@example.com',
      },
    },
    {
      slot: 3,
      member: {
        id: 'member-3',
        userId: 'user-3',
        displayName: 'Gamma',
        email: 'gamma@example.com',
      },
    },
  ],
  picks: [
    {
      id: 'pick-1',
      overall: 1,
      round: 1,
      slot: 1,
      player: {
        id: 'player-1',
        name: 'Marcus Bontempelli',
        position: 'MID',
        club: 'Western Bulldogs',
      },
      member: {
        id: 'member-1',
        displayName: 'Alpha',
      },
      auto: false,
      madeAt: new Date().toISOString(),
    },
  ],
};

describe('LivePickHeader', () => {
  it('renders canonical live status with accessible timer and pick train', () => {
    render(<LivePickHeader draftData={draftData} isYourTurn={false} yourSlot={3} />);

    expect(screen.getByRole('banner', { name: 'Live draft status' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: /time remaining/i })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /pick timer/i })).toBeInTheDocument();
    const pickTrain = screen.getByRole('region', { name: 'Draft pick train' });

    expect(pickTrain).toBeInTheDocument();
    expect(screen.queryByLabelText('Latest draft activity')).not.toBeInTheDocument();
    expect(screen.getByText('On the clock')).toBeInTheDocument();
    expect(within(pickTrain).getByText('Alpha')).toBeInTheDocument();
    expect(screen.getAllByText('Marcus Bontempelli').length).toBeGreaterThan(0);
  });

  it('renders the authoritative deadline time on the first paint', () => {
    const html = renderToString(
      <LivePickHeader
        draftData={{
          ...draftData,
          pickDeadlineAt: new Date(Date.now() + 47_000).toISOString(),
        }}
        timePerPick={60}
        isYourTurn={false}
        yourSlot={3}
      />
    );

    expect(html).toContain('aria-label="Time remaining: 47s"');
    expect(html).toContain('aria-valuenow="47"');
    expect(html).toContain('aria-valuemax="60"');
    expect(html).not.toContain('aria-label="Time remaining: 1m 0s"');
    expect(html).not.toContain('aria-label="Time remaining: 2m 0s"');
  });
});
