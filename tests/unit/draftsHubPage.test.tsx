import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DraftsPage from '@/app/(app)/drafts/page';
import { listMemberLeagueDrafts } from '@/server/draft/readModels/memberLeagueDraftsReadModel';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('redirected');
  }),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserIdFromServerContext: async () => 'viewer-1',
}));

vi.mock('@/server/draft/readModels/memberLeagueDraftsReadModel', () => ({
  listMemberLeagueDrafts: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listMemberLeagueDrafts).mockReset();
});

describe('/drafts hub', () => {
  it("lists the viewer's league drafts, each linking to its league's Draft tab", async () => {
    vi.mocked(listMemberLeagueDrafts).mockResolvedValue([
      {
        id: 'draft-1',
        status: 'SCHEDULED',
        leagueId: 'league-a',
        leagueName: 'Footy Nerds',
        startAt: new Date('2027-03-01T09:00:00Z'),
        timeZone: 'Australia/Melbourne',
        createdAt: new Date('2026-11-01T00:00:00Z'),
      },
      {
        id: 'draft-2',
        status: 'COMPLETED',
        leagueId: 'league b',
        leagueName: 'Work League',
        startAt: null,
        timeZone: 'UTC',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    ]);

    render(await DraftsPage());

    expect(listMemberLeagueDrafts).toHaveBeenCalledWith('viewer-1');
    const list = screen.getByRole('list', { name: 'Your league drafts' });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/leagues/league-a?tab=draft');
    expect(links[0]).toHaveTextContent('Footy Nerds');
    expect(links[0]).toHaveTextContent('Scheduled');
    expect(links[1]).toHaveAttribute('href', '/leagues/league%20b?tab=draft');
    expect(links[1]).toHaveTextContent('Completed');
    expect(links[1]).toHaveTextContent('Start time not set');
    expect(screen.queryByText(/not in any league drafts/)).not.toBeInTheDocument();
  });

  it('shows an empty state with links to join or create a league', async () => {
    vi.mocked(listMemberLeagueDrafts).mockResolvedValue([]);

    render(await DraftsPage());

    expect(screen.getByText("You're not in any league drafts yet")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join a league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
    expect(screen.getByRole('link', { name: 'Create a league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.queryByRole('link', { name: /create draft/i })).not.toBeInTheDocument();
  });

  it('has no standalone create or settings pages', () => {
    for (const page of ['create', 'settings']) {
      expect(existsSync(join(process.cwd(), `src/app/(app)/drafts/${page}/page.tsx`))).toBe(false);
    }
  });
});
