import { render, screen, within } from '@testing-library/react';

import LivePickHeader from '../LivePickHeader';

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
  });
});
