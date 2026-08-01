import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Tooltip from '@/components/ui/Tooltip';

describe('Tooltip accessibility', () => {
  it('connects a focused default trigger to its portalled tooltip and removes the reference when hidden', async () => {
    render(
      <Tooltip content="Player availability">
        <button type="button">Availability</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: 'Availability' });
    const triggerWrapper = trigger.parentElement as HTMLElement;

    expect(trigger).not.toHaveAttribute('aria-describedby');
    expect(triggerWrapper).not.toHaveAttribute('aria-describedby');

    fireEvent.focus(trigger);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    expect(triggerWrapper).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById(tooltip.id)).toBe(tooltip);

    fireEvent.blur(trigger);

    expect(trigger).not.toHaveAttribute('aria-describedby');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('preserves pointer disclosure for the default trigger', async () => {
    render(
      <Tooltip content="Pointer details" portal={false}>
        <button type="button">Pointer trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: 'Pointer trigger' });
    const triggerWrapper = trigger.parentElement as HTMLElement;

    fireEvent.mouseEnter(triggerWrapper);

    const tooltip = screen.getByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    expect(triggerWrapper).not.toHaveAttribute('aria-describedby');

    fireEvent.mouseLeave(triggerWrapper);

    expect(trigger).not.toHaveAttribute('aria-describedby');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('uses unique associations for simultaneous tooltip instances', () => {
    render(
      <>
        <Tooltip content="First description" trigger="click" portal={false}>
          <button type="button">First trigger</button>
        </Tooltip>
        <Tooltip content="Second description" trigger="click" portal={false}>
          <button type="button">Second trigger</button>
        </Tooltip>
      </>
    );

    const firstTrigger = screen.getByRole('button', { name: 'First trigger' });
    const secondTrigger = screen.getByRole('button', { name: 'Second trigger' });

    fireEvent.click(firstTrigger);
    fireEvent.click(secondTrigger);

    const firstTooltip = screen.getByText('First description').closest('[role="tooltip"]');
    const secondTooltip = screen.getByText('Second description').closest('[role="tooltip"]');

    expect(firstTooltip).not.toBeNull();
    expect(secondTooltip).not.toBeNull();
    expect(firstTooltip?.id).not.toBe(secondTooltip?.id);
    expect(firstTrigger).toHaveAttribute('aria-describedby', firstTooltip?.id);
    expect(secondTrigger).toHaveAttribute('aria-describedby', secondTooltip?.id);
  });

  it('preserves an existing description and dismisses the tooltip immediately with Escape', () => {
    render(
      <>
        <span id="existing-help">Existing help</span>
        <Tooltip content="Additional help" portal={false}>
          <button type="button" aria-describedby="existing-help">
            Help
          </button>
        </Tooltip>
      </>
    );

    const trigger = screen.getByRole('button', { name: 'Help' });
    act(() => trigger.focus());

    const tooltip = screen.getByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', `existing-help ${tooltip.id}`);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-describedby', 'existing-help');
    expect(trigger).toHaveFocus();
  });

  it('cancels delayed disclosure when Escape is pressed before the tooltip opens', () => {
    vi.useFakeTimers();

    try {
      render(
        <Tooltip content="Delayed help" delay={200} portal={false}>
          <button type="button">Delayed trigger</button>
        </Tooltip>
      );

      const trigger = screen.getByRole('button', { name: 'Delayed trigger' });
      act(() => trigger.focus());
      fireEvent.keyDown(document, { key: 'Escape' });

      act(() => vi.advanceTimersByTime(200));

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(trigger).not.toHaveAttribute('aria-describedby');
      expect(trigger).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});
