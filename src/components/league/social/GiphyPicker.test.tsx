import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gif: {
    id: 'xT9IgG50Fb7Mi0prBC',
    title: 'Celebration',
    analytics_response_payload: 'analytics-payload',
    images: {
      fixed_width: {
        url: 'https://media.giphy.com/celebration.gif',
        width: '200',
        height: '150',
      },
      original: {
        url: 'https://media.giphy.com/celebration-original.gif',
        width: '480',
        height: '360',
      },
    },
  },
  search: vi.fn(),
  trending: vi.fn(),
  gifById: vi.fn(),
  pingback: vi.fn(),
}));

vi.mock('@giphy/js-fetch-api', () => ({
  GiphyFetch: class MockGiphyFetch {
    search = mocks.search;
    trending = mocks.trending;
    gif = mocks.gifById;
  },
}));

vi.mock('@giphy/js-analytics', () => ({
  pingback: mocks.pingback,
}));

import GiphyPicker from './GiphyPicker';

describe('GiphyPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue({ data: [mocks.gif] });
    mocks.trending.mockResolvedValue({ data: [mocks.gif] });
  });

  it('searches G-rated GIFs, sends a selection, and registers sent analytics', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<GiphyPicker apiKey="test-web-key" onSelect={onSelect} />);

    const trigger = screen.getByRole('button', { name: 'Add a GIF' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Choose a GIF' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Powered by GIPHY' })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search GIPHY' }), 'celebration');
    await user.click(screen.getByRole('button', { name: 'Search GIFs' }));

    await waitFor(() =>
      expect(mocks.search).toHaveBeenCalledWith('celebration', {
        offset: 0,
        limit: 20,
        rating: 'g',
        type: 'gifs',
      })
    );

    await user.click(await screen.findByRole('button', { name: 'Choose Celebration' }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        {
          provider: 'giphy',
          id: 'xT9IgG50Fb7Mi0prBC',
        },
        expect.stringMatching(/^chat-gif:/)
      )
    );
    expect(mocks.pingback).toHaveBeenCalledWith({
      analyticsResponsePayload: 'analytics-payload',
      actionType: 'SENT',
    });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Choose a GIF' })).not.toBeInTheDocument();
  });

  it('searches by button or Enter without submitting a host message form', async () => {
    const user = userEvent.setup();
    const onHostSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const { container } = render(
      <form aria-label="Message composer" onSubmit={onHostSubmit}>
        <textarea aria-label="Message draft" defaultValue="Keep this draft unsent" />
        <GiphyPicker apiKey="test-web-key" onSelect={vi.fn().mockResolvedValue(undefined)} />
        <button type="submit">Send message</button>
      </form>
    );

    await user.click(screen.getByRole('button', { name: 'Add a GIF' }));
    const search = screen.getByRole('searchbox', { name: 'Search GIPHY' });
    const searchRegion = screen.getByRole('search');

    expect(searchRegion.tagName).toBe('DIV');
    expect(container.querySelector('form form')).not.toBeInTheDocument();

    await user.type(search, 'celebration');
    await user.click(screen.getByRole('button', { name: 'Search GIFs' }));
    await waitFor(() =>
      expect(mocks.search).toHaveBeenCalledWith('celebration', expect.anything())
    );
    expect(onHostSubmit).not.toHaveBeenCalled();

    await user.clear(search);
    await user.type(search, 'victory{Enter}');
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith('victory', expect.anything()));
    expect(onHostSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message draft' })).toHaveValue(
      'Keep this draft unsent'
    );
  });

  it('stays hidden when the chat-specific Web SDK key is not configured', () => {
    const { container } = render(<GiphyPicker apiKey="" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses an icon-sized trigger in a compact composer', () => {
    render(<GiphyPicker apiKey="test-web-key" compact onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Add a GIF' })).toHaveClass(
      'size-11',
      'rounded-lg',
      'text-social-text-muted',
      'hover:bg-social-brand-soft'
    );
  });

  it('reuses the same idempotency key when a failed GIF selection is retried', async () => {
    const user = userEvent.setup();
    const onSelect = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce(undefined);
    render(<GiphyPicker apiKey="test-web-key" onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Add a GIF' }));
    const choice = await screen.findByRole('button', { name: 'Choose Celebration' });
    await user.click(choice);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to send that GIF. Please try again.'
    );

    await user.click(choice);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));

    const firstAttemptKey = onSelect.mock.calls[0]?.[1];
    const retryAttemptKey = onSelect.mock.calls[1]?.[1];
    expect(firstAttemptKey).toMatch(/^chat-gif:/);
    expect(retryAttemptKey).toBe(firstAttemptKey);
  });
});
