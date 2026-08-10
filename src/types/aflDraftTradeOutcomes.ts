import { z } from 'zod';

import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
  aflTradePublicMessageSchema,
  aflTradePublicWarningSchema,
} from './aflTradeIntelligence/shared';

export const AFL_DRAFT_TRADE_OUTCOME_CONTRACT_VERSION = 'afl-draft-trade-outcomes/v1' as const;
export const AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;

export const AFL_DRAFT_TRADE_OUTCOME_METRICS = [
  'games',
  'goals',
  'coaches_votes',
  'brownlow_votes',
] as const;

export const AFL_DRAFT_TRADE_OUTCOME_CHECK_STATUSES = [
  'matched',
  'different',
  'recorded_only',
  'source_only',
  'partial',
  'unavailable',
] as const;

export const aflDraftTradeOutcomeMetricSchema = z.enum(AFL_DRAFT_TRADE_OUTCOME_METRICS);
export const aflDraftTradeOutcomeCheckStatusSchema = z.enum(AFL_DRAFT_TRADE_OUTCOME_CHECK_STATUSES);
export const aflDraftTradeOutcomeSourceNativeIdSchema = aflTradePublicIdSchema.superRefine(
  (identifier, context) => {
    if (
      /^(?:user|fantasy|league|roster|membership|member|owner|firebase)(?:[._:-]|$)/i.test(
        identifier
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A public AFL outcome identifier cannot identify fantasy or user-owned state.',
      });
    }
  }
);

export const aflDraftTradeOutcomeMetricDefinitionSchema = z
  .object({
    metricDefinitionId: z.string().regex(/^metric-definition:[a-f0-9]{64}$/),
    metricRegistryVersion: aflDraftTradeOutcomeSourceNativeIdSchema,
    metric: aflDraftTradeOutcomeMetricSchema,
    label: z.string().trim().min(1).max(80),
    unit: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    comparisonBasis: z.string().trim().min(1).max(500),
  })
  .strict();

export const aflDraftTradeOutcomeSourceRefSchema = z
  .object({
    role: z.enum(['recorded', 'observed']),
    artifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/),
    locator: z.string().trim().min(1).max(500),
    rightsDecisionId: z.string().regex(/^gate-decision:[a-f0-9]{64}$/),
    metricDefinitionId: z.string().regex(/^metric-definition:[a-f0-9]{64}$/),
  })
  .strict();

const recordedOutcomeSourceRefSchema = aflDraftTradeOutcomeSourceRefSchema.extend({
  role: z.literal('recorded'),
});
const observedOutcomeSourceRefSchema = aflDraftTradeOutcomeSourceRefSchema.extend({
  role: z.literal('observed'),
});
const pairedOutcomeSourcesSchema = z
  .tuple([recordedOutcomeSourceRefSchema, observedOutcomeSourceRefSchema])
  .superRefine((sources, context) => {
    if (sources[0].metricDefinitionId !== sources[1].metricDefinitionId) {
      context.addIssue({
        code: 'custom',
        message: 'Recorded and observed evidence must use the same metric definition.',
      });
    }
  });
const partialOutcomeSourcesSchema = z
  .array(aflDraftTradeOutcomeSourceRefSchema)
  .min(1)
  .max(2)
  .superRefine((sources, context) => {
    if (new Set(sources.map(({ role }) => role)).size !== sources.length) {
      context.addIssue({
        code: 'custom',
        message: 'Partial evidence cannot repeat a source role.',
      });
    }
    if (new Set(sources.map(({ metricDefinitionId }) => metricDefinitionId)).size > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Partial evidence must use one metric definition.',
      });
    }
  });

const metricCheckBase = {
  metric: aflDraftTradeOutcomeMetricSchema,
  message: aflTradePublicMessageSchema,
};
const availableMetricCheckBase = {
  ...metricCheckBase,
  scopeLabel: z.string().trim().min(1).max(500),
  effectiveThrough: aflTradeIsoDateTimeSchema,
};

export const aflDraftTradeOutcomeMetricCheckSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        ...availableMetricCheckBase,
        status: z.literal('matched'),
        recordedValue: z.number().int().nonnegative(),
        observedValue: z.number().int().nonnegative(),
        delta: z.literal(0),
        coverageRatio: z.null(),
        sources: pairedOutcomeSourcesSchema,
      })
      .strict(),
    z
      .object({
        ...availableMetricCheckBase,
        status: z.literal('different'),
        recordedValue: z.number().int().nonnegative(),
        observedValue: z.number().int().nonnegative(),
        delta: z
          .number()
          .int()
          .refine((value) => value !== 0),
        coverageRatio: z.null(),
        sources: pairedOutcomeSourcesSchema,
      })
      .strict(),
    z
      .object({
        ...availableMetricCheckBase,
        status: z.literal('recorded_only'),
        recordedValue: z.number().int().nonnegative(),
        observedValue: z.null(),
        delta: z.null(),
        coverageRatio: z.null(),
        sources: z.tuple([recordedOutcomeSourceRefSchema]),
      })
      .strict(),
    z
      .object({
        ...availableMetricCheckBase,
        status: z.literal('source_only'),
        recordedValue: z.null(),
        observedValue: z.number().int().nonnegative(),
        delta: z.null(),
        coverageRatio: z.null(),
        sources: z.tuple([observedOutcomeSourceRefSchema]),
      })
      .strict(),
    z
      .object({
        ...availableMetricCheckBase,
        status: z.literal('partial'),
        recordedValue: z.number().int().nonnegative().nullable(),
        observedValue: z.number().int().nonnegative().nullable(),
        delta: z.null(),
        coverageRatio: z.number().gt(0).lt(1),
        sources: partialOutcomeSourcesSchema,
      })
      .strict(),
    z
      .object({
        ...metricCheckBase,
        status: z.literal('unavailable'),
        recordedValue: z.null(),
        observedValue: z.null(),
        delta: z.null(),
        coverageRatio: z.null(),
        scopeLabel: z.null(),
        effectiveThrough: z.null(),
        sources: z.tuple([]),
      })
      .strict(),
  ])
  .superRefine((check, context) => {
    if (check.status === 'partial') {
      const hasRecordedValue = check.recordedValue !== null;
      const hasObservedValue = check.observedValue !== null;
      const hasRecordedSource = check.sources.some(({ role }) => role === 'recorded');
      const hasObservedSource = check.sources.some(({ role }) => role === 'observed');

      if (!hasRecordedValue && !hasObservedValue) {
        context.addIssue({
          code: 'custom',
          path: ['recordedValue'],
          message: 'A partial check must contain at least one measured partial value.',
        });
      }
      if (hasRecordedValue !== hasRecordedSource) {
        context.addIssue({
          code: 'custom',
          path: ['sources'],
          message: 'A partial recorded value and its recorded evidence must appear together.',
        });
      }
      if (hasObservedValue !== hasObservedSource) {
        context.addIssue({
          code: 'custom',
          path: ['sources'],
          message: 'A partial observed value and its observed evidence must appear together.',
        });
      }
    }
    if (
      (check.status === 'matched' || check.status === 'different') &&
      check.delta !== check.observedValue - check.recordedValue
    ) {
      context.addIssue({
        code: 'custom',
        path: ['delta'],
        message: 'The metric delta must equal observed minus recorded.',
      });
    }
  });

export const aflDraftTradeOutcomeAchievementSourceRefSchema = z
  .object({
    role: z.enum(['recorded', 'observed']),
    artifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/),
    locator: z.string().trim().min(1).max(500),
    rightsDecisionId: z.string().regex(/^gate-decision:[a-f0-9]{64}$/),
    achievementDefinitionId: z.string().regex(/^achievement-definition:[a-f0-9]{64}$/),
  })
  .strict();

const recordedAchievementSourceRefSchema = aflDraftTradeOutcomeAchievementSourceRefSchema.extend({
  role: z.literal('recorded'),
});
const observedAchievementSourceRefSchema = aflDraftTradeOutcomeAchievementSourceRefSchema.extend({
  role: z.literal('observed'),
});
const pairedAchievementSourcesSchema = z
  .tuple([recordedAchievementSourceRefSchema, observedAchievementSourceRefSchema])
  .superRefine((sources, context) => {
    if (sources[0].achievementDefinitionId !== sources[1].achievementDefinitionId) {
      context.addIssue({
        code: 'custom',
        message: 'Recorded and observed awards must use the same achievement definition.',
      });
    }
  });
const unresolvedAchievementSourcesSchema = z
  .array(aflDraftTradeOutcomeAchievementSourceRefSchema)
  .min(1)
  .max(2)
  .superRefine((sources, context) => {
    if (new Set(sources.map(({ role }) => role)).size !== sources.length) {
      context.addIssue({ code: 'custom', message: 'Award evidence cannot repeat a source role.' });
    }
    if (new Set(sources.map(({ achievementDefinitionId }) => achievementDefinitionId)).size > 1) {
      context.addIssue({ code: 'custom', message: 'Award evidence must use one definition.' });
    }
  });
const achievementBase = {
  label: z.string().trim().min(1).max(160),
  season: z.number().int().min(1897).max(2200),
  aflClubId: aflDraftTradeOutcomeSourceNativeIdSchema.nullable(),
  scopeLabel: z.string().trim().min(1).max(500),
  effectiveThrough: aflTradeIsoDateTimeSchema,
};

export const aflDraftTradeOutcomeAchievementSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...achievementBase,
      status: z.literal('checked'),
      achievementId: aflDraftTradeOutcomeSourceNativeIdSchema,
      sources: pairedAchievementSourcesSchema,
    })
    .strict(),
  z
    .object({
      ...achievementBase,
      status: z.literal('recorded_only'),
      achievementId: aflDraftTradeOutcomeSourceNativeIdSchema,
      sources: z.tuple([recordedAchievementSourceRefSchema]),
    })
    .strict(),
  z
    .object({
      ...achievementBase,
      status: z.literal('unresolved'),
      achievementId: z.null(),
      reasonCode: z.enum([
        'award_identity_unresolved',
        'club_at_season_unresolved',
        'award_syntax_ambiguous',
      ]),
      sources: unresolvedAchievementSourcesSchema,
    })
    .strict(),
]);

export const aflDraftTradeOutcomeListItemSchema = z
  .object({
    eventId: aflDraftTradeOutcomeSourceNativeIdSchema,
    tradeId: aflDraftTradeOutcomeSourceNativeIdSchema.nullable(),
    assetId: aflDraftTradeOutcomeSourceNativeIdSchema.nullable(),
    year: z.number().int().min(1897).max(2200),
    acquisitionType: z.string().trim().min(1).max(120),
    aflClubId: aflDraftTradeOutcomeSourceNativeIdSchema,
    clubName: z.string().trim().min(1).max(160),
    player: z
      .object({
        aflPlayerId: aflDraftTradeOutcomeSourceNativeIdSchema.nullable(),
        displayName: z.string().trim().min(1).max(160),
        identityStatus: z.enum(['resolved', 'ambiguous', 'unresolved']),
      })
      .strict(),
    checks: z
      .array(aflDraftTradeOutcomeMetricCheckSchema)
      .max(AFL_DRAFT_TRADE_OUTCOME_METRICS.length),
    achievements: z.array(aflDraftTradeOutcomeAchievementSchema).max(100),
  })
  .strict()
  .superRefine((item, context) => {
    if ((item.player.identityStatus === 'resolved') !== (item.player.aflPlayerId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['player', 'aflPlayerId'],
        message: 'Only a resolved player identity may contain a canonical AFL player identifier.',
      });
    }
    const metricCount = new Set(item.checks.map(({ metric }) => metric)).size;
    if (metricCount !== item.checks.length) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'Outcome metric checks must be unique by metric.',
      });
    }
    if (item.player.identityStatus !== 'resolved') {
      if (item.checks.some(({ status }) => status !== 'unavailable')) {
        context.addIssue({
          code: 'custom',
          path: ['checks'],
          message: 'An unresolved player identity cannot carry a measured outcome check.',
        });
      }
      if (item.achievements.some(({ status }) => status !== 'unresolved')) {
        context.addIssue({
          code: 'custom',
          path: ['achievements'],
          message: 'An unresolved player identity cannot carry a resolved achievement.',
        });
      }
    }
  });

export function aflDraftTradeOutcomeAcquisitionKey(
  item: z.infer<typeof aflDraftTradeOutcomeListItemSchema>
): string {
  return JSON.stringify([
    item.eventId,
    item.tradeId,
    item.assetId,
    item.aflClubId,
    item.player.aflPlayerId,
    item.player.displayName,
  ]);
}

export const aflDraftTradeOutcomeReleaseRefSchema = z
  .object({
    releaseId: z.string().regex(/^outcome-release:[a-f0-9]{64}$/),
    projectionId: z.string().regex(/^outcome-projection:[a-f0-9]{64}$/),
    archiveDatasetId: aflDraftTradeOutcomeSourceNativeIdSchema,
    metricRegistryVersion: aflDraftTradeOutcomeSourceNativeIdSchema,
    effectiveThrough: aflTradeIsoDateTimeSchema,
    publishedAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((release, context) => {
    if (Date.parse(release.effectiveThrough) > Date.parse(release.publishedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['publishedAt'],
        message: 'A factual release cannot be published before its evidence cutoff.',
      });
    }
  });

export const aflDraftTradeOutcomeConsistencySchema = z
  .object({
    contractVersion: z.literal(AFL_DRAFT_TRADE_OUTCOME_CONTRACT_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    selection: z.enum(['active', 'none']),
    registryRevision: z.number().int().nonnegative(),
    release: aflDraftTradeOutcomeReleaseRefSchema.nullable(),
    servedAt: aflTradeIsoDateTimeSchema,
    freshness: z.enum(['current', 'stale', 'withdrawn', 'unavailable']),
    supportedScope: z.array(z.string().trim().min(1).max(300)).max(100),
    excludedScope: z.array(z.string().trim().min(1).max(300)).max(100),
    warnings: z.array(aflTradePublicWarningSchema).max(20),
  })
  .strict()
  .superRefine((consistency, context) => {
    if (consistency.selection === 'none') {
      if (consistency.release !== null || consistency.freshness !== 'unavailable') {
        context.addIssue({
          code: 'custom',
          message: 'No-release selection cannot contain a release or claim freshness.',
        });
      }
      return;
    }
    if (consistency.release === null || consistency.freshness === 'unavailable') {
      context.addIssue({
        code: 'custom',
        message: 'An active outcome selection requires one exact release and freshness state.',
      });
      return;
    }
    if (Date.parse(consistency.release.publishedAt) > Date.parse(consistency.servedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['servedAt'],
        message: 'A factual release cannot be served before it was published.',
      });
    }
  });

export const aflDraftTradeOutcomeListResponseSchema = z
  .object({
    consistency: aflDraftTradeOutcomeConsistencySchema,
    metricDefinitions: z
      .array(aflDraftTradeOutcomeMetricDefinitionSchema)
      .max(AFL_DRAFT_TRADE_OUTCOME_METRICS.length),
    items: z.array(aflDraftTradeOutcomeListItemSchema).max(100),
    page: z
      .object({
        limit: z.number().int().min(1).max(100),
        nextCursor: z.string().trim().min(1).max(1000).nullable(),
        total: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.items.length > response.page.limit) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'An outcome page cannot exceed its requested limit.',
      });
    }
    if (response.page.total !== null && response.page.total < response.items.length) {
      context.addIssue({
        code: 'custom',
        path: ['page', 'total'],
        message: 'An outcome total cannot be smaller than the returned page.',
      });
    }
    if (response.consistency.selection === 'none' && response.items.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Outcome rows cannot be served without an exact active release.',
      });
    }
    if (response.consistency.freshness === 'withdrawn' && response.items.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'A withdrawn factual release cannot serve outcome rows.',
      });
    }
    const metricCount = new Set(response.metricDefinitions.map(({ metric }) => metric)).size;
    if (metricCount !== response.metricDefinitions.length) {
      context.addIssue({
        code: 'custom',
        path: ['metricDefinitions'],
        message: 'Public outcome metric definitions must be unique.',
      });
    }
    const definitionIds = response.metricDefinitions.map(
      ({ metricDefinitionId }) => metricDefinitionId
    );
    if (new Set(definitionIds).size !== definitionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['metricDefinitions'],
        message: 'Public outcome metric-definition identifiers must be unique.',
      });
    }
    const registryVersions = new Set(
      response.metricDefinitions.map(({ metricRegistryVersion }) => metricRegistryVersion)
    );
    if (registryVersions.size > 1) {
      context.addIssue({
        code: 'custom',
        path: ['metricDefinitions'],
        message: 'One outcome response cannot mix metric registries.',
      });
    }
    const definitionsByMetric = new Map(
      response.metricDefinitions.map((definition) => [definition.metric, definition])
    );
    if (
      response.items.some((item) =>
        item.checks.some((check) => !definitionsByMetric.has(check.metric))
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Every public outcome check must have a definition in the selected release.',
      });
    }
    if (
      response.items.some((item) =>
        item.checks.some((check) => {
          const definition = definitionsByMetric.get(check.metric);
          return check.sources.some(
            ({ metricDefinitionId }) => metricDefinitionId !== definition?.metricDefinitionId
          );
        })
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Outcome evidence must use the selected release metric definition.',
      });
    }

    const release = response.consistency.release;
    if (response.consistency.selection === 'active' && release) {
      if (response.metricDefinitions.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['metricDefinitions'],
          message: 'An active factual release must expose its metric definitions.',
        });
      }
      if (
        response.metricDefinitions.some(
          ({ metricRegistryVersion }) => metricRegistryVersion !== release.metricRegistryVersion
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['metricDefinitions'],
          message: 'Outcome definitions must belong to the selected release metric registry.',
        });
      }
      const releaseCutoff = Date.parse(release.effectiveThrough);
      if (
        response.items.some((item) =>
          item.checks.some(
            ({ effectiveThrough }) =>
              effectiveThrough !== null && Date.parse(effectiveThrough) > releaseCutoff
          )
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'An outcome check cannot exceed the selected release evidence cutoff.',
        });
      }
      if (
        response.items.some((item) =>
          item.achievements.some(
            ({ effectiveThrough }) => Date.parse(effectiveThrough) > releaseCutoff
          )
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'An achievement cannot exceed the selected release evidence cutoff.',
        });
      }
    }

    const acquisitionKeys = response.items.map(aflDraftTradeOutcomeAcquisitionKey);
    if (new Set(acquisitionKeys).size !== acquisitionKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Outcome list items must be unique by acquisition identity.',
      });
    }
  });

export type AflDraftTradeOutcomeMetric = z.infer<typeof aflDraftTradeOutcomeMetricSchema>;
export type AflDraftTradeOutcomeCheckStatus = z.infer<typeof aflDraftTradeOutcomeCheckStatusSchema>;
export type AflDraftTradeOutcomeMetricDefinition = z.infer<
  typeof aflDraftTradeOutcomeMetricDefinitionSchema
>;
export type AflDraftTradeOutcomeMetricCheck = z.infer<typeof aflDraftTradeOutcomeMetricCheckSchema>;
export type AflDraftTradeOutcomeListItem = z.infer<typeof aflDraftTradeOutcomeListItemSchema>;
export type AflDraftTradeOutcomeReleaseRef = z.infer<typeof aflDraftTradeOutcomeReleaseRefSchema>;
export type AflDraftTradeOutcomeConsistency = z.infer<typeof aflDraftTradeOutcomeConsistencySchema>;
export type AflDraftTradeOutcomeListResponse = z.infer<
  typeof aflDraftTradeOutcomeListResponseSchema
>;
