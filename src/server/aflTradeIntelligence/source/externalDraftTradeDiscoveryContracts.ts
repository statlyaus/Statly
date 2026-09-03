import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  aflTradeExternalCaptureScheduleSchema,
  createAflTradeExternalCaptureSchedule,
} from './externalDraftTradeScheduling';

export const AFL_TRADE_EXTERNAL_DISCOVERY_INVENTORY_SCHEMA_VERSION =
  'afl-trade-external-discovery-inventory/v1' as const;
export const AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_PLAN_SCHEMA_VERSION =
  'afl-trade-external-historical-capture-plan/v1' as const;

const instantSchema = z.iso.datetime({ offset: true });
const sha256Schema = aflTradeSha256Schema;
const yearSchema = z.number().int().min(1988).max(2200);
const boundedTextSchema = z.string().trim().min(1).max(240);

const draftguruTradeUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (
      url.origin !== 'https://www.draftguru.com.au' ||
      !/^\/trades\/\d{4}-[a-z0-9][a-z0-9_'%-]*$/.test(url.pathname) ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A discovered trade URL must identify one exact Draftguru trade detail page.',
      });
    }
  });

const discoveryLinkSchema = z
  .object({
    ordinal: z.number().int().positive().max(100_000),
    evidenceId: aflTradeContentAddressedIdSchema('external-evidence'),
    anchorSeasonYear: yearSchema,
    nativeEventId: boundedTextSchema,
    sourceUrl: draftguruTradeUrlSchema,
  })
  .strict()
  .superRefine((link, context) => {
    const url = new URL(link.sourceUrl);
    const nativeEventId = url.pathname.slice('/trades/'.length);
    if (
      nativeEventId !== link.nativeEventId ||
      !nativeEventId.startsWith(`${link.anchorSeasonYear}-`)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Discovered URL, native event identity, and anchor season must agree exactly.',
      });
    }
  });

const inventoryContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_DISCOVERY_INVENTORY_SCHEMA_VERSION),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: z.literal('draftguru'),
    competition: z.literal('AFLM'),
    sourceCaptureId: aflTradeContentAddressedIdSchema('source-capture'),
    sourceEvidenceBatchId: aflTradeContentAddressedIdSchema('external-evidence-batch'),
    sourceContentSha256: sha256Schema,
    sourceUrl: z.enum([
      'https://www.draftguru.com.au/trades',
      'https://www.draftguru.com.au/trades/',
    ]),
    fromYear: yearSchema,
    throughYear: yearSchema,
    links: z.array(discoveryLinkSchema).min(1).max(100_000),
    discoveredAt: instantSchema,
    completeForCapturedIndex: z.boolean(),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((inventory, context) => {
    if (inventory.fromYear > inventory.throughYear) {
      context.addIssue({
        code: 'custom',
        path: ['fromYear'],
        message: 'Discovery range cannot start after it ends.',
      });
    }
    if (inventory.throughYear - inventory.fromYear > 100) {
      context.addIssue({
        code: 'custom',
        path: ['throughYear'],
        message: 'One discovery inventory may cover at most 101 seasons.',
      });
    }
    const evidenceIds = new Set<string>();
    const nativeIds = new Set<string>();
    const sourceUrls = new Set<string>();
    let priorKey = '';
    inventory.links.forEach((link, index) => {
      if (link.ordinal !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['links', index, 'ordinal'],
          message: 'Discovery ordinals must be contiguous and one-based.',
        });
      }
      if (
        link.anchorSeasonYear < inventory.fromYear ||
        link.anchorSeasonYear > inventory.throughYear
      ) {
        context.addIssue({
          code: 'custom',
          path: ['links', index, 'anchorSeasonYear'],
          message: 'Every discovered trade must fall inside the reviewed year range.',
        });
      }
      const key = `${link.anchorSeasonYear.toString().padStart(4, '0')}\0${link.sourceUrl}`;
      if (key <= priorKey) {
        context.addIssue({
          code: 'custom',
          path: ['links', index],
          message: 'Discovery links must be strictly ordered by season and URL.',
        });
      }
      priorKey = key;
      if (
        evidenceIds.has(link.evidenceId) ||
        nativeIds.has(link.nativeEventId) ||
        sourceUrls.has(link.sourceUrl)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['links', index],
          message: 'Discovery evidence, event identities, and URLs must be unique.',
        });
      }
      evidenceIds.add(link.evidenceId);
      nativeIds.add(link.nativeEventId);
      sourceUrls.add(link.sourceUrl);
    });
  });

export const aflTradeExternalDiscoveryInventorySchema = z
  .object({
    inventoryId: aflTradeContentAddressedIdSchema('external-trade-discovery'),
    content: inventoryContentSchema,
  })
  .strict()
  .superRefine((inventory, context) => {
    addAflTradeContentAddressIssue(
      'external-trade-discovery',
      inventory.inventoryId,
      inventory.content,
      context,
      ['inventoryId']
    );
  });

const captureTargetContentSchema = z
  .object({
    ordinal: z.number().int().positive().max(200_000),
    discoveryEvidenceId: aflTradeContentAddressedIdSchema('external-evidence').nullable(),
    schedule: aflTradeExternalCaptureScheduleSchema,
  })
  .strict();

const captureTargetSchema = z
  .object({
    targetId: aflTradeContentAddressedIdSchema('external-capture-target'),
    content: captureTargetContentSchema,
  })
  .strict()
  .superRefine((target, context) => {
    addAflTradeContentAddressIssue(
      'external-capture-target',
      target.targetId,
      target.content,
      context,
      ['targetId']
    );
    const request = target.content.schedule.definition.requestTemplate;
    const expectedUrl =
      request.capabilityId === 'draftguru-year-page'
        ? `https://www.draftguru.com.au/years/${request.anchorSeasonYear}`
        : request.sourceUrl;
    const discoveredTradeDetail = [
      'draftguru-trade-detail',
      'draftguru-player-trade-detail',
    ].includes(request.capabilityId);
    if (
      request.sourceUrl !== expectedUrl ||
      (!discoveredTradeDetail && request.capabilityId !== 'draftguru-year-page') ||
      discoveredTradeDetail !== (target.content.discoveryEvidenceId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Capture target URL and discovery evidence must match its capability.',
      });
    }
  });

const historicalPlanContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_PLAN_SCHEMA_VERSION),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    inventoryId: aflTradeContentAddressedIdSchema('external-trade-discovery'),
    inventorySha256: sha256Schema,
    fromYear: yearSchema,
    throughYear: yearSchema,
    plannedAt: instantSchema,
    execution: z
      .object({
        maximumAttempts: z.number().int().min(1).max(20),
        leaseSeconds: z.number().int().positive().max(86_400),
        retryBaseSeconds: z.number().int().positive().max(86_400),
        retryMaximumSeconds: z.number().int().positive().max(604_800),
        maximumLatenessSeconds: z.number().int().nonnegative().max(2_592_000),
        circuitFailureThreshold: z.number().int().positive().max(100),
        circuitResetSeconds: z.number().int().positive().max(604_800),
      })
      .strict(),
    targets: z.array(captureTargetSchema).min(1).max(200_000),
    targetCount: z.number().int().positive(),
    targetSetSha256: sha256Schema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.targetCount !== plan.targets.length) {
      context.addIssue({
        code: 'custom',
        path: ['targetCount'],
        message: 'Target count mismatch.',
      });
    }
    if (
      plan.targetSetSha256 !==
      sha256AflTradeCanonicalJson(plan.targets.map(({ targetId }) => targetId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetSetSha256'],
        message: 'Target-set digest mismatch.',
      });
    }
    plan.targets.forEach((target, index) => {
      if (target.content.ordinal !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['targets', index, 'content', 'ordinal'],
          message: 'Capture targets must have contiguous one-based ordinals.',
        });
      }
    });
  });

export const aflTradeExternalHistoricalCapturePlanSchema = z
  .object({
    planId: aflTradeContentAddressedIdSchema('external-historical-capture-plan'),
    content: historicalPlanContentSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    addAflTradeContentAddressIssue(
      'external-historical-capture-plan',
      plan.planId,
      plan.content,
      context,
      ['planId']
    );
  });

export type AflTradeExternalDiscoveryInventory = z.infer<
  typeof aflTradeExternalDiscoveryInventorySchema
>;
export type AflTradeExternalHistoricalCapturePlan = z.infer<
  typeof aflTradeExternalHistoricalCapturePlanSchema
>;

export function createAflTradeExternalDiscoveryInventory(
  content: z.input<typeof inventoryContentSchema>
): AflTradeExternalDiscoveryInventory {
  const parsed = inventoryContentSchema.parse(content);
  return aflTradeExternalDiscoveryInventorySchema.parse({
    inventoryId: createAflTradeContentAddress('external-trade-discovery', parsed),
    content: parsed,
  });
}

export function createAflTradeExternalHistoricalCapturePlan(input: {
  inventory: AflTradeExternalDiscoveryInventory;
  plannedAt: string;
  parserVersions: { tradeDetail: string; yearPage: string };
  datasetVersions: { tradeDetail: string; yearPage: string };
  fieldManifestSha256: { tradeDetail: string; yearPage: string };
  authorities: {
    tradeDetail: {
      rightsArtifactId: string;
      fieldUses: readonly { sourceField: string; use: 'archive_fact' }[];
      cacheSeconds: number;
      rawRetentionDays: number;
    };
    yearPage: {
      rightsArtifactId: string;
      fieldUses: readonly { sourceField: string; use: 'archive_fact' }[];
      cacheSeconds: number;
      rawRetentionDays: number;
    };
  };
  execution: {
    maximumAttempts: number;
    leaseSeconds: number;
    retryBaseSeconds: number;
    retryMaximumSeconds: number;
    maximumLatenessSeconds: number;
    circuitFailureThreshold: number;
    circuitResetSeconds: number;
  };
  maximumBytes: number;
}): AflTradeExternalHistoricalCapturePlan {
  const inventory = aflTradeExternalDiscoveryInventorySchema.parse(input.inventory);
  if (!inventory.content.completeForCapturedIndex) {
    throw new TypeError('An incomplete discovery inventory cannot authorize a historical plan.');
  }
  const scheduleFor = (target: {
    capabilityId: 'draftguru-trade-detail' | 'draftguru-year-page';
    anchorSeasonYear: number;
    sourceUrl: string;
    dataset: string;
    datasetVersion: string;
    parserVersion: string;
    fieldManifestSha256: string;
    authority: (typeof input.authorities)['tradeDetail'];
  }) =>
    createAflTradeExternalCaptureSchedule({
      schemaVersion: 'afl-trade-external-capture-schedule-definition/v1',
      requestTemplate: {
        environment: inventory.content.environment,
        provider: 'draftguru',
        competition: 'AFLM',
        anchorSeasonYear: target.anchorSeasonYear,
        discoveryFromSeasonYear: null,
        draftPathway: null,
        dataset: target.dataset,
        datasetVersion: target.datasetVersion,
        accessMechanism: 'automated_web',
        capabilityId: target.capabilityId,
        sourceUrl: target.sourceUrl,
        effectiveAt: input.plannedAt,
        parserVersion: target.parserVersion,
        fieldManifestSha256: target.fieldManifestSha256,
        maximumBytes: input.maximumBytes,
      },
      gateRequestTemplate: {
        decisionKey: `${target.capabilityId}-${inventory.content.environment}`,
        environment: inventory.content.environment,
        rightsArtifactId: target.authority.rightsArtifactId,
        competition: 'AFLM',
        season: target.anchorSeasonYear,
        accessMechanism: 'automated_web',
        capabilityId: null,
        geography: 'global',
        commercialContext: 'public-research',
        audience: 'public',
        operations: ['bounded_evaluation_capture', 'raw_evidence_retention'],
        fieldUses: [...target.authority.fieldUses],
        rawRetentionDays: target.authority.rawRetentionDays,
        metadataRetentionDays: null,
        cacheSeconds: target.authority.cacheSeconds,
      },
      cadence: {
        anchorAt: input.plannedAt,
        intervalSeconds: 31_536_000,
        maximumLatenessSeconds: input.execution.maximumLatenessSeconds,
      },
      execution: {
        maximumAttempts: input.execution.maximumAttempts,
        leaseSeconds: input.execution.leaseSeconds,
        retryBaseSeconds: input.execution.retryBaseSeconds,
        retryMaximumSeconds: input.execution.retryMaximumSeconds,
        circuitFailureThreshold: input.execution.circuitFailureThreshold,
        circuitResetSeconds: input.execution.circuitResetSeconds,
      },
      concurrencyPolicy: 'forbid_overlap',
      publicationEligible: false,
    });
  const targetsWithoutOrdinals: Array<{
    discoveryEvidenceId: string | null;
    schedule: ReturnType<typeof createAflTradeExternalCaptureSchedule>;
  }> = [];
  for (
    let seasonYear = inventory.content.fromYear;
    seasonYear <= inventory.content.throughYear;
    seasonYear += 1
  ) {
    for (const link of inventory.content.links.filter(
      ({ anchorSeasonYear }) => anchorSeasonYear === seasonYear
    )) {
      targetsWithoutOrdinals.push({
        discoveryEvidenceId: link.evidenceId,
        schedule: scheduleFor({
          capabilityId: 'draftguru-trade-detail',
          anchorSeasonYear: link.anchorSeasonYear,
          sourceUrl: link.sourceUrl,
          dataset: 'Draftguru AFL trade transaction detail',
          datasetVersion: input.datasetVersions.tradeDetail,
          parserVersion: input.parserVersions.tradeDetail,
          fieldManifestSha256: input.fieldManifestSha256.tradeDetail,
          authority: input.authorities.tradeDetail,
        }),
      });
    }
    targetsWithoutOrdinals.push({
      discoveryEvidenceId: null,
      schedule: scheduleFor({
        capabilityId: 'draftguru-year-page',
        anchorSeasonYear: seasonYear,
        sourceUrl: `https://www.draftguru.com.au/years/${seasonYear}`,
        dataset: 'Draftguru AFL draft selection list',
        datasetVersion: input.datasetVersions.yearPage,
        parserVersion: input.parserVersions.yearPage,
        fieldManifestSha256: input.fieldManifestSha256.yearPage,
        authority: input.authorities.yearPage,
      }),
    });
  }
  const targets = targetsWithoutOrdinals.map((content, index) => {
    const parsedContent = captureTargetContentSchema.parse({ ...content, ordinal: index + 1 });
    return captureTargetSchema.parse({
      targetId: createAflTradeContentAddress('external-capture-target', parsedContent),
      content: parsedContent,
    });
  });
  const content = historicalPlanContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_PLAN_SCHEMA_VERSION,
    environment: inventory.content.environment,
    competition: inventory.content.competition,
    inventoryId: inventory.inventoryId,
    inventorySha256: sha256AflTradeCanonicalJson(inventory.content),
    fromYear: inventory.content.fromYear,
    throughYear: inventory.content.throughYear,
    plannedAt: input.plannedAt,
    execution: input.execution,
    targets,
    targetCount: targets.length,
    targetSetSha256: sha256AflTradeCanonicalJson(targets.map(({ targetId }) => targetId)),
    publicationEligible: false,
  });
  return aflTradeExternalHistoricalCapturePlanSchema.parse({
    planId: createAflTradeContentAddress('external-historical-capture-plan', content),
    content,
  });
}
