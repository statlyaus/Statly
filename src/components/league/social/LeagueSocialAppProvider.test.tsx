import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueSocialAppProvider from './LeagueSocialAppProvider';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/providers/SocketProvider', () => ({
  SocketProvider: ({ uid, children }: { uid: string; children: React.ReactNode }) => (
    <div data-testid="socket-provider" data-uid={uid}>
      {children}
    </div>
  ),
}));

vi.mock('./LeagueSocialWidgetProvider', () => ({
  LeagueSocialWidgetProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="widget-provider">{children}</div>
  ),
}));

vi.mock('./LeagueSocialWidget', () => ({
  default: ({ currentUserId }: { currentUserId: string }) => (
    <div data-testid="social-widget" data-user-id={currentUserId} />
  ),
}));

describe('LeagueSocialAppProvider', () => {
  it('owns one socket around app routes and the persistent widget for an authenticated user', () => {
    mocks.useAuth.mockReturnValue({ user: { uid: 'user-1' } });

    render(
      <LeagueSocialAppProvider>
        <main>App route</main>
      </LeagueSocialAppProvider>
    );

    expect(screen.getAllByTestId('socket-provider')).toHaveLength(1);
    expect(screen.getByTestId('socket-provider')).toHaveAttribute('data-uid', 'user-1');
    expect(screen.getByText('App route')).toBeInTheDocument();
    expect(screen.getByTestId('social-widget')).toHaveAttribute('data-user-id', 'user-1');
  });

  it('keeps the widget API boundary without opening a socket before authentication', () => {
    mocks.useAuth.mockReturnValue({ user: null });

    render(
      <LeagueSocialAppProvider>
        <main>Restoring route</main>
      </LeagueSocialAppProvider>
    );

    expect(screen.getByTestId('widget-provider')).toBeInTheDocument();
    expect(screen.queryByTestId('socket-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-widget')).not.toBeInTheDocument();
  });
});
