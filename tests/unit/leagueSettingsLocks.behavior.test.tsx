import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeagueSettingsPanel } from '@/components/league/LeagueSettingsPanels';
import type { League } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));
vi.mock('@/components/league/settings/CompetitionSettingsPanel', () => ({
  CompetitionSettingsPanel: () => null,
}));

const SCORING_REASON =
  'Scoring settings are locked because the competition was published on 2026-03-01.';
const DRAFT_REASON = 'Draft structure is locked because the draft has started.';

function settingsPayload(locks: { scoring: string | null; draftStructure: string | null }) {
  return {
    success: true,
    data: {
      league: { id: 'league-1', name: 'Premier', code: 'CODE', maxTeams: 8, locked: false },
      scoring: {
        scoringFormat: 'nine-category',
        categories: ['goals', 'tackles', 'intercepts'],
        scoringMode: 'H2H_EACH_CATEGORY',
        fixtureGenerationMode: 'AUTOMATIC',
        lineupSlots: { FWD: 5, DEF: 5, MID: 5, RUC: 1, UTIL: 3 },
        categoryDirections: {},
        scoringSettingsLockedAt: locks.scoring ? '2026-03-01T00:00:00.000Z' : null,
      },
      locks,
      roster: {
        rosterSize: 18,
        benchSize: 4,
        positionLimits: { DEF: 5, MID: 5, RUC: 1, FWD: 5, BENCH: 4 },
      },
      draft: {
        draftDate: '2026-03-01T00:00:00.000Z',
        draftType: 'snake',
        timePerPick: 120,
        pickOrder: 'random',
        timeZone: 'Australia/Melbourne',
        autoPickRules: { enabled: true, strategy: 'queue-first' },
      },
      waiver: { waiverRule: 'weekly', faabBudget: null },
    },
  };
}

function renderPanel() {
  render(
    <LeagueSettingsPanel
      league={{ id: 'league-1', name: 'Premier', code: 'CODE', maxTeams: 8 } as League}
      memberCount={8}
      isAdmin
      canAccessCompetitionRules
      isActive
      currentUserId="owner"
    />
  );
}

describe('league settings locks in the commissioner UI', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('shows scoring and draft structure read-only with the reason once both are locked', async () => {
    authenticatedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => settingsPayload({ scoring: SCORING_REASON, draftStructure: DRAFT_REASON }),
    });

    renderPanel();

    expect(await screen.findByText(SCORING_REASON)).toBeTruthy();
    expect(screen.getAllByText(DRAFT_REASON)).toHaveLength(2);
    expect((screen.getByLabelText('Scoring mode') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Draft Type') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Pick Order') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Bench') as HTMLInputElement).disabled).toBe(true);
    // Settings that stay open after the draft remain editable.
    expect((screen.getByLabelText('Time Per Pick') as HTMLSelectElement).disabled).toBe(false);
  });

  it('keeps draft structure editable while the draft is scheduled', async () => {
    authenticatedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => settingsPayload({ scoring: null, draftStructure: null }),
    });

    renderPanel();

    await waitFor(() => expect(authenticatedFetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect((screen.getByLabelText('Draft Type') as HTMLSelectElement).disabled).toBe(false)
    );
    expect(screen.queryByText(DRAFT_REASON)).toBeNull();
    expect((screen.getByLabelText('Scoring mode') as HTMLSelectElement).disabled).toBe(false);
  });
});
