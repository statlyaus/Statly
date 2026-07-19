import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SocialComposer from './SocialComposer';

describe('SocialComposer', () => {
  it('sends trimmed chat text with Enter and keeps Shift+Enter as a newline', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SocialComposer
        label="League message"
        placeholder="Message"
        submitLabel="Send"
        maxLength={1000}
        submitOnEnter
        onSubmit={onSubmit}
      />
    );

    const input = screen.getByRole('textbox', { name: 'League message' });
    await user.type(input, 'First line{shift>}{enter}{/shift}Second line');
    expect(input).toHaveValue('First line\nSecond line');

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('First line\nSecond line');
    expect(input).toHaveValue('');
  });

  it('does not submit empty or whitespace-only content', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SocialComposer
        label="League message"
        placeholder="Message"
        submitLabel="Send"
        maxLength={1000}
        submitOnEnter
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByRole('textbox', { name: 'League message' }), '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
