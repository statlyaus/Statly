import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { League, LeagueMember } from '@/types/leagues';

import { LeagueOverviewPanel } from './LeagueOverviewPanel';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));

const league = {
  id: 'league-1',
  name: 'Review League',
  maxTeams: 12,
  code: 'JOIN1234',
  categories: ['goals', 'tackles', 'inside50s'],
} as unknown as League;

function members(count: number): LeagueMember[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index}`,
    userId: `user-${index}`,
    teamName: `Team ${index}`,
  })) as unknown as LeagueMember[];
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof LeagueOverviewPanel>> = {}) {
  const onNavigate = vi.fn();
  render(
    <LeagueOverviewPanel
      league={league}
      activeMembers={members(1)}
      draftStatusLabel="Draft blocked"
      waiverPriorityIndex={-1}
      waiverPriorityLabel="Not set"
      waiverPolicyLabel="weekly"
      categoryLabels={['Goals', 'Tackles', 'Inside 50s']}
      waiverClaims={[]}
      waiversStatus="idle"
      onNavigate={onNavigate}
      isCommissioner
      draftBlockers={[
        { code: 'insufficient_members', message: 'Needs at least 2 teams to draft.' },
      ]}
      {...overrides}
    />
  );
  return { onNavigate };
}

describe('LeagueOverviewPanel first-run checklist', () => {
  it('tells a commissioner what to do next, using the real draft blockers and the join code', () => {
    const { onNavigate } = renderPanel();

    const checklist = screen.getByRole('region', { name: /get your league ready/i });
    expect(within(checklist).getByText('JOIN1234')).toBeInTheDocument();
    expect(within(checklist).getByText(/1 of 12 teams/i)).toBeInTheDocument();
    expect(within(checklist).getByText('Needs at least 2 teams to draft.')).toBeInTheDocument();

    fireEvent.click(within(checklist).getByRole('button', { name: /open draft/i }));
    expect(onNavigate).toHaveBeenCalledWith('draft');
  });

  it('lists every blocker even when several share the same code, without key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel({
      draftBlockers: [
        { code: 'position_pool_shortage', message: 'DEF needs 5 players.' },
        { code: 'position_pool_shortage', message: 'MID needs 7 players.' },
      ],
    });

    expect(screen.getByText('DEF needs 5 players.')).toBeInTheDocument();
    expect(screen.getByText('MID needs 7 players.')).toBeInTheDocument();
    expect(consoleError.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(
      false
    );
    consoleError.mockRestore();
  });

  it('does not repeat the draft status the league details already show when nothing blocks the draft', () => {
    renderPanel({ draftBlockers: [], draftStatusLabel: 'Draft room open' });

    expect(screen.getAllByText('Draft room open')).toHaveLength(1);
    expect(screen.getByRole('region', { name: /get your league ready/i })).toBeInTheDocument();
  });

  it('does not show the checklist to a manager who is not a commissioner', () => {
    renderPanel({ isCommissioner: false });
    expect(
      screen.queryByRole('region', { name: /get your league ready/i })
    ).not.toBeInTheDocument();
  });

  it('hides the checklist once the league is full and the draft has no blockers', () => {
    renderPanel({ activeMembers: members(12), draftBlockers: [] });
    expect(
      screen.queryByRole('region', { name: /get your league ready/i })
    ).not.toBeInTheDocument();
  });

  it('shows the nine-category preview instead of nothing while there are no fixtures', () => {
    renderPanel();
    expect(
      screen.getByRole('table', { name: /preview of your weekly matchup, no fixtures yet/i })
    ).toBeInTheDocument();
  });
});
