import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PlayerSearch from '@/components/PlayerSearch';
import { FALLBACK_GUERNSEY, guernseyFor } from '@/lib/clubGuernseys';

const fetchApi = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ fetchApi }));
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(value: T) => value }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('PlayerSearch club colours', () => {
  it('colours each result avatar from the shared club guernseys', async () => {
    fetchApi.mockResolvedValue({
      players: [
        { id: 'p1', name: 'Patrick Dangerfield', team: 'Geelong', position: 'MID' },
        { id: 'p2', name: 'Lachie Neale', team: 'Brisbane Lions', position: 'MID' },
        { id: 'p3', name: 'Unknown Player', team: 'Tasmania Devils', position: 'FWD' },
      ],
    });
    render(<PlayerSearch navigateToProfile={false} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search players' }), {
      target: { value: 'pa' },
    });

    const geelong = guernseyFor('Geelong');
    expect(await screen.findByText('PD')).toHaveStyle({
      backgroundColor: geelong.base,
      color: geelong.trim,
    });

    const brisbane = guernseyFor('Brisbane');
    expect(brisbane).not.toBe(FALLBACK_GUERNSEY);
    expect(screen.getByText('LN')).toHaveStyle({
      backgroundColor: brisbane.base,
      color: brisbane.trim,
    });

    expect(screen.getByText('UP')).toHaveStyle({
      backgroundColor: FALLBACK_GUERNSEY.base,
      color: FALLBACK_GUERNSEY.trim,
    });
  });
});
