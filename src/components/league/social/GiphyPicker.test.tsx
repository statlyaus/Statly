import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gif: {
    id: 'xT9IgG50Fb7Mi0prBC',
    analytics_response_payload: 'analytics-payload',
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

vi.mock('@giphy/react-components', () => ({
  Grid: ({
    fetchGifs,
    onGifClick,
  }: {
    fetchGifs: (offset: number) => Promise<unknown>;
    onGifClick: (gif: typeof mocks.gif, event: MouseEvent<HTMLButtonElement>) => void;
  }) => (
    <div>
      <button type="button" onClick={() => void fetchGifs(0)}>
        Fetch GIFs
      </button>
      <button type="button" onClick={(event) => onGifClick(mocks.gif, event)}>
        Choose celebration
      </button>
    </div>
  ),
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

    await user.click(await screen.findByRole('button', { name: 'Choose celebration' }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        provider: 'giphy',
        id: 'xT9IgG50Fb7Mi0prBC',
      })
    );
    expect(mocks.pingback).toHaveBeenCalledWith({
      analyticsResponsePayload: 'analytics-payload',
      actionType: 'SENT',
    });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Choose a GIF' })).not.toBeInTheDocument();
  });

  it('stays hidden when the chat-specific Web SDK key is not configured', () => {
    const { container } = render(<GiphyPicker apiKey="" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses an icon-sized trigger in a compact composer', () => {
    render(<GiphyPicker apiKey="test-web-key" compact onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Add a GIF' })).toHaveClass(
      'size-10',
      'rounded-full'
    );
  });
});
