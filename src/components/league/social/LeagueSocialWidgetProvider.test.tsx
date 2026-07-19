import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  LeagueSocialWidgetProvider,
  getLeagueIdFromPathname,
  resolveLeagueSocialLeagueId,
  useLeagueSocialWidget,
} from './LeagueSocialWidgetProvider';

const navigation = vi.hoisted(() => ({ pathname: '/players' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

function WidgetHarness(): React.JSX.Element {
  const widget = useLeagueSocialWidget();
  return (
    <div>
      <output aria-label="league">{widget.leagueId ?? 'none'}</output>
      <output aria-label="mode">{widget.mode}</output>
      <output aria-label="view">{widget.view}</output>
      <output aria-label="context">{widget.composerContext?.title ?? 'none'}</output>
      <button type="button" onClick={() => widget.setLeagueContext('draft-league', 'Draft')}>
        Register draft
      </button>
      <button type="button" onClick={() => widget.setLeagueContext(null)}>
        Clear draft
      </button>
      <button
        type="button"
        onClick={() =>
          widget.open({
            leagueId: 'discussion-league',
            view: 'board',
            context: {
              type: 'player',
              id: 'player-1',
              title: 'Discuss Alex Stat',
            },
          })
        }
      >
        Discuss player
      </button>
      <button type="button" onClick={widget.minimize}>
        Minimize
      </button>
      <button type="button" onClick={() => widget.open()}>
        Reopen
      </button>
      <button type="button" onClick={widget.clearComposerContext}>
        Clear context
      </button>
    </div>
  );
}

describe('LeagueSocialWidgetProvider', () => {
  it('resolves explicit league routes and ignores reserved league routes', () => {
    expect(getLeagueIdFromPathname('/leagues/league%201/trades')).toBe('league 1');
    expect(getLeagueIdFromPathname('/leagues/new')).toBeNull();
    expect(getLeagueIdFromPathname('/players')).toBeNull();
  });

  it('uses route, registered, requested, then cookie league precedence', () => {
    expect(
      resolveLeagueSocialLeagueId({
        pathname: '/leagues/route-league',
        registeredLeagueId: 'draft-league',
        requestedLeagueId: 'discussion-league',
        cookieLeagueId: 'cookie-league',
      })
    ).toBe('route-league');
    expect(
      resolveLeagueSocialLeagueId({
        pathname: '/drafts/draft-1',
        registeredLeagueId: 'draft-league',
        requestedLeagueId: 'discussion-league',
        cookieLeagueId: 'cookie-league',
      })
    ).toBe('draft-league');
    expect(
      resolveLeagueSocialLeagueId({
        pathname: '/players',
        registeredLeagueId: null,
        requestedLeagueId: 'discussion-league',
        cookieLeagueId: 'cookie-league',
      })
    ).toBe('discussion-league');
  });

  it('opens contextual discussion in chat and preserves it while minimized', async () => {
    const user = userEvent.setup();
    render(
      <LeagueSocialWidgetProvider>
        <WidgetHarness />
      </LeagueSocialWidgetProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Discuss player' }));
    expect(screen.getByLabelText('league')).toHaveTextContent('discussion-league');
    expect(screen.getByLabelText('mode')).toHaveTextContent('open');
    expect(screen.getByLabelText('view')).toHaveTextContent('chat');
    expect(screen.getByLabelText('context')).toHaveTextContent('Discuss Alex Stat');

    await user.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(screen.getByLabelText('mode')).toHaveTextContent('minimized');
    expect(screen.getByLabelText('context')).toHaveTextContent('Discuss Alex Stat');

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByLabelText('mode')).toHaveTextContent('open');
    expect(screen.getByLabelText('context')).toHaveTextContent('Discuss Alex Stat');

    await user.click(screen.getByRole('button', { name: 'Clear context' }));
    await waitFor(() => expect(screen.getByLabelText('context')).toHaveTextContent('none'));
  });

  it('clears composer context when the effective league changes and does not restore it later', async () => {
    const user = userEvent.setup();
    render(
      <LeagueSocialWidgetProvider>
        <WidgetHarness />
      </LeagueSocialWidgetProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Discuss player' }));
    expect(screen.getByLabelText('league')).toHaveTextContent('discussion-league');
    expect(screen.getByLabelText('context')).toHaveTextContent('Discuss Alex Stat');

    await user.click(screen.getByRole('button', { name: 'Register draft' }));
    expect(screen.getByLabelText('league')).toHaveTextContent('draft-league');
    expect(screen.getByLabelText('context')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'Clear draft' }));
    expect(screen.getByLabelText('league')).toHaveTextContent('discussion-league');
    expect(screen.getByLabelText('context')).toHaveTextContent('none');
  });
});
