import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AflDraftTradeOutcomesExplorer } from '@/components/draft/AflDraftTradeOutcomesExplorer';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { aflDraftTradeOutcomeListResponseSchema } from '@/types/aflDraftTradeOutcomes';

const hash = (value: string) => value.repeat(64);

const query = {
  year: null,
  club: '',
  q: '',
  metric: null,
  status: null,
  cursor: null,
} as const;

const unavailableResponse = aflDraftTradeOutcomeListResponseSchema.parse({
  consistency: {
    contractVersion: 'afl-draft-trade-outcomes/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    selection: 'none',
    registryRevision: 0,
    release: null,
    servedAt: '2025-09-03T00:00:00.000Z',
    freshness: 'unavailable',
    supportedScope: [],
    excludedScope: ['Checked outcomes pending approved evidence'],
    warnings: [],
  },
  metricDefinitions: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  items: [],
  page: { limit: 25, nextCursor: null, total: null },
});

const activeResponse = aflDraftTradeOutcomeListResponseSchema.parse({
  consistency: {
    contractVersion: 'afl-draft-trade-outcomes/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    selection: 'active',
    registryRevision: 2,
    release: {
      releaseId: `outcome-release:${hash('a')}`,
      projectionId: `outcome-projection:${hash('b')}`,
      archiveDatasetId: 'archive-fixture-v1',
      metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
      effectiveThrough: '2025-09-01T00:00:00.000Z',
      publishedAt: '2025-09-02T00:00:00.000Z',
    },
    servedAt: '2025-09-03T00:00:00.000Z',
    freshness: 'current',
    supportedScope: ['Fixture scope'],
    excludedScope: [],
    warnings: [],
  },
  metricDefinitions: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  items: [
    {
      eventId: 'event:fixture-1',
      tradeId: null,
      assetId: 'asset:fixture-1',
      year: 2025,
      acquisitionType: 'National Draft',
      aflClubId: 'club:fixture-a',
      clubName: 'Fixture Club A',
      player: {
        aflPlayerId: 'player:fixture-1',
        displayName: 'Fixture Player',
        identityStatus: 'resolved',
      },
      checks: [
        {
          metric: 'games',
          status: 'matched',
          recordedValue: 0,
          observedValue: 0,
          delta: 0,
          coverageRatio: null,
          scopeLabel: 'All subsequent AFL clubs through 1 September 2025',
          effectiveThrough: '2025-09-01T00:00:00.000Z',
          message: 'Both approved sources record zero games in the exact checked scope.',
          sources: [
            {
              role: 'recorded',
              artifactId: `artifact:${hash('c')}`,
              locator: 'Workbook 2025!N2',
              rightsDecisionId: `gate-decision:${hash('d')}`,
              metricDefinitionId: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS[0].metricDefinitionId,
            },
            {
              role: 'observed',
              artifactId: `artifact:${hash('f')}`,
              locator: 'fitzRoy fixture aggregate',
              rightsDecisionId: `gate-decision:${hash('1')}`,
              metricDefinitionId: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS[0].metricDefinitionId,
            },
          ],
        },
      ],
      achievements: [
        {
          achievementId: 'achievement:fixture-1',
          label: 'Fixture best and fairest',
          season: 2025,
          aflClubId: 'club:fixture-a',
          status: 'checked',
          scopeLabel: 'Fixture Club A, 2025 AFL season',
          effectiveThrough: '2025-09-01T00:00:00.000Z',
          sources: [
            {
              role: 'recorded',
              artifactId: `artifact:${hash('2')}`,
              locator: 'Workbook 2025!R2',
              rightsDecisionId: `gate-decision:${hash('3')}`,
              achievementDefinitionId: `achievement-definition:${hash('4')}`,
            },
            {
              role: 'observed',
              artifactId: `artifact:${hash('5')}`,
              locator: 'Approved awards source fixture',
              rightsDecisionId: `gate-decision:${hash('6')}`,
              achievementDefinitionId: `achievement-definition:${hash('4')}`,
            },
          ],
        },
      ],
    },
  ],
  page: { limit: 25, nextCursor: 'release-bound-cursor-2', total: 2 },
});

const activeEmptyResponse = aflDraftTradeOutcomeListResponseSchema.parse({
  ...activeResponse,
  items: [],
  page: { limit: 25, nextCursor: null, total: 0 },
});

describe('AflDraftTradeOutcomesExplorer', () => {
  it('explains the unpublished release without inventing outcome values', () => {
    render(<AflDraftTradeOutcomesExplorer response={unavailableResponse} query={query} />);

    expect(
      screen.getByRole('heading', { name: 'Check what each AFL acquisition produced' })
    ).toBeVisible();
    expect(screen.getByText('Outcome release not published')).toBeVisible();
    expect(
      screen.getByText(/A public row appears only after stable player identity/i)
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Explore trade archive' })).toHaveAttribute(
      'href',
      '/draft/trades'
    );
    expect(screen.getByLabelText('Player or event')).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveClass('min-h-11');
    expect(screen.queryByRole('heading', { name: 'Checked acquisitions' })).toBeNull();
  });

  it('renders a checked zero as evidence rather than missing data', () => {
    render(<AflDraftTradeOutcomesExplorer response={activeResponse} query={query} />);

    expect(screen.getByText('Reviewed factual release')).toBeVisible();
    const result = screen.getByRole('heading', { name: 'Fixture Player' }).closest('article');
    expect(result).not.toBeNull();
    expect(within(result!).getByText('Matches source')).toBeVisible();
    expect(screen.getAllByText('0 games')).toHaveLength(2);
    expect(screen.queryByText('Not available')).toBeNull();
    expect(screen.getByText('Identity resolved')).toBeVisible();
    expect(screen.getByText('All subsequent AFL clubs through 1 September 2025')).toBeVisible();
    expect(screen.getByText('Fixture best and fairest')).toBeVisible();
    expect(screen.getByText(/Published 2 Sept 2025 · effective through 1 Sept 2025/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Next results' })).toHaveAttribute(
      'href',
      '/draft/outcomes?cursor=release-bound-cursor-2'
    );
  });

  it('renders multiple acquisitions from the same draft event', () => {
    const secondItem = {
      ...activeResponse.items[0],
      assetId: 'asset:fixture-2',
      aflClubId: 'club:fixture-b',
      clubName: 'Fixture Club B',
      player: {
        aflPlayerId: 'player:fixture-2',
        displayName: 'Second Fixture Player',
        identityStatus: 'resolved' as const,
      },
    };
    const sameEventResponse = aflDraftTradeOutcomeListResponseSchema.parse({
      ...activeResponse,
      items: [activeResponse.items[0], secondItem],
      page: { limit: 25, nextCursor: null, total: 2 },
    });

    render(<AflDraftTradeOutcomesExplorer response={sameEventResponse} query={query} />);

    expect(screen.getByRole('heading', { name: 'Fixture Player' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Second Fixture Player' })).toBeVisible();
  });

  it('renders an honest active-release empty state and unsupported-filter notice', () => {
    render(
      <AflDraftTradeOutcomesExplorer
        response={activeEmptyResponse}
        query={{ ...query, metric: null }}
        filterNotice="The active factual release does not include Brownlow votes. Showing all supported metrics instead."
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      /does not include Brownlow votes.*Showing all supported metrics/i
    );
    expect(
      screen.getByRole('heading', { name: 'No acquisitions match these filters' })
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Clear all filters' })).toHaveAttribute(
      'href',
      '/draft/outcomes'
    );
  });
});
