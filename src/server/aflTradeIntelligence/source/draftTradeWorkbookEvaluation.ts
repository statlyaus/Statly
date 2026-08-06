import { z } from 'zod';

import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES,
  aflDraftTradeCanonicalIdentitySchema,
  aflDraftTradeOutcomeEvaluationRecordSchema,
  aflDraftTradeOutcomeObservationSchema,
  aflDraftTradeOutcomeScopeSchema,
  reconcileAflDraftTradeOutcomeMetric,
  type AflDraftTradeCanonicalIdentity,
  type AflDraftTradeMetricCode,
  type AflDraftTradeOutcomeEvaluationRecord,
  type AflDraftTradeOutcomeObservation,
  type AflDraftTradeOutcomeScope,
} from '../modeling/draftTradeOutcomeContracts';

export const AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER = [
  'document_id',
  'year',
  'pick',
  'draft_type',
  'draft_number',
  'club',
  'signing',
  'player',
  'age',
  'height_cm',
  'weight_kg',
  'original_club',
  'grade',
  'games',
  'goals',
  'coaches_votes',
  'brownlow_votes',
  'awards',
] as const;

export const aflDraftTradeAnnualWorkbookHeaderSchema = z.tuple(
  AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER.map((header) => z.literal(header)) as [
    z.ZodLiteral<'document_id'>,
    z.ZodLiteral<'year'>,
    z.ZodLiteral<'pick'>,
    z.ZodLiteral<'draft_type'>,
    z.ZodLiteral<'draft_number'>,
    z.ZodLiteral<'club'>,
    z.ZodLiteral<'signing'>,
    z.ZodLiteral<'player'>,
    z.ZodLiteral<'age'>,
    z.ZodLiteral<'height_cm'>,
    z.ZodLiteral<'weight_kg'>,
    z.ZodLiteral<'original_club'>,
    z.ZodLiteral<'grade'>,
    z.ZodLiteral<'games'>,
    z.ZodLiteral<'goals'>,
    z.ZodLiteral<'coaches_votes'>,
    z.ZodLiteral<'brownlow_votes'>,
    z.ZodLiteral<'awards'>,
  ]
);

const annualWorkbookCellsSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
]);

type AnnualWorkbookCells = z.infer<typeof annualWorkbookCellsSchema>;

export interface AflDraftTradeWorkbookSourceContext {
  sheet: string;
  sourceArtifact: AflTradeArtifactRef;
  evidenceItemId: string;
  rightsReceiptId: string;
  rightsDisposition: 'approved' | 'blocked';
  adapterVersion: string;
}

export interface AflDraftTradeWorkbookAnnualRowInput {
  rowNumber: number;
  cells: readonly string[];
  scope: AflDraftTradeOutcomeScope;
  identity?: Readonly<{
    player: AflDraftTradeCanonicalIdentity;
    event: AflDraftTradeCanonicalIdentity;
    asset: AflDraftTradeCanonicalIdentity;
  }>;
  independentlyObserved?: Partial<
    Readonly<Record<AflDraftTradeMetricCode, AflDraftTradeOutcomeObservation>>
  >;
}

export interface AflDraftTradeWorkbookAnnualEvaluationInput {
  header: readonly string[];
  source: AflDraftTradeWorkbookSourceContext;
  rows: readonly AflDraftTradeWorkbookAnnualRowInput[];
}

interface WorkbookProvenanceInput {
  source: AflDraftTradeWorkbookSourceContext;
  sourceRecordId: string;
  rowNumber: number;
  field: string;
}

export function validateAflDraftTradeAnnualWorkbookHeader(
  header: readonly string[]
): asserts header is typeof AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER {
  aflDraftTradeAnnualWorkbookHeaderSchema.parse(header);
}

function createWorkbookProvenance(input: WorkbookProvenanceInput) {
  return {
    evidenceItemId: input.source.evidenceItemId,
    sourceArtifact: input.source.sourceArtifact,
    rightsReceiptId: input.source.rightsReceiptId,
    rightsDisposition: input.source.rightsDisposition,
    locator: {
      sourceRecordId: input.sourceRecordId,
      sheet: input.source.sheet,
      row: input.rowNumber,
      field: input.field,
    },
    adapterVersion: input.source.adapterVersion,
  } as const;
}

export function parseAflDraftTradeWorkbookMetricCell(input: {
  metricCode: AflDraftTradeMetricCode;
  rawValue: string;
  scope: AflDraftTradeOutcomeScope;
  provenance: ReturnType<typeof createWorkbookProvenance>;
}): AflDraftTradeOutcomeObservation {
  const rawValue = input.rawValue.trim();
  if (rawValue.length === 0) {
    return aflDraftTradeOutcomeObservationSchema.parse({
      metricCode: input.metricCode,
      sourceRole: 'recorded',
      scope: input.scope,
      availability: 'unavailable',
      value: null,
      rawValue,
      reasonCode: 'not_recorded',
      provenance: input.provenance,
    });
  }

  const exactMatch = /^(0|[1-9]\d*)$/.exec(rawValue);
  if (exactMatch) {
    return aflDraftTradeOutcomeObservationSchema.parse({
      metricCode: input.metricCode,
      sourceRole: 'recorded',
      scope: input.scope,
      availability: 'exact',
      value: Number(exactMatch[1]),
      rawValue,
      provenance: input.provenance,
    });
  }

  const compositeGamesMatch = /^(0|[1-9]\d*)\s*\(\s*(0|[1-9]\d*)\s*\)$/.exec(rawValue);
  if (input.metricCode === 'games' && compositeGamesMatch) {
    return aflDraftTradeOutcomeObservationSchema.parse({
      metricCode: input.metricCode,
      sourceRole: 'recorded',
      scope: input.scope,
      availability: 'partial',
      value: null,
      rawValue,
      reasonCode: 'ambiguous_composite_scope',
      components: [
        { ordinal: 1, value: Number(compositeGamesMatch[1]) },
        { ordinal: 2, value: Number(compositeGamesMatch[2]) },
      ],
      provenance: input.provenance,
    });
  }

  return aflDraftTradeOutcomeObservationSchema.parse({
    metricCode: input.metricCode,
    sourceRole: 'recorded',
    scope: input.scope,
    availability: 'partial',
    value: null,
    rawValue,
    reasonCode: 'unresolved_source_semantics',
    components: [],
    provenance: input.provenance,
  });
}

function createUnresolvedIdentity(
  kind: 'player' | 'event' | 'asset'
): AflDraftTradeCanonicalIdentity {
  return aflDraftTradeCanonicalIdentitySchema.parse({
    kind,
    state: 'unresolved',
    canonicalId: null,
    reasonCode: kind === 'asset' ? 'lineage_not_resolved' : 'no_canonical_match',
    candidateCanonicalIds: [],
  });
}

function validateIdentityKinds(
  identity: NonNullable<AflDraftTradeWorkbookAnnualRowInput['identity']>
) {
  return {
    player: aflDraftTradeCanonicalIdentitySchema.parse(identity.player),
    event: aflDraftTradeCanonicalIdentitySchema.parse(identity.event),
    asset: aflDraftTradeCanonicalIdentitySchema.parse(identity.asset),
  } as const;
}

function createUnavailableIndependentObservation(
  metricCode: AflDraftTradeMetricCode,
  scope: AflDraftTradeOutcomeScope
): AflDraftTradeOutcomeObservation {
  return aflDraftTradeOutcomeObservationSchema.parse({
    metricCode,
    sourceRole: 'independently_observed',
    scope,
    availability: 'unavailable',
    value: null,
    rawValue: '',
    reasonCode: 'source_not_supplied',
    provenance: null,
  });
}

function parseWorkbookAchievements(input: {
  rawValue: string;
  playerIdentity: AflDraftTradeCanonicalIdentity;
  source: AflDraftTradeWorkbookSourceContext;
  sourceRecordId: string;
  rowNumber: number;
}) {
  const rawValue = input.rawValue.trim();
  if (!rawValue) return [];

  const provenance = {
    ...createWorkbookProvenance({
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      rowNumber: input.rowNumber,
      field: 'awards',
    }),
    effectiveThrough: input.source.sourceArtifact.createdAt,
  };

  return rawValue.split(';').map((untrimmedSegment) => {
    const segment = untrimmedSegment.trim();
    const match = /^([^:]+):\s*(\d{4}(?:\s*,\s*\d{4})*)$/.exec(segment);
    const token = match?.[1].trim() ?? null;
    const parsedSeasons = match ? match[2].split(',').map((season) => Number(season.trim())) : [];
    const reasonCodes = new Set<
      | 'player_identity_unresolved'
      | 'award_identity_unresolved'
      | 'club_at_season_unresolved'
      | 'award_syntax_ambiguous'
    >();
    if (input.playerIdentity.state === 'unresolved') {
      reasonCodes.add('player_identity_unresolved');
    }
    if (!match) reasonCodes.add('award_syntax_ambiguous');
    reasonCodes.add('award_identity_unresolved');
    if (token === 'B&F') reasonCodes.add('club_at_season_unresolved');

    return {
      state: 'unresolved' as const,
      achievementId: null,
      playerId: input.playerIdentity.state === 'resolved' ? input.playerIdentity.canonicalId : null,
      rawValue: segment,
      parsedAwardToken: token,
      parsedSeasons,
      reasonCodes: [...reasonCodes],
      provenance,
      publicationEligible: false as const,
    };
  });
}

function requireAnnualRowIdentity(cells: AnnualWorkbookCells, sheet: string, rowNumber: number) {
  const sourceRecordId = cells[0].trim();
  const yearText = cells[1].trim();
  if (!/^\d{4}_\d{4}$/.test(sourceRecordId)) {
    throw new TypeError(`Annual workbook row ${rowNumber} has an invalid document_id.`);
  }
  if (!/^\d{4}$/.test(sheet) || yearText !== sheet || !sourceRecordId.startsWith(`${sheet}_`)) {
    throw new TypeError(`Annual workbook row ${rowNumber} does not match its year sheet.`);
  }
  return sourceRecordId;
}

export function evaluateAflDraftTradeAnnualWorkbookRows(
  input: AflDraftTradeWorkbookAnnualEvaluationInput
): AflDraftTradeOutcomeEvaluationRecord[] {
  validateAflDraftTradeAnnualWorkbookHeader(input.header);
  if (!/^\d{4}$/.test(input.source.sheet)) {
    throw new TypeError('Annual workbook evaluation requires a four-digit year sheet.');
  }

  const seenSourceRecordIds = new Set<string>();
  return input.rows.map((unparsedRow) => {
    const cells = annualWorkbookCellsSchema.parse(unparsedRow.cells);
    const sourceRecordId = requireAnnualRowIdentity(
      cells,
      input.source.sheet,
      unparsedRow.rowNumber
    );
    if (seenSourceRecordIds.has(sourceRecordId)) {
      throw new TypeError(`Annual workbook document_id ${sourceRecordId} is duplicated.`);
    }
    seenSourceRecordIds.add(sourceRecordId);

    const scope = aflDraftTradeOutcomeScopeSchema.parse(unparsedRow.scope);
    const identity = unparsedRow.identity
      ? validateIdentityKinds(unparsedRow.identity)
      : {
          player: createUnresolvedIdentity('player'),
          event: createUnresolvedIdentity('event'),
          asset: createUnresolvedIdentity('asset'),
        };

    const rawMetricCells: Readonly<Record<AflDraftTradeMetricCode, string>> = {
      games: cells[13],
      goals: cells[14],
      coaches_votes: cells[15],
      brownlow_votes: cells[16],
    };
    const metrics = Object.fromEntries(
      AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES.map((metricCode) => {
        const recorded = parseAflDraftTradeWorkbookMetricCell({
          metricCode,
          rawValue: rawMetricCells[metricCode],
          scope,
          provenance: createWorkbookProvenance({
            source: input.source,
            sourceRecordId,
            rowNumber: unparsedRow.rowNumber,
            field: metricCode,
          }),
        });
        const independentlyObserved = unparsedRow.independentlyObserved?.[metricCode]
          ? aflDraftTradeOutcomeObservationSchema.parse(
              unparsedRow.independentlyObserved[metricCode]
            )
          : createUnavailableIndependentObservation(metricCode, scope);
        return [
          metricCode,
          reconcileAflDraftTradeOutcomeMetric(metricCode, recorded, independentlyObserved),
        ];
      })
    ) as Record<AflDraftTradeMetricCode, ReturnType<typeof reconcileAflDraftTradeOutcomeMetric>>;

    const achievements = parseWorkbookAchievements({
      rawValue: cells[17],
      playerIdentity: identity.player,
      source: input.source,
      sourceRecordId,
      rowNumber: unparsedRow.rowNumber,
    });
    const identitiesResolved = Object.values(identity).every(
      (identityRef) => identityRef.state === 'resolved'
    );
    const publicationEligible =
      identitiesResolved &&
      Object.values(metrics).every((metric) => metric.publicationEligible) &&
      achievements.every((achievement) => achievement.publicationEligible);

    return aflDraftTradeOutcomeEvaluationRecordSchema.parse({
      evaluationRecordId: createAflTradeContentAddress('evaluation-record', {
        artifactId: input.source.sourceArtifact.artifactId,
        sheet: input.source.sheet,
        row: unparsedRow.rowNumber,
        sourceRecordId,
      }),
      sourceRecordId,
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
      identity,
      metrics,
      achievements,
      publicationEligible,
    });
  });
}
