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

    const draftOrder = screen.getByRole('list', { name: 'Draft order' });
    const items = within(draftOrder).getAllByRole('listitem');

    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Team 1: Alpha (currently picking)')).toBeInTheDocument();
    expect(within(items[1]).getByText('Team 2: Beta (next to pick)')).toBeInTheDocument();
    expect(within(items[2]).getByText('Team 3: Gamma (your team)')).toBeInTheDocument();
    expect(within(draftOrder).queryAllByRole('button')).toHaveLength(0);
  });
});
