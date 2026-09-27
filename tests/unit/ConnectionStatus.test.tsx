import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectionStatus from '@/components/draft/ConnectionStatus';

describe('ConnectionStatus', () => {
  it('renders nothing while connected', () => {
    const { container } = render(<ConnectionStatus status="connected" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces reconnecting as a status on the broadcast palette', () => {
    render(<ConnectionStatus status="reconnecting" />);

    const status = screen.getByRole('status', { name: 'Live draft connection' });
    expect(status).toHaveTextContent('Reconnecting to the live draft');
    expect(status.className).toContain('--draft-broadcast-');
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
});
