import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';

import type { CommissionerLeague } from '@/server/leagues/commissionerReadModel';

import CommissionerWorkspace from './CommissionerWorkspace';

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock('@/lib/api', () => ({ fetchApi: mocks.fetchApi }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

const joinedAt = '2026-02-01T00:00:00.000Z';

function league(overrides: Partial<CommissionerLeague> = {}): CommissionerLeague {
  return {
    id: 'league-1',
    name: 'Keepers League',
    inviteCode: 'KEEP01',
    maxTeams: 8,
    memberRemovalOpen: true,
    members: [
      { userId: 'owner', teamName: 'Owner FC', managerName: 'Olive', isOwner: true, joinedAt },
      { userId: 'alpha', teamName: 'Alpha FC', managerName: 'Alex', isOwner: false, joinedAt },
    ],
    ...overrides,
  };
}

function memberRow(teamName: string) {
  return screen.getByRole('row', { name: new RegExp(teamName) });
}

describe('CommissionerWorkspace', () => {
  beforeEach(() => {
    mocks.fetchApi.mockReset();
    mocks.refresh.mockReset();
    mocks.push.mockReset();
  });

  it('shows the real members of the selected league and links to its settings', () => {
    render(<CommissionerWorkspace leagues={[league()]} selectedLeagueId="league-1" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Keepers League' })).toBeInTheDocument();
    expect(screen.getByText(/2 of 8 teams/)).toHaveTextContent('Invite code KEEP01');
    expect(memberRow('Owner FC')).toHaveTextContent('Olive · Owner');
    expect(
      within(memberRow('Owner FC')).queryByRole('button', { name: /Remove/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'League settings' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=league-settings'
    );
  });

  it('removes a manager after confirmation and refreshes the persisted list', async () => {
    mocks.fetchApi.mockResolvedValue({ success: true, data: { memberCount: 1 } });
    render(<CommissionerWorkspace leagues={[league()]} selectedLeagueId="league-1" />);

    fireEvent.click(within(memberRow('Alpha FC')).getByRole('button', { name: 'Remove Alpha FC' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove manager' }));

    await waitFor(() =>
      expect(mocks.fetchApi).toHaveBeenCalledWith('leagues/league-1/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'removeMember', targetUserId: 'alpha' }),
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Alpha FC was removed.');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('explains that removal closes once the draft starts', () => {
    render(
      <CommissionerWorkspace
        leagues={[league({ memberRemovalOpen: false })]}
        selectedLeagueId="league-1"
      />
    );

    expect(
      within(memberRow('Alpha FC')).queryByRole('button', { name: /Remove/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('The draft has started, so managers can no longer be removed.')
    ).toBeInTheDocument();
  });

  it('announces a refused command without refreshing', async () => {
    mocks.fetchApi.mockRejectedValue(new Error('Only the league owner can transfer ownership.'));
    render(<CommissionerWorkspace leagues={[league()]} selectedLeagueId="league-1" />);

    fireEvent.click(
      within(memberRow('Alpha FC')).getByRole('button', { name: 'Make Alpha FC owner' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer ownership' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the league owner can transfer ownership.'
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('switches league through the URL when the owner has several leagues', () => {
    render(
      <CommissionerWorkspace
        leagues={[league(), league({ id: 'league-2', name: 'Second League' })]}
        selectedLeagueId="league-1"
      />
    );

    fireEvent.change(screen.getByLabelText('League'), { target: { value: 'league-2' } });

    expect(mocks.push).toHaveBeenCalledWith('/commissioner?league=league-2');
  });
});
