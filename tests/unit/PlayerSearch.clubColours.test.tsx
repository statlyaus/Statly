import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PlayerSearch from '@/components/PlayerSearch';
import { FALLBACK_GUERNSEY, guernseyFor } from '@/lib/clubGuernseys';

const fetchApi = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ fetchApi }));
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(value: T) => value }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('PlayerSearch club colours', () => {
  it('shows each club as the 13px square and abbreviation, never text on club colour', async () => {
    fetchApi.mockResolvedValue({
      players: [
        { id: 'p1', name: 'Patrick Dangerfield', team: 'Geelong', position: 'MID' },
        { id: 'p2', name: 'Lachie Neale', team: 'Brisbane Lions', position: 'MID' },
        { id: 'p3', name: 'Unknown Player', team: 'Tasmania Devils', position: 'FWD' },
      ],
    });
    const { container } = render(<PlayerSearch navigateToProfile={false} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search players' }), {
      target: { value: 'pa' },
    });
    await screen.findByText('Patrick Dangerfield');

    const squares = [...container.querySelectorAll<HTMLElement>('[data-club-square]')];
    expect(squares).toHaveLength(3);
    // Geelong wears white: a white square with an ink edge.
    expect(squares[0]).toHaveStyle({ background: guernseyFor('Geelong').base });
    expect(squares[0]).toHaveClass('border-foreground');
    const brisbane = guernseyFor('Brisbane');
    expect(brisbane).not.toBe(FALLBACK_GUERNSEY);
    expect(squares[1]).toHaveStyle({ background: brisbane.base });
    expect(squares[2]).toHaveStyle({ background: FALLBACK_GUERNSEY.base });
    for (const square of squares) {
      expect(square).toHaveClass('size-[13px]');
      expect(square).toBeEmptyDOMElement();
    }
    // No initials on a club fill any more.
    expect(screen.queryByText('PD')).toBeNull();
  });
});
