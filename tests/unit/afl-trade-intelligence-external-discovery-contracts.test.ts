import { describe, expect, it } from 'vitest';

import {
  createAflTradeExternalDiscoveryInventory,
  createAflTradeExternalHistoricalCapturePlan,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';

const instant = '2026-08-10T00:00:00.000Z';
const sha = (character: string) => character.repeat(64);

function inventory() {
  return createAflTradeExternalDiscoveryInventory({
    schemaVersion: 'afl-trade-external-discovery-inventory/v1',
    environment: 'test_fixture',
    provider: 'draftguru',
    competition: 'AFLM',
    sourceCaptureId: `source-capture:${sha('a')}`,
    sourceEvidenceBatchId: `external-evidence-batch:${sha('b')}`,
    sourceContentSha256: sha('c'),
    sourceUrl: 'https://www.draftguru.com.au/trades',
    fromYear: 2024,
    throughYear: 2025,
    links: [
      {
        ordinal: 1,
        evidenceId: `external-evidence:${sha('1')}`,
        anchorSeasonYear: 2024,
        nativeEventId: '2024-alpha-trade',
        sourceUrl: 'https://www.draftguru.com.au/trades/2024-alpha-trade',
      },
      {
        ordinal: 2,
        evidenceId: `external-evidence:${sha('2')}`,
        anchorSeasonYear: 2025,
        nativeEventId: '2025-beta-trade',
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-beta-trade',
      },
    ],
    discoveredAt: instant,
    completeForCapturedIndex: true,
    publicationEligible: false,
  });
}

describe('AFL external trade discovery contracts', () => {
  it('content-addresses a canonical, bounded Draftguru trade inventory', () => {
    const result = inventory();

    expect(result.inventoryId).toMatch(/^external-trade-discovery:[a-f0-9]{64}$/);
    expect(result.content.links).toHaveLength(2);
    expect(result.content.publicationEligible).toBe(false);
  });

  it('rejects duplicate, out-of-order, and year-mismatched discovered links', () => {
    const base = inventory().content;

    expect(() =>
      createAflTradeExternalDiscoveryInventory({
        ...base,
        links: [base.links[1], base.links[0]],
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalDiscoveryInventory({
        ...base,
        links: [base.links[0], { ...base.links[0], ordinal: 2 }],
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalDiscoveryInventory({
        ...base,
        links: [
          base.links[0],
          {
            ...base.links[1],
            sourceUrl: 'https://www.draftguru.com.au/trades/2024-beta-trade',
          },
        ],
      })
    ).toThrow();
  });

  it('derives an exact historical plan with one year page and every discovered trade detail', () => {
    const source = inventory();
    const plan = createAflTradeExternalHistoricalCapturePlan({
      inventory: source,
      plannedAt: '2026-08-10T00:01:00.000Z',
      parserVersions: {
        tradeDetail: 'draftguru-trade-detail/v1',
        yearPage: 'draftguru-year-page/v1',
      },
      datasetVersions: {
        tradeDetail: 'draftguru-2026-08-10',
        yearPage: 'draftguru-2026-08-10',
      },
      fieldManifestSha256: {
        tradeDetail: sha('d'),
        yearPage: sha('e'),
      },
      authorities: {
        tradeDetail: {
          rightsArtifactId: `source-rights:${sha('f')}`,
          fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
          cacheSeconds: 86_400,
          rawRetentionDays: 365,
        },
        yearPage: {
          rightsArtifactId: `source-rights:${sha('a')}`,
          fieldUses: [{ sourceField: 'selection_number', use: 'archive_fact' }],
          cacheSeconds: 86_400,
          rawRetentionDays: 365,
        },
      },
      execution: {
        maximumAttempts: 5,
        leaseSeconds: 300,
        retryBaseSeconds: 30,
        retryMaximumSeconds: 3_600,
        maximumLatenessSeconds: 2_592_000,
        circuitFailureThreshold: 5,
        circuitResetSeconds: 900,
      },
      maximumBytes: 2_000_000,
    });

    expect(plan.planId).toMatch(/^external-historical-capture-plan:[a-f0-9]{64}$/);
    expect(plan.content.targets).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          schedule: expect.objectContaining({
            definition: expect.objectContaining({
              requestTemplate: expect.objectContaining({
                capabilityId: 'draftguru-trade-detail',
                anchorSeasonYear: 2024,
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        content: expect.objectContaining({
          schedule: expect.objectContaining({
            definition: expect.objectContaining({
              requestTemplate: expect.objectContaining({
                capabilityId: 'draftguru-year-page',
                anchorSeasonYear: 2024,
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        content: expect.objectContaining({
          schedule: expect.objectContaining({
            definition: expect.objectContaining({
              requestTemplate: expect.objectContaining({
                capabilityId: 'draftguru-trade-detail',
                anchorSeasonYear: 2025,
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        content: expect.objectContaining({
          schedule: expect.objectContaining({
            definition: expect.objectContaining({
              requestTemplate: expect.objectContaining({
                capabilityId: 'draftguru-year-page',
                anchorSeasonYear: 2025,
              }),
            }),
          }),
        }),
      }),
    ]);
    expect(plan.content.targetCount).toBe(4);
    expect(plan.content.publicationEligible).toBe(false);
  });

  it('refuses an incomplete discovery inventory as a historical capture authority', () => {
    const source = inventory();

    expect(() =>
      createAflTradeExternalHistoricalCapturePlan({
        inventory: {
          ...source,
          content: { ...source.content, completeForCapturedIndex: false },
        },
        plannedAt: '2026-08-10T00:01:00.000Z',
        parserVersions: { tradeDetail: 'detail/v1', yearPage: 'year/v1' },
        datasetVersions: { tradeDetail: 'detail-v1', yearPage: 'year-v1' },
        fieldManifestSha256: { tradeDetail: sha('d'), yearPage: sha('e') },
        authorities: {
          tradeDetail: {
            rightsArtifactId: `source-rights:${sha('f')}`,
            fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
            cacheSeconds: 86_400,
            rawRetentionDays: 365,
          },
          yearPage: {
            rightsArtifactId: `source-rights:${sha('a')}`,
            fieldUses: [{ sourceField: 'selection_number', use: 'archive_fact' }],
            cacheSeconds: 86_400,
            rawRetentionDays: 365,
          },
        },
        execution: {
          maximumAttempts: 5,
          leaseSeconds: 300,
          retryBaseSeconds: 30,
          retryMaximumSeconds: 3_600,
          maximumLatenessSeconds: 2_592_000,
          circuitFailureThreshold: 5,
          circuitResetSeconds: 900,
        },
        maximumBytes: 2_000_000,
      })
    ).toThrow();
  });
});
