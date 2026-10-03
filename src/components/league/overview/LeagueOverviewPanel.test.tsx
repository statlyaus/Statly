import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { League, LeagueMember } from '@/types/leagues';

import { LeagueOverviewPanel } from './LeagueOverviewPanel';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));

afterEach(() => vi.mocked(authenticatedFetch).mockReset());

const league = {
  id: 'league-1',
  name: 'Review League',
  maxTeams: 12,
  code: 'JOIN1234',
  categories: ['goals', 'tackles', 'inside50s'],
  draftDate: '2027-03-06T08:30:00.000Z',
  timeZone: 'Australia/Melbourne',
} as unknown as League;
const unscheduled = { ...league, draftDate: undefined };

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
  const checklist = () => screen.getByRole('region', { name: /get your league ready/i });

  it('invites managers with a join link, keeping the code visible for typing in', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel();

    expect(within(checklist()).getByText(/1 of 12 teams/i)).toBeInTheDocument();
    expect(within(checklist()).getByText('JOIN1234')).toBeInTheDocument();

    fireEvent.click(within(checklist()).getByRole('button', { name: /copy invite link/i }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/leagues/join?code=JOIN1234`);
    expect(await within(checklist()).findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('offers the native share sheet only where the browser has one', () => {
    renderPanel();
    expect(within(checklist()).queryByRole('button', { name: /^share$/i })).not.toBeInTheDocument();
  });

  it('shows the draft date and time, and how many teams the draft needs', () => {
    const { onNavigate } = renderPanel({
      draftBlockers: [
        { code: 'insufficient_members', message: 'At least two league members are required.' },
        { code: 'draft_room_missing', message: 'The draft room has not been created yet.' },
      ],
    });

    const draft = within(checklist()).getByText('Draft').parentElement!;
    expect(within(draft).getByText(/6 Mar/)).toBeInTheDocument();
    expect(
      within(draft).getByText('Needs at least 2 teams to draft (1 joined)')
    ).toBeInTheDocument();
    expect(screen.queryByText(/at least two league members/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/draft room has not been created/i)).not.toBeInTheDocument();

    fireEvent.click(within(checklist()).getByRole('button', { name: /open draft/i }));
    expect(onNavigate).toHaveBeenCalledWith('draft');
  });
  it('asks the commissioner to set a draft date when there is none', () => {
    const { onNavigate } = renderPanel({
      league: unscheduled,
      draftBlockers: [
        { code: 'draft_time_missing', message: 'A draft date and time is required.' },
      ],
    });
    expect(within(checklist()).getByText('Not scheduled')).toBeInTheDocument();

    fireEvent.click(within(checklist()).getByRole('button', { name: /set draft date/i }));
    expect(onNavigate).toHaveBeenCalledWith('league-settings');
  });
  it('never shows player-pool problems to a commissioner', () => {
    renderPanel({
      draftBlockers: [
        { code: 'player_pool_empty', message: 'No active players are available for this draft.' },
        { code: 'position_pool_shortage', message: 'DEF roster settings require 5 players.' },
      ],
    });
    expect(screen.queryByText(/active players/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/DEF roster/i)).not.toBeInTheDocument();
  });

  it('hides the checklist when the league is full and only system problems remain', () => {
    renderPanel({
      activeMembers: members(12),
      draftBlockers: [
        { code: 'player_pool_empty', message: 'No active players are available for this draft.' },
        { code: 'draft_room_missing', message: 'The draft room has not been created yet.' },
      ],
    });
    expect(
      screen.queryByRole('region', { name: /get your league ready/i })
    ).not.toBeInTheDocument();
  });

  it('still shows the draft date while only system problems block the draft', () => {
    renderPanel({
      draftBlockers: [{ code: 'player_pool_empty', message: 'No active players.' }],
    });
    const draft = within(checklist()).getByText('Draft').parentElement!;
    expect(within(draft).getByText(/6 Mar/)).toBeInTheDocument();
    expect(within(checklist()).queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText(/active players/i)).not.toBeInTheDocument();
  });
  it('stops asking for teams once enough have joined', () => {
    renderPanel({ activeMembers: members(2), draftBlockers: [] });
    expect(within(checklist()).queryByText(/needs at least 2 teams/i)).not.toBeInTheDocument();
  });
  it('only asks for fixtures when the league generates them manually', async () => {
    vi.mocked(authenticatedFetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ success: true, data: { round: 1, matchups: [], standings: [] } })
        )
    );

    renderPanel({
      currentUserId: 'user-0',
      league: { ...league, fixtureGenerationMode: 'MANUAL' },
    });
    expect(await within(checklist()).findByText('Fixtures')).toBeInTheDocument();
    fireEvent.click(within(checklist()).getByRole('button', { name: /open match centre/i }));

    cleanup();
    renderPanel({ currentUserId: 'user-0' });
    await screen.findByRole('table', { name: /preview of your weekly matchup/i });
    expect(within(checklist()).queryByText('Fixtures')).not.toBeInTheDocument();
  });

  it('does not repeat the draft status the league details already show', () => {
    renderPanel({ draftBlockers: [], draftStatusLabel: 'Draft room open' });

    expect(screen.getAllByText('Draft room open')).toHaveLength(1);
    expect(checklist()).toBeInTheDocument();
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
