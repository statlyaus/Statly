import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import TradeConfirmModal from './TradeConfirmModal';

describe('TradeConfirmModal accessibility', () => {
  const baseProps = {
    open: true,
    createSubmitting: false,
    createSummary: null,
    createNetImpact: { net: 0, label: 'Even trade' },
    hasVisibleKeys: false,
    outgoingPlayers: [],
    incomingPlayers: [],
    onCancel: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
  };

  it('keeps keyboard focus inside the confirmation dialog', () => {
    const onCancel = vi.fn();

    render(<TradeConfirmModal {...baseProps} onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog', { name: 'Confirm Trade' });
    expect(dialog).toHaveAccessibleDescription('Are you sure you want to complete this trade?');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Yes, Confirm Trade' });

    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
