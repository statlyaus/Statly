import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Alert, { AlertContainer, useAlert } from '@/components/ui/Alert';

const RAW_PALETTE_CLASS =
  /\b(bg|text|border|ring)-(red|green|yellow|blue|amber|emerald|sky|gray|slate|white|black)(-\d{2,3})?\b/;

function classesIn(element: HTMLElement): string[] {
  return [element, ...Array.from(element.querySelectorAll('*'))].flatMap((node) =>
    (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  );
}

describe('Alert', () => {
  it.each(['success', 'error', 'warning', 'info'] as const)(
    'renders a %s alert with design-token colours only',
    (type) => {
      render(
        <Alert
          type={type}
          title={`${type} title`}
          dismissible
          actions={<button type="button">Retry</button>}
        >
          {type} message
        </Alert>
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'polite');
      expect(alert).toHaveTextContent(`${type} title`);
      expect(alert).toHaveTextContent(`${type} message`);
      expect(classesIn(alert).filter((name) => RAW_PALETTE_CLASS.test(name))).toEqual([]);
    }
  );

  it('dismisses through the labelled button and reports it', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Alert type="error" dismissible onDismiss={onDismiss}>
        Sign out failed
      </Alert>
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss alert' }));

    await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('shows queued alerts from useAlert in the container', () => {
    function Harness() {
      const { alerts, removeAlert, error } = useAlert();
      return (
        <>
          <button type="button" onClick={() => error('Sign out failed', 'Network down')}>
            Fail
          </button>
          <AlertContainer alerts={alerts} onRemove={removeAlert} />
        </>
      );
    }

    render(<Harness />);
    act(() => screen.getByRole('button', { name: 'Fail' }).click());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sign out failed');
    expect(alert).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: 'Dismiss alert' })).toBeInTheDocument();
  });
});
