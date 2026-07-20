import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueSocialWidget, { getDraftIdFromPathname } from './LeagueSocialWidget';
import { LeagueSocialWidgetProvider } from './LeagueSocialWidgetProvider';

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ pathname: '/players' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock('@/contexts/SocketContext', () => ({
  useSocket: () => null,
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: mocks.authenticatedFetch,
}));

vi.mock('./LeagueSocialShell', () => ({
  default: ({
    visible,
    composerContext,
    showHeader,
    compact,
    className,
    composerLabel,
    composerSurface,
  }: {
    visible?: boolean;
    composerContext?: { title: string } | null;
    showHeader?: boolean;
    compact?: boolean;
    className?: string;
    composerLabel?: string;
    composerSurface?: { type: 'league-chat' } | { type: 'draft-chat'; draftId: string };
  }) => (
    <button
      type="button"
      data-testid="social-shell-control"
      data-visible={visible ? 'true' : 'false'}
      data-show-header={showHeader ? 'true' : 'false'}
      data-compact={compact ? 'true' : 'false'}
      data-class-name={className}
      data-composer-label={composerLabel}
      data-composer-surface={composerSurface?.type}
      data-draft-id={composerSurface?.type === 'draft-chat' ? composerSurface.draftId : undefined}
    >
      {composerContext?.title ?? 'Composer control'}
    </button>
  ),
}));

describe('LeagueSocialWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.pathname = '/players';
    document.cookie = 'statly_last_league_id=league-1; path=/';
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    mocks.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/social/summary')
          ? {
              success: true,
              data: {
                unread: { chat: 2, board: 3, activity: 0 },
              },
            }
          : {
              success: true,
              data: {
                league: { id: 'league-1', name: 'Premier League' },
              },
            },
    }));
  });

  it('keeps the social shell mounted and restores panel focus across minimize and reopen', async () => {
    const user = userEvent.setup();
    render(
      <LeagueSocialWidgetProvider>
        <LeagueSocialWidget currentUserId="user-1" />
      </LeagueSocialWidgetProvider>
    );

    const launcher = await screen.findByRole('button', { name: /open league social/i });
    expect(launcher).toHaveAttribute('title', 'League Social');
    expect(launcher).toHaveClass(
      'league-social',
      'size-14',
      'rounded-full',
      'bottom-6',
      'right-6',
      'bg-social-brand-strong'
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /5 unread/i })).toBeInTheDocument()
    );

    await user.click(launcher);
    const panel = screen.getByLabelText('League social panel');
    const shellControl = screen.getByTestId('social-shell-control');
    expect(await screen.findByText('League Social')).toBeInTheDocument();
    expect(screen.getByText('League Social').parentElement?.parentElement).toHaveClass(
      'bg-social-brand-strong',
      'text-social-brand-foreground'
    );
    expect(screen.getByText('Premier League')).toBeInTheDocument();
    expect(panel).toHaveClass(
      'league-social',
      'bg-social-canvas',
      'inset-0',
      'h-[100dvh]',
      'w-full',
      'sm:w-[clamp(26.25rem,32vw,30rem)]',
      'sm:h-[clamp(36.25rem,76dvh,45rem)]',
      'sm:max-w-[calc(100vw-3rem)]',
      'sm:max-h-[calc(100dvh-3rem)]'
    );
    expect(shellControl).toHaveAttribute('data-visible', 'true');
    expect(shellControl).toHaveAttribute('data-show-header', 'false');
    expect(shellControl).toHaveAttribute('data-compact', 'true');
    expect(shellControl).toHaveAttribute(
      'data-composer-label',
      'Message the members of Premier League'
    );
    expect(shellControl).toHaveAttribute('data-composer-surface', 'league-chat');
    expect(shellControl).toHaveAttribute(
      'data-class-name',
      expect.stringContaining('h-full !min-h-0')
    );
    expect(screen.queryByRole('button', { name: /close league social/i })).not.toBeInTheDocument();

    shellControl.focus();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /open league social/i })).toHaveFocus()
    );
    expect(screen.getByTestId('social-shell-control')).toHaveAttribute('data-visible', 'false');

    await user.click(screen.getByRole('button', { name: /open league social/i }));
    await waitFor(() => expect(screen.getByTestId('social-shell-control')).toHaveFocus());
    expect(screen.getByTestId('social-shell-control')).toHaveAttribute('data-visible', 'true');
  });

  it('ignores an aborted summary response after the effective league changes', async () => {
    navigation.pathname = '/leagues/league-a';
    let resolveLeagueA:
      | ((value: {
          ok: boolean;
          json: () => Promise<{
            success: boolean;
            data: { unread: { chat: number; board: number; activity: number } };
          }>;
        }) => void)
      | undefined;
    const leagueASummary = new Promise<{
      ok: boolean;
      json: () => Promise<{
        success: boolean;
        data: { unread: { chat: number; board: number; activity: number } };
      }>;
    }>((resolve) => {
      resolveLeagueA = resolve;
    });
    mocks.authenticatedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/leagues/league-a/social/summary') return leagueASummary;
      if (url === '/api/leagues/league-b/social/summary') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { unread: { chat: 1, board: 0, activity: 0 } },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { league: { name: url.includes('league-a') ? 'League A' : 'League B' } },
        }),
      };
    });

    const rendered = render(
      <LeagueSocialWidgetProvider>
        <LeagueSocialWidget currentUserId="user-1" />
      </LeagueSocialWidgetProvider>
    );
    await waitFor(() =>
      expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
        '/api/leagues/league-a/social/summary',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        'user-1'
      )
    );

    navigation.pathname = '/leagues/league-b';
    rendered.rerender(
      <LeagueSocialWidgetProvider>
        <LeagueSocialWidget currentUserId="user-1" />
      </LeagueSocialWidgetProvider>
    );
    await screen.findByRole('button', { name: /1 unread/i });

    resolveLeagueA?.({
      ok: true,
      json: async () => ({
        success: true,
        data: { unread: { chat: 9, board: 0, activity: 0 } },
      }),
    });
    await Promise.resolve();

    expect(screen.getByRole('button', { name: /1 unread/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /9 unread/i })).not.toBeInTheDocument();
    const leagueASummaryCall = mocks.authenticatedFetch.mock.calls.find(
      ([url]) => url === '/api/leagues/league-a/social/summary'
    );
    expect((leagueASummaryCall?.[1] as RequestInit).signal).toMatchObject({ aborted: true });
  });

  it('scopes the shared composer to the active draft-room route', async () => {
    navigation.pathname = '/drafts/draft%2042';
    const user = userEvent.setup();
    render(
      <LeagueSocialWidgetProvider>
        <LeagueSocialWidget currentUserId="user-1" />
      </LeagueSocialWidgetProvider>
    );

    await user.click(await screen.findByRole('button', { name: /open league social/i }));
    const shellControl = screen.getByTestId('social-shell-control');

    expect(shellControl).toHaveAttribute('data-composer-surface', 'draft-chat');
    expect(shellControl).toHaveAttribute('data-draft-id', 'draft 42');
  });

  it('recognizes only live draft-room routes as draft composer surfaces', () => {
    expect(getDraftIdFromPathname('/drafts/draft-42')).toBe('draft-42');
    expect(getDraftIdFromPathname('/drafts/draft-42/')).toBe('draft-42');
    expect(getDraftIdFromPathname('/drafts/create')).toBeNull();
    expect(getDraftIdFromPathname('/drafts/history')).toBeNull();
    expect(getDraftIdFromPathname('/drafts/settings')).toBeNull();
    expect(getDraftIdFromPathname('/drafts/draft-42/settings')).toBeNull();
  });
});
