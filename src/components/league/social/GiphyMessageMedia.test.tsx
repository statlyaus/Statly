import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gif: vi.fn().mockResolvedValue({
    data: {
      id: 'xT9IgG50Fb7Mi0prBC',
      title: 'Celebration',
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
  }),
}));

vi.mock('./giphyClient', () => ({
  getGiphyClient: () => ({ gif: mocks.gif }),
}));

import GiphyMessageMedia from './GiphyMessageMedia';

describe('GiphyMessageMedia', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });

  it('constrains a GIF in the timeline and opens an accessible expanded preview', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <GiphyMessageMedia gif={{ provider: 'giphy', id: 'xT9IgG50Fb7Mi0prBC' }} />
    );

    const expand = await screen.findByRole('button', { name: 'Expand GIF' });
    expect(screen.getByRole('img', { name: 'Celebration' })).toBeInTheDocument();
    expect(container.querySelector('.max-h-60')).toBeInTheDocument();
    expect(expand).toHaveClass(
      'bg-social-surface',
      'hover:bg-social-brand-soft',
      'active:bg-social-surface-subtle'
    );

    await user.click(expand);
    expect(screen.getByRole('dialog', { name: 'GIF preview' })).toHaveClass(
      'bg-social-surface',
      'border-social-border'
    );

    await user.click(screen.getByRole('button', { name: 'Close GIF preview' }));
    await waitFor(() => expect(expand).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'GIF preview' })).not.toBeInTheDocument();
  });
});
