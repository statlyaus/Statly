import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAuthBypassEnabled: vi.fn(),
  leagueWaiversContainer: vi.fn(({ disableRealtime }: { disableRealtime?: boolean }) => (
    <div data-testid="waivers-container" data-disable-realtime={String(Boolean(disableRealtime))} />
  )),
}));

vi.mock('@/lib/authBypass', () => ({
  isAuthBypassEnabled: mocks.isAuthBypassEnabled,
}));

vi.mock('@/components/waivers/LeagueWaiversContainer', () => ({
  default: mocks.leagueWaiversContainer,
}));

import WaiversClient from './WaiversClient';

describe('WaiversClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses API polling instead of Firestore realtime when auth bypass is enabled', () => {
    mocks.isAuthBypassEnabled.mockReturnValue(true);

    render(<WaiversClient leagueId="league-1" />);

    expect(screen.getByTestId('waivers-container')).toHaveAttribute(
      'data-disable-realtime',
      'true'
    );
    expect(mocks.leagueWaiversContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        disableRealtime: true,
      }),
      undefined
    );
  });

  it('keeps Firestore realtime enabled for normal authenticated sessions', () => {
    mocks.isAuthBypassEnabled.mockReturnValue(false);

    render(<WaiversClient leagueId="league-1" />);

    expect(screen.getByTestId('waivers-container')).toHaveAttribute(
      'data-disable-realtime',
      'false'
    );
    expect(mocks.leagueWaiversContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        disableRealtime: false,
      }),
      undefined
    );
  });
});
