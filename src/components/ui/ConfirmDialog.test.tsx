import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useConfirmDialog } from './ConfirmDialog';

function Harness(): React.JSX.Element {
  const { confirm, requestText, dialog } = useConfirmDialog();
  const [result, setResult] = useState('none');
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm({
            title: 'Drop Isaac Quaynor?',
            description: 'They go on waivers.',
            confirmLabel: 'Drop player',
            tone: 'danger',
          }).then((ok) => setResult(String(ok)))
        }
      >
        Drop
      </button>
      <button
        type="button"
        onClick={() =>
          void requestText({
            title: 'Reject this trade?',
            confirmLabel: 'Reject trade',
            inputLabel: 'Reason',
            required: true,
          }).then((value) => setResult(String(value)))
        }
      >
        Reject
      </button>
      <output>{result}</output>
      {dialog}
    </>
  );
}

describe('useConfirmDialog', () => {
  it('shows an in-page dialog and resolves true on confirm', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Drop' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Drop Isaac Quaynor?' });
    expect(dialog).toHaveAccessibleDescription('They go on waivers.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Drop player' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('true'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false on Cancel and on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Drop' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('false'));

    await user.click(screen.getByRole('button', { name: 'Drop' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('false');
  });

  it('requires text before resolving a text request', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Reject trade' }));
    expect(screen.getByText('Add a reason.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), '  Lopsided  ');
    await user.click(screen.getByRole('button', { name: 'Reject trade' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lopsided'));
  });
});
