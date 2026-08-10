import { describe, expect, it } from 'vitest';

import {
  createAflDraftHistoryReadService,
  type AflDraftHistoryRepository,
} from '@/server/aflTradeIntelligence/outcomes/draftHistoryReadService';
import {
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import type { AflTradePromotionBackedArchiveSelection } from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';

const hash = (value: string) => value.repeat(64);

const archiveSelection: AflTradePromotionBackedArchiveSelection = {
  schemaVersion: 'afl-trade-promotion-backed-archive-selection/v1',
  registryRevision: 7,
  scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  environment: 'test_fixture',
  competition: 'AFLM',
  validFromSeason: 2025,
  validThroughSeason: 2025,
  releaseId: `outcome-release:${hash('a')}`,
  projectionId: `outcome-projection:${hash('b')}`,
  publicArchiveId: `public-factual-archive:${hash('c')}`,
  factualCandidateId: `factual-release-candidate:${hash('d')}`,
  corpusId: `corpus:${hash('e')}`,
  lineageId: `corpus-factual-lineage:${hash('f')}`,
  gate2AdmissionId: `corpus-factual-lineage-admission:${hash('1')}`,
  gate2DecisionId: `gate-decision:${hash('2')}`,
  sourceMemberSetSha256: hash('3'),
  canonicalMemberSetSha256: hash('4'),
  publicRecordSetSha256: hash('5'),
  publicRecordCount: 2,
  effectiveThrough: '2025-11-30T00:00:00.000Z',
  publishedAt: '2025-12-01T00:00:00.000Z',
  capturedAt: '2025-12-02T00:00:00.000Z',
};

const repository: AflDraftHistoryRepository = {
  async listYears() {
    return [
      {
        year: 2025,
        selectionCount: 2,
        draftEventCount: 1,
        draftKinds: ['national_draft'],
      },
    ];
  },
  async readYear() {
    return [
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
        originalClub: {
          aflClubId: 'club:gws',
          name: 'GWS',
          abbreviation: 'GWS',
        },
        player: {
          aflPlayerId: 'player:harry-kyle',
          displayName: 'Harry Kyle',
          identityStatus: 'resolved',
        },
        lineage: {
          status: 'linked_to_trade',
          edgeCount: 0,
          tradeRefs: [
            {
              tradeId: 'event:2025-gws-western-bulldogs-trade',
              year: 2025,
              title: '2025 Draft Pick Exchange: GWS and Western Bulldogs',
            },
          ],
        },
      },
      {
        selectionId: 'selection:2025-national-19',
        eventId: 'event:2025-national-draft',
        eventVersionId: 'event-version:2025-national-draft-v1',
        year: 2025,
        draftKind: 'national_draft',
        draftName: '2025 AFL National Draft',
        draftDate: '2025-11-19',
        selectionNumber: 19,
        round: 1,
        pickId: 'pick:2025-national-19',
        club: {
          aflClubId: 'club:gws',
          name: 'GWS',
          abbreviation: 'GWS',
        },
        originalClub: {
          aflClubId: 'club:gws',
          name: 'GWS',
          abbreviation: 'GWS',
        },
        player: {
          aflPlayerId: 'player:josh-lindsay',
          displayName: 'Josh Lindsay',
          identityStatus: 'resolved',
        },
        lineage: {
          status: 'selection_only',
          edgeCount: 0,
          tradeRefs: [],
        },
      },
    ];
  },
};

describe('AFL draft history read service', () => {
  it('serves multiple selections from one released draft event with exact pick context', async () => {
    const service = createAflDraftHistoryReadService({
      now: () => '2025-12-02T00:00:00.000Z',
      archiveSelector: {
        async capture() {
          return {
            registryRevision: archiveSelection.registryRevision,
            selection: archiveSelection,
            unavailabilityReason: null,
          };
        },
      },
      repository,
    });

    const response = await service.readYear({
      year: 2025,
      q: '',
      club: '',
      draftKind: null,
    });

    expect(response.consistency.selection).toBe('active');
    expect(response.consistency.release).toEqual({
      releaseId: archiveSelection.releaseId,
      projectionId: archiveSelection.projectionId,
      archiveDatasetId: archiveSelection.corpusId,
      metricRegistryVersion: 'promotion-backed-public-archive-v1',
      effectiveThrough: archiveSelection.effectiveThrough,
      publishedAt: archiveSelection.publishedAt,
    });
    expect(response.year).toMatchObject({ year: 2025, totalSelections: 2, filteredSelections: 2 });
    expect(response.selections.map(({ player }) => player.displayName)).toEqual([
      'Harry Kyle',
      'Josh Lindsay',
    ]);
    expect(response.selections[0]).toMatchObject({
      selectionNumber: 14,
      originalClub: { name: 'GWS' },
      lineage: { status: 'linked_to_trade' },
    });
  });

  it('does not query draft rows when no factual release is active', async () => {
    let repositoryCalls = 0;
    const service = createAflDraftHistoryReadService({
      now: () => '2025-12-02T00:00:00.000Z',
      archiveSelector: {
        async capture() {
          return {
            registryRevision: 8,
            selection: null,
            unavailabilityReason: 'no_active_release' as const,
          };
        },
      },
      repository: {
        async listYears() {
          repositoryCalls += 1;
          return [];
        },
        async readYear() {
          repositoryCalls += 1;
          return [];
        },
      },
    });

    const [index, year] = await Promise.all([
      service.listYears(),
      service.readYear({ year: 2025, q: '', club: '', draftKind: null }),
    ]);

    expect(repositoryCalls).toBe(0);
    expect(index).toMatchObject({ consistency: { selection: 'none' }, years: [] });
    expect(year).toMatchObject({
      consistency: { selection: 'none' },
      year: { year: 2025, totalSelections: 0, filteredSelections: 0 },
      selections: [],
    });
  });

  it('filters one released row without changing the unfiltered year and filter counts', async () => {
    const service = createAflDraftHistoryReadService({
      now: () => '2025-12-02T00:00:00.000Z',
      archiveSelector: {
        async capture() {
          return {
            registryRevision: archiveSelection.registryRevision,
            selection: archiveSelection,
            unavailabilityReason: null,
          };
        },
      },
      repository,
    });

    const response = await service.readYear({
      year: 2025,
      q: 'lindsay',
      club: 'GWS',
      draftKind: 'national_draft',
    });

    expect(response.year).toEqual({ year: 2025, totalSelections: 2, filteredSelections: 1 });
    expect(response.availableFilters.clubs.map(({ name }) => name)).toEqual([
      'GWS',
      'Western Bulldogs',
    ]);
    expect(response.selections.map(({ selectionNumber }) => selectionNumber)).toEqual([19]);
  });

  it('fails closed when repository rows claim inconsistent player identity or lineage', async () => {
    const service = createAflDraftHistoryReadService({
      now: () => '2025-12-02T00:00:00.000Z',
      archiveSelector: {
        async capture() {
          return {
            registryRevision: archiveSelection.registryRevision,
            selection: archiveSelection,
            unavailabilityReason: null,
          };
        },
      },
      repository: {
        ...repository,
        async readYear(selection, year) {
          const rows = await repository.readYear(selection, year);
          return [
            {
              ...rows[0]!,
              player: {
                ...rows[0]!.player,
                aflPlayerId: null,
                identityStatus: 'resolved' as const,
              },
            },
          ];
        },
      },
    });

    await expect(
      service.readYear({ year: 2025, q: '', club: '', draftKind: null })
    ).rejects.toMatchObject({ code: 'INVALID_REPOSITORY_PAYLOAD' });
  });
});
