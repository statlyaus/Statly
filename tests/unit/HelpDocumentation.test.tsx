import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import HelpDocumentation from '@/components/help/HelpDocumentation';

describe('HelpDocumentation article feedback', () => {
  it('reports and exposes the selected article rating', async () => {
    const user = userEvent.setup();
    const onRateContent = vi.fn();
    render(<HelpDocumentation onRateContent={onRateContent} />);

    await user.click(screen.getByRole('heading', { name: 'Getting Started with AFL Fantasy' }));

    const helpful = screen.getByRole('button', { name: '👍 Yes' });
    const notHelpful = screen.getByRole('button', { name: '👎 No' });

    await user.click(helpful);
    expect(onRateContent).toHaveBeenLastCalledWith('1', 1);
    expect(helpful).toHaveAttribute('aria-pressed', 'true');

    await user.click(notHelpful);
    expect(onRateContent).toHaveBeenLastCalledWith('1', -1);
    expect(notHelpful).toHaveAttribute('aria-pressed', 'true');
    expect(helpful).toHaveAttribute('aria-pressed', 'false');
  });
});
