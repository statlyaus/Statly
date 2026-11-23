import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';

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
        draftData={{ ...draftData, pickDeadlineAt: new Date(Date.now() - 1_000).toISOString() }}
        isYourTurn={false}
        yourSlot={3}
      />
    );

    expect(screen.getAllByText('Finalising pick')).toHaveLength(2);
    expect(screen.getByRole('timer')).toHaveAccessibleName('Draft pick is being finalised');
  });

  describe('when no expiry job makes the pick', () => {
    const overdueDraft = {
      ...draftData,
      pickDeadlineAt: new Date(Date.now() - 60_000).toISOString(),
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('moves from finalizing to overdue once the grace has passed', () => {
      vi.useFakeTimers();
      render(
        <LivePickHeader
          draftData={{ ...draftData, pickDeadlineAt: new Date(Date.now() - 5_000).toISOString() }}
          isYourTurn={false}
          yourSlot={3}
        />
      );
      expect(screen.getAllByText('Finalising pick')).toHaveLength(2);

      act(() => {
        vi.advanceTimersByTime(11_000);
      });

      expect(screen.getByText('This pick is overdue. The commissioner can make it.')).toBeVisible();
      expect(screen.getByRole('timer')).toHaveAccessibleName('Draft pick is overdue');
    });

    it('tells the manager on the clock their pick is still open', () => {
      render(
        <LivePickHeader
          draftData={overdueDraft}
          isYourTurn={true}
          canMakePick={true}
          yourSlot={1}
        />
      );

      expect(screen.getByText('Your pick is still open. Choose a player now.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Make the pick now' })).not.toBeInTheDocument();
    });

    it('does not promise an open pick the room cannot take', () => {
      render(
        <LivePickHeader
          draftData={overdueDraft}
          isYourTurn={true}
          canMakePick={false}
          yourSlot={1}
        />
      );

      expect(screen.queryByText(/Your pick is still open/)).not.toBeInTheDocument();
    });

    it('lets the commissioner make the pick and shows why it failed', async () => {
      const user = userEvent.setup();
      const onMakeOverduePick = vi
        .fn()
        .mockRejectedValueOnce(new Error('Pick clock has not expired'))
        .mockResolvedValueOnce(undefined);
      render(
        <LivePickHeader
          draftData={overdueDraft}
          isYourTurn={false}
          yourSlot={3}
          onMakeOverduePick={onMakeOverduePick}
        />
      );

      expect(screen.getByText('This pick is overdue.')).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Make the pick now' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pick clock has not expired');

      await user.click(screen.getByRole('button', { name: 'Make the pick now' }));
      expect(onMakeOverduePick).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says who can make the pick when auto-pick is off', () => {
      render(
        <LivePickHeader
          draftData={overdueDraft}
          isYourTurn={false}
          yourSlot={3}
          autoPickAllowed={false}
        />
      );

      expect(
        screen.getByText('This pick is overdue. Waiting for the manager on the clock to pick.')
      ).toBeVisible();
    });

    it('never shows a paused draft as overdue', () => {
      render(
        <LivePickHeader
          draftData={{ ...overdueDraft, status: 'PAUSED' }}
          isYourTurn={false}
          yourSlot={3}
          onMakeOverduePick={vi.fn()}
        />
      );

      expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Make the pick now' })).not.toBeInTheDocument();
    });
  });
});
