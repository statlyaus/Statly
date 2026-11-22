import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectionStatus from '@/components/draft/ConnectionStatus';

describe('ConnectionStatus', () => {
  it('renders nothing while connected', () => {
    const { container } = render(<ConnectionStatus status="connected" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces reconnecting as a status on the core roles', () => {
    render(<ConnectionStatus status="reconnecting" />);

    const status = screen.getByRole('status', { name: 'Live draft connection' });
    expect(status).toHaveTextContent('Reconnecting to the live draft');
    expect(status.className).toContain('text-warning-text');
    expect(status.className).not.toMatch(/bg-(blue|yellow|red|gray)-\d/);
  });

  it('offers a real Refresh button when the connection is lost', () => {
    const onRefresh = vi.fn();
    render(<ConnectionStatus status="disconnected" onRefresh={onRefresh} />);

    expect(screen.getByRole('status', { name: 'Live draft connection' })).toHaveTextContent(
      'Connection lost. The board may be out of date.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh draft room' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('tells the manager picks still work once live updates stop retrying on a fresh board', () => {
    const onReload = vi.fn();
    render(
      <ConnectionStatus status="reconnecting" liveUpdatesDown picksStillWork onReload={onReload} />
    );

    expect(screen.getByRole('status', { name: 'Live draft connection' })).toHaveTextContent(
      'Live updates are down. Picks still work and the board refreshes every few seconds.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload to reconnect' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('does not claim picks work when live updates are down and the board is out of date', () => {
    render(<ConnectionStatus status="disconnected" liveUpdatesDown onReload={vi.fn()} />);

    const status = screen.getByRole('status', { name: 'Live draft connection' });
    expect(status).toHaveTextContent('Live updates are down. The board may be out of date.');
    expect(status).not.toHaveTextContent('Picks still work');
    expect(screen.getByRole('button', { name: 'Reload to reconnect' })).toBeInTheDocument();
  });
});
