import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ConnectionStatus from './ConnectionStatus';

describe('ConnectionStatus', () => {
  it('announces reconnecting draft state without rendering manual refresh', () => {
    render(<ConnectionStatus status="reconnecting" onRefresh={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to live draft...');
    expect(screen.queryByRole('button', { name: /refresh draft state/i })).not.toBeInTheDocument();
  });

  it('announces disconnected draft state and exposes manual refresh', async () => {
    const onRefresh = vi.fn();

    render(<ConnectionStatus status="disconnected" onRefresh={onRefresh} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost - Draft may not be in sync');

    await userEvent.click(screen.getByRole('button', { name: /refresh draft state/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
