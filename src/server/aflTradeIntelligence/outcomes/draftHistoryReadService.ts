import { z } from 'zod';

import { aflDraftTradeOutcomeReleaseRefSchema } from '@/types/aflDraftTradeOutcomes';
import { aflTradeIsoDateTimeSchema, aflTradePublicIdSchema } from '@/types/aflTradeIntelligence';

import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from './outcomeReadService';
import type {
  AflTradePromotionBackedArchiveSelection,
  AflTradePromotionBackedArchiveSelector,
} from './promotionBackedArchiveSelection';

export const AFL_DRAFT_HISTORY_CONTRACT_VERSION = 'afl-draft-history/v1' as const;
export const AFL_DRAFT_HISTORY_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_draft_facts_no_user_or_fantasy_ownership' as const;

export const AFL_DRAFT_HISTORY_DRAFT_KINDS = [
  'national_draft',
  'preseason_draft',
  'rookie_draft',
  'midseason_draft',
  'supplemental_selection',
] as const;

export const aflDraftHistoryDraftKindSchema = z.enum(AFL_DRAFT_HISTORY_DRAFT_KINDS);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'Invalid date.');

const clubSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    name: z.string().trim().min(1).max(160),
    abbreviation: z.string().trim().min(1).max(20),
  })
  .strict();

const tradeRefSchema = z
  .object({
    tradeId: aflTradePublicIdSchema,
    year: z.number().int().min(1897).max(2200),
    title: z.string().trim().min(1).max(300),
  })
  .strict();

export const aflDraftHistorySelectionSchema = z
  .object({
    selectionId: aflTradePublicIdSchema,
    eventId: aflTradePublicIdSchema,
    eventVersionId: aflTradePublicIdSchema,
    year: z.number().int().min(1897).max(2200),
    draftKind: aflDraftHistoryDraftKindSchema,
    draftName: z.string().trim().min(1).max(300),
    draftDate: isoDateSchema,
    selectionNumber: z.number().int().positive(),
    round: z.number().int().positive().nullable(),
    pickId: aflTradePublicIdSchema.nullable(),
    club: clubSchema,
    originalClub: clubSchema.nullable(),
    player: z
      .object({
        aflPlayerId: aflTradePublicIdSchema.nullable(),
        displayName: z.string().trim().min(1).max(200),
        identityStatus: z.enum(['resolved', 'unresolved']),
      })
      .strict(),
    lineage: z
      .object({
        status: z.enum(['linked_to_trade', 'selection_only', 'unresolved']),
        edgeCount: z.number().int().nonnegative(),
        tradeRefs: z.array(tradeRefSchema).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((selection, context) => {
    const playerIsResolved = selection.player.aflPlayerId !== null;
    if (playerIsResolved !== (selection.player.identityStatus === 'resolved')) {
      context.addIssue({
        code: 'custom',
        path: ['player', 'identityStatus'],
        message: 'Player identity status must match the canonical player identifier.',
      });
    }

    const tradeIds = selection.lineage.tradeRefs.map(({ tradeId }) => tradeId);
    if (new Set(tradeIds).size !== tradeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'tradeRefs'],
        message: 'Draft lineage cannot repeat a trade reference.',
      });
    }
    if (
      (selection.lineage.status === 'linked_to_trade') !==
      selection.lineage.tradeRefs.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'status'],
        message: 'Linked draft lineage requires at least one released trade reference.',
      });
    }
    if (selection.pickId === null) {
      if (selection.originalClub !== null || selection.lineage.status !== 'unresolved') {
        context.addIssue({
          code: 'custom',
          path: ['pickId'],
          message: 'A selection without a canonical pick cannot claim origin or lineage.',
        });
      }
    } else if (selection.lineage.status === 'unresolved') {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'status'],
        message: 'A canonical released pick must use linked or selection-only lineage status.',
      });
    }
  });

export type AflDraftHistorySelection = z.infer<typeof aflDraftHistorySelectionSchema>;

export const aflDraftHistoryYearSummarySchema = z
  .object({
    year: z.number().int().min(1897).max(2200),
    selectionCount: z.number().int().nonnegative(),
    draftEventCount: z.number().int().nonnegative(),
    draftKinds: z.array(aflDraftHistoryDraftKindSchema).min(1),
  })
  .strict()
  .superRefine((summary, context) => {
    if (new Set(summary.draftKinds).size !== summary.draftKinds.length) {
      context.addIssue({
        code: 'custom',
        path: ['draftKinds'],
        message: 'A year summary cannot repeat a draft kind.',
      });
    }
  });

export type AflDraftHistoryYearSummary = z.infer<typeof aflDraftHistoryYearSummarySchema>;

const readRequestSchema = z
  .object({
    year: z.number().int().min(1897).max(2200),
    q: z.string().trim().max(160),
    club: z.string().trim().max(160),
    draftKind: aflDraftHistoryDraftKindSchema.nullable(),
  })
  .strict();

export type AflDraftHistoryReadRequest = z.infer<typeof readRequestSchema>;

const consistencySchema = z
  .object({
    contractVersion: z.literal(AFL_DRAFT_HISTORY_CONTRACT_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_HISTORY_PUBLIC_ASSET_BOUNDARY),
    selection: z.enum(['active', 'none']),
    registryRevision: z.number().int().nonnegative(),
    release: aflDraftTradeOutcomeReleaseRefSchema.nullable(),
    servedAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((consistency, context) => {
    if ((consistency.selection === 'active') !== (consistency.release !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['release'],
        message: 'An active draft-history selection requires an exact factual release.',
      });
    }
    if (
      consistency.release &&
      Date.parse(consistency.release.publishedAt) > Date.parse(consistency.servedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['servedAt'],
        message: 'Draft history cannot be served before its factual release was published.',
      });
    }
  });

export const aflDraftHistoryIndexResponseSchema = z
  .object({
    consistency: consistencySchema,
    years: z.array(aflDraftHistoryYearSummarySchema),
  })
  .strict()
  .superRefine((response, context) => {
    if (new Set(response.years.map(({ year }) => year)).size !== response.years.length) {
      context.addIssue({
        code: 'custom',
        path: ['years'],
        message: 'The released draft-year index cannot repeat a season.',
      });
    }
    if (response.consistency.selection === 'none' && response.years.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['years'],
        message: 'Draft years cannot be served without an active factual release.',
      });
    }
  });

export type AflDraftHistoryIndexResponse = z.infer<typeof aflDraftHistoryIndexResponseSchema>;

export const aflDraftHistoryYearResponseSchema = z
  .object({
    consistency: consistencySchema,
    availableYears: z.array(aflDraftHistoryYearSummarySchema),
    year: z
      .object({
        year: z.number().int().min(1897).max(2200),
        totalSelections: z.number().int().nonnegative(),
        filteredSelections: z.number().int().nonnegative(),
      })
      .strict(),
    availableFilters: z
      .object({
        draftKinds: z.array(aflDraftHistoryDraftKindSchema),
        clubs: z.array(clubSchema),
      })
      .strict(),
    selections: z.array(aflDraftHistorySelectionSchema),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.year.filteredSelections !== response.selections.length) {
      context.addIssue({
        code: 'custom',
        path: ['year', 'filteredSelections'],
        message: 'The filtered selection count must equal the exact returned row count.',
      });
    }
    if (response.year.filteredSelections > response.year.totalSelections) {
      context.addIssue({
        code: 'custom',
        path: ['year', 'totalSelections'],
        message: 'A filtered selection count cannot exceed the released year total.',
      });
    }
    if (response.selections.some(({ year }) => year !== response.year.year)) {
      context.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'Every draft selection must belong to the requested released year.',
      });
    }
    const selectionIds = response.selections.map(({ selectionId }) => selectionId);
    if (new Set(selectionIds).size !== selectionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'A released draft selection cannot appear twice.',
      });
    }
    const eventSelectionKeys = response.selections.map(
      ({ eventVersionId, selectionNumber }) => `${eventVersionId}:${selectionNumber}`
    );
    if (new Set(eventSelectionKeys).size !== eventSelectionKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'A released draft event cannot repeat a selection number.',
      });
    }
    if (
      new Set(response.availableYears.map(({ year }) => year)).size !==
      response.availableYears.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableYears'],
        message: 'The draft-year filter cannot repeat a season.',
      });
    }
    if (
      new Set(response.availableFilters.clubs.map(({ aflClubId }) => aflClubId)).size !==
        response.availableFilters.clubs.length ||
      new Set(response.availableFilters.draftKinds).size !==
        response.availableFilters.draftKinds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableFilters'],
        message: 'Draft-history filters must contain unique canonical values.',
      });
    }
    if (
      response.consistency.selection === 'none' &&
      (response.year.totalSelections > 0 ||
        response.availableYears.length > 0 ||
        response.selections.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['consistency', 'selection'],
        message: 'Draft records cannot be served without an active factual release.',
      });
    }
  });

export type AflDraftHistoryYearResponse = z.infer<typeof aflDraftHistoryYearResponseSchema>;

export interface AflDraftHistoryRepository {
  listYears(
    selection: AflTradePromotionBackedArchiveSelection
  ): Promise<readonly AflDraftHistoryYearSummary[]>;
  readYear(
    selection: AflTradePromotionBackedArchiveSelection,
    year: number
  ): Promise<readonly AflDraftHistorySelection[]>;
}

export type AflDraftHistoryReadErrorCode =
  'INVALID_REQUEST' | 'RELEASE_MISMATCH' | 'REPOSITORY_READ_FAILED' | 'INVALID_REPOSITORY_PAYLOAD';

export class AflDraftHistoryReadError extends Error {
  constructor(
    public readonly code: AflDraftHistoryReadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflDraftHistoryReadError';
  }
}

export interface AflDraftHistoryReadService {
  listYears(): Promise<AflDraftHistoryIndexResponse>;
  readYear(request: AflDraftHistoryReadRequest): Promise<AflDraftHistoryYearResponse>;
}

function requireSelection(
  registryRevision: number,
  selection: AflTradePromotionBackedArchiveSelection
): AflTradePromotionBackedArchiveSelection {
  if (
    selection.registryRevision !== registryRevision ||
    selection.scopeKey !== AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE
  ) {
    throw new AflDraftHistoryReadError(
      'RELEASE_MISMATCH',
      'The captured factual release is inconsistent with the public draft-history scope.'
    );
  }
  return selection;
}

function consistencyFor(
  registryRevision: number,
  selection: AflTradePromotionBackedArchiveSelection | null,
  servedAt: string
) {
  return {
    contractVersion: AFL_DRAFT_HISTORY_CONTRACT_VERSION,
    publicAssetBoundary: AFL_DRAFT_HISTORY_PUBLIC_ASSET_BOUNDARY,
    selection: selection ? ('active' as const) : ('none' as const),
    registryRevision,
    release: selection
      ? {
          releaseId: selection.releaseId,
          projectionId: selection.projectionId,
          archiveDatasetId: selection.corpusId,
          metricRegistryVersion: 'promotion-backed-public-archive-v1',
          effectiveThrough: selection.effectiveThrough,
          publishedAt: selection.publishedAt,
        }
      : null,
    servedAt,
  };
}

function parseRepositoryRows<T>(schema: z.ZodType<T>, rows: readonly unknown[]): T[] {
  const parsed = z.array(schema).safeParse(rows);
  if (!parsed.success) {
    throw new AflDraftHistoryReadError(
      'INVALID_REPOSITORY_PAYLOAD',
      'The factual draft-history repository returned an invalid released record.'
    );
  }
  return parsed.data;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-AU');
}

function selectionMatchesRequest(
  selection: AflDraftHistorySelection,
  request: AflDraftHistoryReadRequest
): boolean {
  if (request.draftKind && selection.draftKind !== request.draftKind) return false;
  const club = normalized(request.club);
  if (
    club &&
    ![selection.club.aflClubId, selection.club.name, selection.club.abbreviation]
      .map(normalized)
      .includes(club)
  ) {
    return false;
  }
  const query = normalized(request.q);
  if (!query) return true;
  return [
    String(selection.selectionNumber),
    selection.player.displayName,
    selection.club.name,
    selection.club.abbreviation,
    selection.originalClub?.name ?? '',
    selection.draftName,
  ].some((candidate) => normalized(candidate).includes(query));
}

function sortYears(years: AflDraftHistoryYearSummary[]): AflDraftHistoryYearSummary[] {
  return [...years].sort((left, right) => right.year - left.year);
}

function sortSelections(selections: AflDraftHistorySelection[]): AflDraftHistorySelection[] {
  return [...selections].sort(
    (left, right) =>
      left.selectionNumber - right.selectionNumber ||
      left.selectionId.localeCompare(right.selectionId)
  );
}

export function createAflDraftHistoryReadService(dependencies: {
  archiveSelector: AflTradePromotionBackedArchiveSelector;
  repository: AflDraftHistoryRepository;
  now?: () => string;
}): AflDraftHistoryReadService {
  const now = dependencies.now ?? (() => new Date().toISOString());

  async function capture() {
    const snapshot = await dependencies.archiveSelector.capture(
      AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE
    );
    return {
      snapshot,
      selection: snapshot.selection
        ? requireSelection(snapshot.registryRevision, snapshot.selection)
        : null,
      servedAt: now(),
    };
  }

  async function loadYears(selection: AflTradePromotionBackedArchiveSelection) {
    try {
      return sortYears(
        parseRepositoryRows(
          aflDraftHistoryYearSummarySchema,
          await dependencies.repository.listYears(selection)
        )
      );
    } catch (error) {
      if (error instanceof AflDraftHistoryReadError) throw error;
      throw new AflDraftHistoryReadError(
        'REPOSITORY_READ_FAILED',
        'The released AFL draft-year index could not be read.'
      );
    }
  }

  return {
    async listYears() {
      const { snapshot, selection, servedAt } = await capture();
      return aflDraftHistoryIndexResponseSchema.parse({
        consistency: consistencyFor(snapshot.registryRevision, selection, servedAt),
        years: selection ? await loadYears(selection) : [],
      });
    },

    async readYear(input) {
      const parsedRequest = readRequestSchema.safeParse(input);
      if (!parsedRequest.success) {
        throw new AflDraftHistoryReadError(
          'INVALID_REQUEST',
          'The AFL draft-history request is invalid.'
        );
      }
      const request = parsedRequest.data;
      const { snapshot, selection, servedAt } = await capture();
      if (!selection) {
        return aflDraftHistoryYearResponseSchema.parse({
          consistency: consistencyFor(snapshot.registryRevision, null, servedAt),
          availableYears: [],
          year: { year: request.year, totalSelections: 0, filteredSelections: 0 },
          availableFilters: { draftKinds: [], clubs: [] },
          selections: [],
        });
      }

      let selections: AflDraftHistorySelection[];
      try {
        selections = sortSelections(
          parseRepositoryRows(
            aflDraftHistorySelectionSchema,
            await dependencies.repository.readYear(selection, request.year)
          )
        );
      } catch (error) {
        if (error instanceof AflDraftHistoryReadError) throw error;
        throw new AflDraftHistoryReadError(
          'REPOSITORY_READ_FAILED',
          'The released AFL draft selections could not be read.'
        );
      }

      const clubs = Array.from(
        new Map(selections.map(({ club }) => [club.aflClubId, club])).values()
      ).sort((left, right) => left.name.localeCompare(right.name));
      const draftKinds = Array.from(new Set(selections.map(({ draftKind }) => draftKind))).sort();
      const filtered = selections.filter((row) => selectionMatchesRequest(row, request));

      return aflDraftHistoryYearResponseSchema.parse({
        consistency: consistencyFor(snapshot.registryRevision, selection, servedAt),
        availableYears: await loadYears(selection),
        year: {
          year: request.year,
          totalSelections: selections.length,
          filteredSelections: filtered.length,
        },
        availableFilters: { draftKinds, clubs },
        selections: filtered,
      });
    },
  };
}
