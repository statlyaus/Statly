import { describe, expect, it, vi } from 'vitest';

import {
  AflTradeMethodologyReadError,
  createAflTradeMethodologyReadService,
  type AflTradeMethodologyProjectionRepository,
} from '@/server/aflTradeIntelligence/publication/methodologyReadService';
import type { AflTradePublicationReadSelection } from '@/server/aflTradeIntelligence/publication/publicationState';
import type { AflTradeProjectionReadMetadata } from '@/server/aflTradeIntelligence/publication/valueReadService';
import type { AflTradePublishedMethodology } from '@/types/aflTradeIntelligence';

const digest = (character: string) => character.repeat(64);
const servedAt = '2026-08-05T04:00:00.000Z';

function selection(
  supportedViews: AflTradePublicationReadSelection['supportedViews'] = [
    'at_trade',
    'realized',
    'remaining',
    'current',
  ]
): AflTradePublicationReadSelection {
  return {
    publication: {
      publicationId: `publication:${digest('a')}`,
      state: 'published',
      valuationBundleId: `valuation-bundle:${digest('b')}`,
      valueUnitId: 'fixture-value-unit',
      publishedAt: '2026-08-05T02:00:00.000Z',
    },
    projectionBuildId: `projection:${digest('c')}`,
    registryRevision: 7,
    scopeKey: 'public-afl-trades-current',
    supportedViews,
    supportedCohorts: ['Fabricated supported AFL trades'],
    excludedCohorts: ['Fabricated unresolved AFL trades'],
  };
}

function metadata(active: AflTradePublicationReadSelection = selection()): AflTradeProjectionReadMetadata {
  return {
    publicationId: active.publication.publicationId,
    projectionBuildId: active.projectionBuildId,
    scopeKey: active.scopeKey,
    calculationAsOf: '2026-08-05T03:00:00.000Z',
    knowledgeCutoffAt: '2026-08-05T01:00:00.000Z',
    freshness: 'current',
    warnings: [],
  };
}

function methodology(active: AflTradePublicationReadSelection = selection()): AflTradePublishedMethodology {
  return {
    valuationBundleId: active.publication.valuationBundleId,
    modelVersion: 'fixture-model-2026.1',
    components: [
      {
        role: 'player_contribution_and_availability',
        modelVersion: 'fixture-player-1.0.0',
        summary: 'Fabricated player contribution and availability component.',
      },
      {
        role: 'draft_pick_and_future_pick_distribution',
        modelVersion: 'fixture-pick-1.0.0',
        summary: 'Fabricated pick and future-pick distribution component.',
      },
    ],
    valueUnit: {
      id: active.publication.valueUnitId,
      label: 'Fixture value',
      description: 'A fabricated unit used only for read-service tests.',
      direction: 'higher_is_better',
    },
    primaryOutcome: {
      code: 'fixture-club-contribution',
      label: 'Fabricated club contribution',
      definition: 'Fabricated definition used only for read-service tests.',
    },
    trainingPeriod: { firstSeason: 2001, lastSeason: 2024 },
    calculationAsOf: metadata(active).calculationAsOf,
    supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
    supportedDataCoverage: ['Fabricated supported AFL trades'],
    knownLimitations: ['Fabricated limitation used only for read-service tests.'],
    materialChangesFromPrevious: [],
  };
}

function repository(
  active: AflTradePublicationReadSelection = selection()
): AflTradeMethodologyProjectionRepository {
  return {
    read: vi.fn(async () => ({
      metadata: metadata(active),
      methodologyHref: '/draft/trades/methodology/publication-fixture',
      methodology: methodology(active),
    })),
  };
}

function service(
  active: AflTradePublicationReadSelection | null,
  projectionRepository = repository(active ?? selection()),
  registryRevision = active?.registryRevision ?? 3
) {
  const publicationSelector = {
    capture: vi.fn(async () => ({ selection: active, registryRevision })),
  };
  return {
    publicationSelector,
    projectionRepository,
    value: createAflTradeMethodologyReadService({
      publicationSelector,
      projectionRepository,
      now: () => new Date(servedAt),
    }),
  };
}

const request = { scopeKey: 'public-afl-trades-current' };

describe('AFL trade methodology read service', () => {
  it('returns source-blocked metadata without touching projections when no publication is active', async () => {
    const fixture = service(null);

    await expect(fixture.value.read(request)).resolves.toMatchObject({
      availability: 'unavailable',
      methodology: null,
      consistency: { selection: 'none', registryRevision: 3, publication: null },
    });
    expect(fixture.projectionRepository.read).not.toHaveBeenCalled();
  });

  it('returns metadata bound to one captured active publication', async () => {
    const active = selection();
    const fixture = service(active);

    await expect(fixture.value.read(request)).resolves.toMatchObject({
      availability: 'published',
      consistency: {
        publication: active.publication,
        projectionBuildId: active.projectionBuildId,
        registryRevision: active.registryRevision,
      },
      methodology: {
        valuationBundleId: active.publication.valuationBundleId,
        valueUnit: { id: active.publication.valueUnitId },
      },
    });
    expect(fixture.publicationSelector.capture).toHaveBeenCalledWith(request.scopeKey);
    expect(fixture.projectionRepository.read).toHaveBeenCalledWith(active);
  });

  it('rejects invalid requests and incomplete public-view selections before projection access', async () => {
    const invalid = service(selection());
    await expect(invalid.value.read({ scopeKey: 'not valid' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(invalid.projectionRepository.read).not.toHaveBeenCalled();

    const unsupported = service(selection(['current']));
    await expect(unsupported.value.read(request)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PUBLICATION',
    });
    expect(unsupported.projectionRepository.read).not.toHaveBeenCalled();
  });

  it('rejects a selection captured at a different registry revision', async () => {
    const active = selection();
    await expect(service(active, repository(active), active.registryRevision + 1).value.read(request))
      .rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('maps repository failures without disguising them as source blockers', async () => {
    const projectionRepository: AflTradeMethodologyProjectionRepository = {
      read: vi.fn(async () => {
        throw new Error('fabricated read failure');
      }),
    };

    await expect(service(selection(), projectionRepository).value.read(request)).rejects.toMatchObject(
      { code: 'PROJECTION_READ_FAILED' }
    );
  });

  it('rejects projection identity drift', async () => {
    const active = selection();
    const projectionRepository = repository(active);
    vi.mocked(projectionRepository.read).mockResolvedValueOnce({
      metadata: { ...metadata(active), projectionBuildId: `projection:${digest('d')}` },
      methodologyHref: '/draft/trades/methodology/publication-fixture',
      methodology: methodology(active),
    });

    await expect(service(active, projectionRepository).value.read(request)).rejects.toMatchObject({
      code: 'PROJECTION_MISMATCH',
    });
  });

  it('rejects invalid publication-bound metadata', async () => {
    const active = selection();
    const projectionRepository = repository(active);
    vi.mocked(projectionRepository.read).mockResolvedValueOnce({
      metadata: metadata(active),
      methodologyHref: '/draft/trades/methodology/publication-fixture',
      methodology: { ...methodology(active), calculationAsOf: '2026-08-05T03:30:00.000Z' },
    });

    await expect(service(active, projectionRepository).value.read(request)).rejects.toMatchObject({
      name: AflTradeMethodologyReadError.name,
      code: 'INVALID_PROJECTION_PAYLOAD',
    });
  });
});
