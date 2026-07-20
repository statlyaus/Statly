import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialComposerDraftScope } from './socialComposerDraft';
import SocialComposer from './SocialComposer';

const leagueScope: SocialComposerDraftScope = {
  userId: 'user-1',
  leagueId: 'league-1',
  leagueSeasonId: 'season-1',
  surface: { type: 'league-chat' },
};

function setFinePointer(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(pointer: fine)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof SocialComposer>> = {}
): ReturnType<typeof render> {
  return render(
    <SocialComposer
      label="League message"
      placeholder="Message"
      submitLabel="Send message"
      maxLength={1000}
      submitOnEnter
      compact
      onSubmit={vi.fn()}
      {...overrides}
    />
  );
}

describe('SocialComposer', () => {
  beforeEach(() => {
    localStorage.clear();
    setFinePointer(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
  });

  it('sends trimmed text with a stable attempt key and keeps Shift+Enter as a newline', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderComposer({ onSubmit });

    const input = screen.getByRole('textbox', { name: 'League message' });
    await user.type(input, 'First line{shift>}{enter}{/shift}Second line');
    expect(input).toHaveValue('First line\nSecond line');

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith(
      'First line\nSecond line',
      expect.stringMatching(/^chat:/)
    );
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('does not submit empty, touch-return, or active IME composition events', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const rendered = renderComposer({ onSubmit });
    const input = screen.getByRole('textbox', { name: 'League message' });

    await user.type(input, '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'IME message');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();

    rendered.unmount();
    setFinePointer(false);
    renderComposer({ onSubmit });
    const touchInput = screen.getByRole('textbox', { name: 'League message' });
    await user.type(touchInput, 'Touch message');
    expect(fireEvent.keyDown(touchInput, { key: 'Enter' })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('caps autosizing at four lines and reveals the counter only near the limit', () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: 'League message' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 180 });

    fireEvent.change(input, { target: { value: 'a'.repeat(799) } });
    expect(screen.queryByText('799 / 1,000')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'a'.repeat(800) } });
    expect(screen.getByText('800 / 1,000')).toBeInTheDocument();
    expect(input).toHaveStyle({ height: '96px' });

    fireEvent.change(input, { target: { value: 'a'.repeat(1000) } });
    expect(screen.getByText('1,000 / 1,000 · Limit reached')).toHaveClass('text-destructive');
  });

  it('preserves scoped drafts across unmounts and isolates Draft Room drafts', async () => {
    const user = userEvent.setup();
    const rendered = renderComposer({ draftScope: leagueScope });
    const input = screen.getByRole('textbox', { name: 'League message' });
    await user.type(input, 'League draft');
    rendered.unmount();

    const restored = renderComposer({ draftScope: leagueScope });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'League message' })).toHaveValue('League draft')
    );
    restored.rerender(
      <SocialComposer
        label="League message"
        placeholder="Message"
        submitLabel="Send message"
        maxLength={1000}
        submitOnEnter
        compact
        draftScope={{
          ...leagueScope,
          surface: { type: 'draft-chat', draftId: 'draft-1' },
        }}
        onSubmit={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'League message' })).toHaveValue('')
    );
  });

  it('retains failed content and reuses the original idempotency key for retry', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(undefined);
    renderComposer({ onSubmit, draftScope: leagueScope });

    const input = screen.getByRole('textbox', { name: 'League message' });
    await user.type(input, 'Retry this');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    expect(input).toHaveValue('Retry this');
    const firstAttemptKey = onSubmit.mock.calls[0]?.[1];
    await user.click(screen.getByRole('button', { name: 'Retry sending message' }));

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[1]).toBe(firstAttemptKey);
    expect(input).toHaveValue('');
  });

  it('guards rapid repeated activation while a submission is pending', async () => {
    const user = userEvent.setup();
    let resolveSubmission: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmission = resolve;
        })
    );
    renderComposer({ onSubmit });

    await user.type(screen.getByRole('textbox', { name: 'League message' }), 'Only once');
    const send = screen.getByRole('button', { name: 'Send message' });
    await user.dblClick(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sending message' })).toBeDisabled();

    await act(async () => resolveSubmission?.());
  });

  it('preserves the draft and explains when sending is unavailable offline', async () => {
    const user = userEvent.setup();
    renderComposer({ draftScope: leagueScope });
    await user.type(screen.getByRole('textbox', { name: 'League message' }), 'Offline draft');

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(
      screen.getByRole('button', { name: 'Sending unavailable while offline' })
    ).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'League message' })).toHaveValue('Offline draft');
  });
});
