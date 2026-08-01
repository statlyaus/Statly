import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import DraftQueue from '@/components/draft/DraftQueue';
import type { DraftPlayer } from '@/types/draft';

const knownPlayer: DraftPlayer = {
  id: 'player-known',
  name: 'Known Player',
  position: 'MID',
  club: 'Carlton',
  isAvailable: true,
};

const availablePlayer: DraftPlayer = {
  id: 'player-available',
  name: 'Available Player',
  position: 'FWD',
  club: 'Sydney',
  isAvailable: true,
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('DraftQueue component', () => {
  it('preserves canonical queue ids, counts, and indices while player details hydrate', () => {
    render(
      <DraftQueue
        queue={['player-ghost', knownPlayer.id]}
        availablePlayers={[knownPlayer, availablePlayer]}
        onQueueUpdate={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByText('2 queued')).toBeInTheDocument();

    const queuedPlayers = screen.getByRole('list', { name: 'Queued players' });
    const queueItems = within(queuedPlayers).getAllByRole('listitem');

    expect(queueItems).toHaveLength(2);
    expect(queueItems[0]).toHaveTextContent('1');
    expect(queueItems[0]).toHaveTextContent('Queued player');
    expect(queueItems[0]).toHaveTextContent('Player details loading');
    expect(queueItems[1]).toHaveTextContent('2');
    expect(queueItems[1]).toHaveTextContent('Known Player');

    const availableSection = screen.getByRole('region', { name: 'Available players for queue' });
    expect(within(availableSection).queryByText('Known Player')).not.toBeInTheDocument();
    expect(within(availableSection).getByText('Available Player')).toBeInTheDocument();
  });

  it('marks queue surfaces busy and disables mutation controls until an add is persisted', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    const onQueueUpdate = vi.fn(() => deferred.promise);

    render(
      <DraftQueue
        queue={[knownPlayer.id]}
        availablePlayers={[knownPlayer, availablePlayer]}
        onQueueUpdate={onQueueUpdate}
        isLoading={false}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onQueueUpdate).toHaveBeenCalledWith([knownPlayer.id, availablePlayer.id]);
    expect(screen.getByRole('region', { name: 'Draft queue' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByRole('region', { name: 'Available players for queue' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByText('Saving queue…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit draft queue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear draft queue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    deferred.resolve();

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Draft queue' })).toHaveAttribute(
        'aria-busy',
        'false'
      )
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('recovers its controls when the room-level queue callback rejects', async () => {
    const user = userEvent.setup();
    const onQueueUpdate = vi.fn().mockRejectedValue(new Error('Queue request failed'));

    render(
      <DraftQueue
        queue={[knownPlayer.id]}
        availablePlayers={[knownPlayer, availablePlayer]}
        onQueueUpdate={onQueueUpdate}
        isLoading={false}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onQueueUpdate).toHaveBeenCalledWith([knownPlayer.id, availablePlayer.id]);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Draft queue' })).toHaveAttribute(
        'aria-busy',
        'false'
      )
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(screen.getByText('1 queued')).toBeInTheDocument();
  });

  it('keeps clear pending until the confirmed queue mutation settles', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    const onQueueUpdate = vi.fn(() => deferred.promise);
    let confirmOptions:
      | {
          onConfirm: () => void | Promise<void>;
        }
      | undefined;
    const confirm = vi.fn((options: { onConfirm: () => void | Promise<void> }) => {
      confirmOptions = options;
    });

    render(
      <DraftQueue
        queue={[knownPlayer.id]}
        availablePlayers={[knownPlayer]}
        onQueueUpdate={onQueueUpdate}
        isLoading={false}
        confirm={confirm}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clear draft queue' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirmOptions).toBeDefined();

    let clearPromise: Promise<void> | undefined;
    act(() => {
      clearPromise = Promise.resolve(confirmOptions?.onConfirm());
    });

    expect(onQueueUpdate).toHaveBeenCalledWith([]);
    expect(screen.getByRole('region', { name: 'Draft queue' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Clear draft queue' })).toBeDisabled();

    await act(async () => {
      deferred.resolve();
      await clearPromise;
    });

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Draft queue' })).toHaveAttribute(
        'aria-busy',
        'false'
      )
    );
  });
});
