import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AflDraftHistoryExplorer } from '@/components/draft/AflDraftHistoryExplorer';
import { aflDraftHistoryYearResponseSchema } from '@/server/aflTradeIntelligence/outcomes/draftHistoryReadService';

const query = { year: 2025, q: '', club: '', draftKind: null } as const;

const activeResponse = aflDraftHistoryYearResponseSchema.parse({
  consistency: {
    contractVersion: 'afl-draft-history/v1',
    publicAssetBoundary: 'source_native_afl_draft_facts_no_user_or_fantasy_ownership',
    selection: 'active',
    registryRevision: 7,
    release: {
      releaseId: `outcome-release:${'a'.repeat(64)}`,
      projectionId: `outcome-projection:${'b'.repeat(64)}`,
      archiveDatasetId: 'archive-fixture-v2',
      metricRegistryVersion: 'afl-outcome-metrics-v1',
      effectiveThrough: '2025-11-30T00:00:00.000Z',
      publishedAt: '2025-12-01T00:00:00.000Z',
    },
    servedAt: '2025-12-02T00:00:00.000Z',
  },
  availableYears: [
    { year: 2025, selectionCount: 1, draftEventCount: 1, draftKinds: ['national_draft'] },
  ],
  year: { year: 2025, totalSelections: 1, filteredSelections: 1 },
  availableFilters: {
    draftKinds: ['national_draft'],
    clubs: [
      {
        aflClubId: 'club:western-bulldogs',
        name: 'Western Bulldogs',
        abbreviation: 'WB',
      },
    ],
  },
  selections: [
    {
      selectionId: 'selection:2025-national-14',
      eventId: 'event:2025-national-draft',
      eventVersionId: 'event-version:2025-national-draft-v1',
      year: 2025,
      draftKind: 'national_draft',
      draftName: '2025 AFL National Draft',
      draftDate: '2025-11-19',
      selectionNumber: 14,
      round: 1,
      pickId: 'pick:2025-national-14',
      club: {
        aflClubId: 'club:western-bulldogs',
        name: 'Western Bulldogs',
        abbreviation: 'WB',
      },
      originalClub: { aflClubId: 'club:gws', name: 'GWS', abbreviation: 'GWS' },
      player: {
        aflPlayerId: 'player:harry-kyle',
        displayName: 'Harry Kyle',
        identityStatus: 'resolved',
      },
      lineage: {
        status: 'linked_to_trade',
        edgeCount: 1,
        tradeRefs: [
          {
            tradeId: 'event:2025-gws-western-bulldogs-trade',
            year: 2025,
            title: '2025 Draft Pick Exchange: GWS and Western Bulldogs',
          },
        ],
      },
    },
  ],
});

const unavailableResponse = aflDraftHistoryYearResponseSchema.parse({
  consistency: {
    contractVersion: 'afl-draft-history/v1',
    publicAssetBoundary: 'source_native_afl_draft_facts_no_user_or_fantasy_ownership',
    selection: 'none',
    registryRevision: 0,
    release: null,
    servedAt: '2025-12-02T00:00:00.000Z',
  },
  availableYears: [],
  year: { year: 2025, totalSelections: 0, filteredSelections: 0 },
  availableFilters: { draftKinds: [], clubs: [] },
  selections: [],
});

describe('AflDraftHistoryExplorer', () => {
  it('explains pick, player, clubs, and released trade lineage in one view', () => {
    render(<AflDraftHistoryExplorer response={activeResponse} query={query} />);

    expect(
      screen.getByRole('heading', { name: 'Follow each pick from entitlement to player' })
    ).toBeVisible();
    expect(screen.getByText('1 of 1 selections')).toBeVisible();
    expect(screen.getAllByText('Harry Kyle')).toHaveLength(2);
    expect(screen.getAllByText('Western Bulldogs').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('GWS').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('link', { name: /2025 Draft Pick Exchange/ })).toHaveLength(2);
    expect(screen.getByRole('table')).toHaveAccessibleName(
      'Released AFL draft selections for 2025'
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveClass('min-h-11');
  });

  it('shows an honest release-gated empty state', () => {
    render(<AflDraftHistoryExplorer response={unavailableResponse} query={query} />);

    expect(screen.getByText('No active release')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Draft history is not activated' })).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });
});
