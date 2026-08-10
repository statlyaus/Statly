import { describe, expect, it } from 'vitest';

import {
  aflDraftTradeOutcomeMetricCheckSchema,
  aflDraftTradeOutcomeListItemSchema,
  aflDraftTradeOutcomeListResponseSchema,
  aflDraftTradeOutcomeReleaseRefSchema,
  type AflDraftTradeOutcomeListItem,
  type AflDraftTradeOutcomeReleaseRef,
} from '@/types/aflDraftTradeOutcomes';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  AflDraftTradeOutcomeReadError,
  createAflDraftTradeOutcomeReadService,
  type AflDraftTradeOutcomeProjectionPage,
  type AflDraftTradeOutcomeReleaseSelection,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';

const hash = (value: string) => value.repeat(64);

const release: AflDraftTradeOutcomeReleaseRef = {
  releaseId: `outcome-release:${hash('a')}`,
  projectionId: `outcome-projection:${hash('b')}`,
  archiveDatasetId: 'archive-fixture-v1',
  metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  effectiveThrough: '2025-09-01T00:00:00.000Z',
  publishedAt: '2025-09-02T00:00:00.000Z',
};

const zeroGamesCheck = aflDraftTradeOutcomeMetricCheckSchema.parse({
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
      locator: 'fitzRoy season aggregate player:fixture-player',
      rightsDecisionId: `gate-decision:${hash('1')}`,
      metricDefinitionId: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS[0].metricDefinitionId,
    },
  ],
});

const item: AflDraftTradeOutcomeListItem = aflDraftTradeOutcomeListItemSchema.parse({
  eventId: 'event:fixture-2025-0001',
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
  checks: [zeroGamesCheck],
  achievements: [],
});

const selection: AflDraftTradeOutcomeReleaseSelection = {
  registryRevision: 3,
  scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  environment: 'test_fixture',
  release,
  metricDefinitions: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.filter(
    ({ metric }) => metric === 'games' || metric === 'goals'
  ),
  supportedScope: ['Fixture AFL outcomes'],
  excludedScope: ['Fixture awards pending source approval'],
};

const request = {
  scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  year: null,
  club: '',
  q: '',
  metric: null,
  status: null,
  limit: 25,
  cursor: null,
} as const;

function projection(overrides: Partial<AflDraftTradeOutcomeProjectionPage> = {}) {
  return {
    metadata: {
      scopeKey: selection.scopeKey,
      release,
      freshness: 'current' as const,
      warnings: [],
    },
    items: [item],
    nextCursor: null,
    total: 1,
    ...overrides,
  };
}

describe('AFL Draft & Trade outcome public contracts', () => {
  it('keeps a checked zero distinct from unavailable evidence', () => {
    expect(zeroGamesCheck.recordedValue).toBe(0);
    expect(zeroGamesCheck.observedValue).toBe(0);
    expect(zeroGamesCheck.status).toBe('matched');

    expect(() =>
      aflDraftTradeOutcomeMetricCheckSchema.parse({
        ...zeroGamesCheck,
        status: 'unavailable',
      })
    ).toThrow();
  });

  it('rejects fantasy ownership fields at the public response boundary', () => {
    expect(() =>
      aflDraftTradeOutcomeListItemSchema.parse({
        ...item,
        userId: 'user:must-not-cross-this-boundary',
      })
    ).toThrow();
    expect(() =>
      aflDraftTradeOutcomeListItemSchema.parse({
        ...item,
        eventId: 'user:must-not-be-an-afl-event',
      })
    ).toThrow();
  });

  it('keeps measured facts and checked achievements off unresolved player identities', () => {
    expect(() =>
      aflDraftTradeOutcomeListItemSchema.parse({
        ...item,
        player: { aflPlayerId: null, displayName: 'Ambiguous Player', identityStatus: 'ambiguous' },
      })
    ).toThrow();

    expect(
      aflDraftTradeOutcomeListItemSchema.parse({
        ...item,
        player: {
          aflPlayerId: null,
          displayName: 'Unresolved Player',
          identityStatus: 'unresolved',
        },
        checks: [
          {
            metric: 'games',
            status: 'unavailable',
            recordedValue: null,
            observedValue: null,
            delta: null,
            coverageRatio: null,
            scopeLabel: null,
            effectiveThrough: null,
            message: 'Player identity is unresolved.',
            sources: [],
          },
        ],
      })
    ).toMatchObject({ player: { identityStatus: 'unresolved' } });
  });

  it('enforces release chronology and release-bound fact cutoffs', () => {
    expect(() =>
      aflDraftTradeOutcomeReleaseRefSchema.parse({
        ...release,
        effectiveThrough: '2025-09-04T00:00:00.000Z',
      })
    ).toThrow();

    expect(() =>
      aflDraftTradeOutcomeListResponseSchema.parse({
        consistency: {
          contractVersion: 'afl-draft-trade-outcomes/v1',
          publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
          selection: 'active',
          registryRevision: selection.registryRevision,
          release,
          servedAt: '2025-09-03T00:00:00.000Z',
          freshness: 'current',
          supportedScope: [],
          excludedScope: [],
          warnings: [],
        },
        metricDefinitions: selection.metricDefinitions,
        items: [
          {
            ...item,
            checks: [{ ...zeroGamesCheck, effectiveThrough: '2025-09-02T00:00:00.000Z' }],
          },
        ],
        page: { limit: 25, nextCursor: null, total: 1 },
      })
    ).toThrow();
  });

  it('requires paired, ordered evidence with one metric definition for a matched check', () => {
    expect(() =>
      aflDraftTradeOutcomeMetricCheckSchema.parse({
        ...zeroGamesCheck,
        sources: [zeroGamesCheck.sources[0]],
      })
    ).toThrow();
    expect(() =>
      aflDraftTradeOutcomeMetricCheckSchema.parse({
        ...zeroGamesCheck,
        sources: [
          zeroGamesCheck.sources[0],
          {
            ...zeroGamesCheck.sources[1],
            metricDefinitionId: `metric-definition:${hash('9')}`,
          },
        ],
      })
    ).toThrow();
  });

  it('requires every partial value to travel with evidence from the same source role', () => {
    const recordedSource = zeroGamesCheck.sources[0];
    const observedSource = zeroGamesCheck.sources[1];
    const partialBase = {
      metric: 'games' as const,
      status: 'partial' as const,
      delta: null,
      coverageRatio: 0.5,
      scopeLabel: 'Half of the exact AFL custody window',
      effectiveThrough: '2025-09-01T00:00:00.000Z',
      message: 'Only half of the exact scope is covered.',
    };

    expect(
      aflDraftTradeOutcomeMetricCheckSchema.parse({
        ...partialBase,
        recordedValue: 5,
        observedValue: null,
        sources: [recordedSource],
      })
    ).toMatchObject({ recordedValue: 5, observedValue: null });
    expect(() =>
      aflDraftTradeOutcomeMetricCheckSchema.parse({
        ...partialBase,
        recordedValue: 5,
        observedValue: null,
        sources: [observedSource],
      })
    ).toThrow();
    expect(() =>
      aflDraftTradeOutcomeMetricCheckSchema.parse({
        ...partialBase,
        recordedValue: null,
        observedValue: null,
        sources: [recordedSource],
      })
    ).toThrow();
  });
});

describe('AFL Draft & Trade outcome read service', () => {
  it('returns an honest no-release response without consulting a repository', async () => {
    let repositoryCalls = 0;
    const service = createAflDraftTradeOutcomeReadService({
      now: () => '2025-09-03T00:00:00.000Z',
      releaseSelector: {
        async capture() {
          return { registryRevision: 0, selection: null };
        },
      },
      repository: {
        async list() {
          repositoryCalls += 1;
          return projection();
        },
      },
    });

    const response = await service.list(request);

    expect(repositoryCalls).toBe(0);
    expect(response.consistency.selection).toBe('none');
    expect(response.consistency.release).toBeNull();
    expect(response.items).toEqual([]);
    expect(response.metricDefinitions.map(({ metric }) => metric)).toEqual([
      'games',
      'goals',
      'coaches_votes',
      'brownlow_votes',
    ]);
  });

  it('serves only rows bound to the exact captured release', async () => {
    const service = createAflDraftTradeOutcomeReadService({
      now: () => '2025-09-03T00:00:00.000Z',
      releaseSelector: {
        async capture() {
          return { registryRevision: selection.registryRevision, selection };
        },
      },
      repository: {
        async list(capturedSelection) {
          expect(capturedSelection).toEqual(selection);
          return projection();
        },
      },
    });

    const response = await service.list(request);

    expect(response.consistency.selection).toBe('active');
    expect(response.consistency.release).toEqual(release);
    expect(response.metricDefinitions.map(({ metric }) => metric)).toEqual(['games', 'goals']);
    expect(response.items[0]?.checks[0]?.recordedValue).toBe(0);
  });

  it('serves distinct acquisitions from the same draft event', async () => {
    const secondItem = aflDraftTradeOutcomeListItemSchema.parse({
      ...item,
      assetId: 'asset:fixture-2',
      aflClubId: 'club:fixture-b',
      clubName: 'Fixture Club B',
      player: {
        aflPlayerId: 'player:fixture-2',
        displayName: 'Second Fixture Player',
        identityStatus: 'resolved',
      },
    });
    const service = createAflDraftTradeOutcomeReadService({
      now: () => '2025-09-03T00:00:00.000Z',
      releaseSelector: {
        async capture() {
          return { registryRevision: selection.registryRevision, selection };
        },
      },
      repository: {
        async list() {
          return projection({ items: [item, secondItem], total: 2 });
        },
      },
    });

    const response = await service.list(request);

    expect(response.items.map(({ player }) => player.displayName)).toEqual([
      'Fixture Player',
      'Second Fixture Player',
    ]);
  });

  it('rejects duplicate acquisition rows within one response', async () => {
    const service = createAflDraftTradeOutcomeReadService({
      now: () => '2025-09-03T00:00:00.000Z',
      releaseSelector: {
        async capture() {
          return { registryRevision: selection.registryRevision, selection };
        },
      },
      repository: {
        async list() {
          return projection({ items: [item, item], total: 2 });
        },
      },
    });

    await expect(service.list(request)).rejects.toMatchObject({
      code: 'INVALID_PROJECTION_PAYLOAD',
    } satisfies Partial<AflDraftTradeOutcomeReadError>);
  });

  it('serves the captured release definitions rather than current hard-coded copy', async () => {
    const historicalSelection: AflDraftTradeOutcomeReleaseSelection = {
      ...selection,
      metricDefinitions: selection.metricDefinitions.map((definition) =>
        definition.metric === 'games'
          ? { ...definition, label: 'Historical AFL games definition' }
          : definition
      ),
    };
    const service = createAflDraftTradeOutcomeReadService({
      now: () => '2025-09-03T00:00:00.000Z',
      releaseSelector: {
        async capture() {
          return {
            registryRevision: historicalSelection.registryRevision,
            selection: historicalSelection,
          };
        },
      },
      repository: {
        async list() {
          return projection();
        },
      },
    });

    const response = await service.list(request);

    expect(response.metricDefinitions.find(({ metric }) => metric === 'games')?.label).toBe(
      'Historical AFL games definition'
    );
  });

  it('fails closed when captured definitions do not belong to the release registry', async () => {
    const invalidSelection: AflDraftTradeOutcomeReleaseSelection = {
      ...selection,
      metricDefinitions: selection.metricDefinitions.map((definition) => ({
        ...definition,
        metricRegistryVersion: 'another-metric-registry-v1',
      })),
    };
    const service = createAflDraftTradeOutcomeReadService({
      releaseSelector: {
        async capture() {
          return {
            registryRevision: invalidSelection.registryRevision,
            selection: invalidSelection,
          };
        },
      },
      repository: {
        async list() {
          return projection();
        },
      },
    });

    await expect(service.list(request)).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('fails closed when returned rows do not satisfy exact year and check filters', async () => {
    const service = createAflDraftTradeOutcomeReadService({
      releaseSelector: {
        async capture() {
          return { registryRevision: selection.registryRevision, selection };
        },
      },
      repository: {
        async list() {
          return projection();
        },
      },
    });

    await expect(
      service.list({
        ...request,
        year: 2024,
        metric: 'goals',
        status: 'different',
      })
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('fails closed when evidence names a different definition for the same metric', async () => {
    const mismatchedItem = aflDraftTradeOutcomeListItemSchema.parse({
      ...item,
      checks: [
        {
          ...zeroGamesCheck,
          sources: zeroGamesCheck.sources.map((source) => ({
            ...source,
            metricDefinitionId: `metric-definition:${hash('9')}`,
          })),
        },
      ],
    });
    const service = createAflDraftTradeOutcomeReadService({
      releaseSelector: {
        async capture() {
          return { registryRevision: selection.registryRevision, selection };
        },
      },
      repository: {
        async list() {
          return projection({ items: [mismatchedItem] });
        },
      },
    });

    await expect(service.list(request)).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('fails closed when a projection returns a metric outside the captured release', async () => {
    const goalsOnlySelection: AflDraftTradeOutcomeReleaseSelection = {
      ...selection,
      metricDefinitions: selection.metricDefinitions.filter(({ metric }) => metric === 'goals'),
    };
    const service = createAflDraftTradeOutcomeReadService({
      releaseSelector: {
        async capture() {
          return {
            registryRevision: goalsOnlySelection.registryRevision,
            selection: goalsOnlySelection,
          };
        },
      },
      repository: {
        async list() {
          return projection();
        },
      },
    });

    await expect(service.list(request)).rejects.toMatchObject({
      code: 'PROJECTION_MISMATCH',
    } satisfies Partial<AflDraftTradeOutcomeReadError>);
  });

  it('fails closed when projection metadata names a different release', async () => {
    const service = createAflDraftTradeOutcomeReadService({
      releaseSelector: {
        async capture() {
          return { registryRevision: selection.registryRevision, selection };
        },
      },
      repository: {
        async list() {
          return projection({
            metadata: {
              scopeKey: selection.scopeKey,
              release: { ...release, projectionId: `outcome-projection:${hash('9')}` },
              freshness: 'current',
              warnings: [],
            },
          });
        },
      },
    });

    await expect(service.list(request)).rejects.toMatchObject({
      code: 'PROJECTION_MISMATCH',
    } satisfies Partial<AflDraftTradeOutcomeReadError>);
  });
});
