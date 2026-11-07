import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BasketballCategoryId } from '@/types/basketball';

import { PlayersControls } from './PlayersControls';

const { replace, refresh, authenticatedFetch } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  authenticatedFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));

const path = '/basketball/league-1/players';

function renderControls(
  punts: BasketballCategoryId[],
  extra: { categories?: BasketballCategoryId[]; params?: Record<string, string> } = {}
) {
  return render(
    <PlayersControls
      path={path}
      params={extra.params ?? {}}
      leagueId="league-1"
      userId="user-1"
      categories={extra.categories ?? ['PTS', 'REB', 'AST']}
      leaguePunts={['AST']}
      punts={punts}
      query={{ freeAgentsOnly: false, position: null, minMinutes: 0, search: '' }}
    />
  );
}

describe('PlayersControls punts', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    authenticatedFetch.mockReset();
  });

  it('tries a punt in the URL and drops the param when back at the league’s punts', async () => {
    const user = userEvent.setup();
    const { rerender } = renderControls(['AST']);

    expect(screen.getByRole('button', { name: 'Punt PTS' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await user.click(screen.getByRole('button', { name: 'Punt PTS' }));
    expect(replace).toHaveBeenLastCalledWith(`${path}?punts=AST%2CPTS`, { scroll: false });

    rerender(
      <PlayersControls
        path={path}
        params={{ punts: 'AST,PTS' }}
        leagueId="league-1"
        userId="user-1"
        categories={['PTS', 'REB', 'AST']}
        leaguePunts={['AST']}
        punts={['AST', 'PTS']}
        query={{ freeAgentsOnly: false, position: null, minMinutes: 0, search: '' }}
      />
    );
    expect(screen.getByRole('button', { name: 'Punt PTS' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'Punt PTS' }));
    expect(replace).toHaveBeenLastCalledWith(path, { scroll: false });
  });

  it('does not navigate on mount, so a punt what-if in the URL survives StrictMode', async () => {
    render(
      <StrictMode>
        <PlayersControls
          path={path}
          params={{ punts: 'AST,PTS' }}
          leagueId="league-1"
          userId="user-1"
          categories={['PTS', 'REB', 'AST']}
          leaguePunts={['AST']}
          punts={['AST', 'PTS']}
          query={{ freeAgentsOnly: false, position: null, minMinutes: 0, search: '' }}
        />
      </StrictMode>
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(replace).not.toHaveBeenCalled();
  });

  it('searches after typing stops', async () => {
    const user = userEvent.setup();
    renderControls(['AST']);
    await user.type(screen.getByLabelText('Filter by name or team'), 'jok');
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith(`${path}?q=jok`, { scroll: false })
    );
  });

  it('will not punt the last counted category', () => {
    renderControls(['AST', 'PTS']);
    expect(screen.getByRole('button', { name: 'Punt REB' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Punt PTS' })).toBeEnabled();
  });

  it('saves a what-if only after the server confirms', async () => {
    const user = userEvent.setup();
    authenticatedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: { code: 'CONFLICT', message: 'Try again.' } }),
        { status: 409 }
      )
    );
    renderControls(['AST', 'PTS'], { params: { punts: 'AST,PTS' } });

    await user.click(screen.getByRole('button', { name: 'Save as league punts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Punts not saved. Try again.');
    expect(refresh).not.toHaveBeenCalled();
    const [url, init] = authenticatedFetch.mock.calls[0];
    expect(url).toBe('/api/basketball/leagues/league-1');
    expect(init).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(init.body)).toEqual({ puntCategories: ['AST', 'PTS'] });

    authenticatedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    );
    await user.click(screen.getByRole('button', { name: 'Save as league punts' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(replace).toHaveBeenLastCalledWith(path, { scroll: false });
    expect(screen.getByRole('status')).toHaveTextContent('Saved as the league’s punts.');
  });
});
