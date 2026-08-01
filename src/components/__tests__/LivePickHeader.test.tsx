import { render, screen, within } from '@testing-library/react';

import LivePickHeader from '../LivePickHeader';

const draftData = {
  id: 'draft-1',
  currentPick: 1,
  totalPicks: 12,
  round: 1,
  direction: 'FORWARD',
  draftType: 'SNAKE' as const,
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
  picks: [],
};

describe('LivePickHeader', () => {
  it('renders draft-order indicators as static list items instead of buttons', () => {
    render(<LivePickHeader draftData={draftData} isYourTurn={false} yourSlot={3} />);

    const draftOrder = screen.getByRole('list', { name: 'Draft picks' });
    const items = within(draftOrder).getAllByRole('listitem');

    expect(items).toHaveLength(5);
    expect(within(items[0]).getByText('Alpha')).toBeInTheDocument();
    expect(within(items[0]).getByText('On the clock')).toBeInTheDocument();
    expect(within(items[1]).getByText('Beta')).toBeInTheDocument();
    expect(within(items[2]).getByText('Gamma')).toBeInTheDocument();
    expect(within(items[2]).getByText('Your next pick')).toBeInTheDocument();
    expect(within(draftOrder).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Your next pick: Pick 3')).toBeInTheDocument();
  });

  it('uses linear order for the compact next-pick notice and pick train', () => {
    render(
      <LivePickHeader
        draftData={{
          ...draftData,
          currentPick: 4,
          round: 2,
          direction: 'FORWARD',
          draftType: 'LINEAR',
        }}
        isYourTurn={false}
        yourSlot={3}
      />
    );

    const draftOrder = screen.getByRole('list', { name: 'Draft picks' });
    const items = within(draftOrder).getAllByRole('listitem');

    expect(screen.getByText('Your next pick: Pick 6')).toBeInTheDocument();
    expect(within(items[0]).getByText('Gamma')).toBeInTheDocument();
    expect(within(items[2]).getByText('Beta')).toBeInTheDocument();
    expect(within(items[3]).getByText('Gamma')).toBeInTheDocument();
    expect(within(items[3]).getByText('Your next pick')).toBeInTheDocument();
  });

  it('shows a syncing state instead of inventing a two-minute clock', () => {
    render(
      <LivePickHeader
        draftData={{ ...draftData, pickDeadlineAt: null }}
        isYourTurn={false}
        yourSlot={3}
      />
    );

    expect(screen.getAllByText('Syncing clock')).toHaveLength(2);
    expect(screen.getByRole('timer')).toHaveAccessibleName('Draft clock is syncing');
    expect(screen.getByRole('timer')).toHaveTextContent('—');
  });

  it('shows finalizing after the deadline without invoking a client expiry command', () => {
    render(
      <LivePickHeader
        draftData={{ ...draftData, pickDeadlineAt: '2026-01-01T00:00:00.000Z' }}
        isYourTurn={false}
        yourSlot={3}
      />
    );

    expect(screen.getAllByText('Finalizing pick')).toHaveLength(2);
    expect(screen.getByRole('timer')).toHaveAccessibleName('Draft pick is being finalized');
  });
});
