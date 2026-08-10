import { createHash } from 'node:crypto';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  AFL_TRADE_FITZROY_NORMALIZATION_RECEIPT_SCHEMA_VERSION,
  assertAflTradeFitzRoyFieldMapMatchesTable,
  createAflTradeFitzRoyFieldMapSha256,
  decodedScalarToSourceText,
  type AflTradeDecodedScalar,
  type AflTradeFitzRoyDecodedTable,
  type AflTradeFitzRoyFieldMap,
} from './fitzRoyObservationContracts';
import { AFL_TRADE_FITZROY_CAPABILITIES } from './fitzRoyProviderCapabilities';

export const AFL_TRADE_FITZROY_NORMALIZER_VERSION =
  'afl-trade-fitzroy-observation-normalizer/v1' as const;

export type AflTradeProviderObservationIssueCode =
  | 'required_field_missing'
  | 'source_season_mismatch'
  | 'invalid_metric'
  | 'ambiguous_provider_zero'
  | 'natural_key_component_missing'
  | 'duplicate_natural_key';

export interface AflTradeProviderObservationIssue {
  rowNumber: number;
  code: AflTradeProviderObservationIssueCode;
  field: string | null;
  message: string;
}

export interface AflTradeProviderIdentityCandidate {
  candidateId: string;
  provider: string;
  entityKind: 'player';
  nativeEntityId: string | null;
  recordedName: string;
  recordedClubId: string | null;
  recordedClubName: string | null;
  locatorSha256: string;
  resolutionState: 'unresolved';
}

export interface AflTradeProviderMatchCandidate {
  candidateId: string;
  provider: string;
  nativeMatchId: string | null;
  roundLabel: string;
  matchDateText: string | null;
  homeClubNativeId: string | null;
  homeClubName: string;
  awayClubNativeId: string | null;
  awayClubName: string;
  providerStatus: string | null;
  orderIndependentSha256: string;
  resolutionState: 'unresolved';
}

export interface AflTradeProviderMetricCandidate {
  metricCode: 'goals' | 'brownlow_votes' | 'coaches_votes';
  definitionVersion: string;
  availability: 'exact' | 'missing' | 'quarantined';
  numericValue: string | null;
  unit: string;
  sourceField: string;
  missingReason: string | null;
}

export interface AflTradeProviderAchievementCandidate {
  candidateId: string;
  achievementCode:
    | 'all_australian_team'
    | 'all_australian_squad'
    | 'rising_star_nomination'
    | 'rising_star_winner';
  evidenceValue: string | null;
  resolutionState: 'unresolved';
}

export interface AflTradeProviderDecodedRowCandidate {
  providerDecodedRowId: string;
  competition: 'AFLM' | 'AFLW';
  seasonYear: number;
  observedSeasonText: string | null;
  roundLabel: string | null;
  observedDateText: string | null;
  sourceRowNumber: number;
  sourceRowSha256: string;
  rowStatus: 'staged' | 'needs_review';
  typedPayload: Readonly<Record<string, AflTradeDecodedScalar>>;
  identityCandidate: AflTradeProviderIdentityCandidate | null;
  matchCandidate: AflTradeProviderMatchCandidate | null;
  metricCandidates: readonly AflTradeProviderMetricCandidate[];
  achievementCandidate: AflTradeProviderAchievementCandidate | null;
  appearanceCandidate: boolean;
  semanticNaturalKeySha256: string | null;
}

export interface AflTradeProviderObservationBatch {
  receipt: {
    schemaVersion: typeof AFL_TRADE_FITZROY_NORMALIZATION_RECEIPT_SCHEMA_VERSION;
    normalizerVersion: typeof AFL_TRADE_FITZROY_NORMALIZER_VERSION;
    captureReceiptSha256: string;
    invocationSha256: string;
    invocationArgumentsSha256: string;
    diagnosticsSha256: string;
    decodedSha256: string;
    sourceRdsSha256: string;
    sourceSchemaSha256: string;
    fieldMapSha256: string;
    capabilityId: string;
    provider: string;
    competition: 'AFLM' | 'AFLW';
    authorizationSeason: number;
    sourceRowCount: number;
    acceptedRowCount: number;
    quarantinedRowCount: number;
    issueCount: number;
    status: 'candidate' | 'quarantined';
    publicationEligible: false;
    canonicalIdentityResolutionPerformed: false;
  };
  rows: readonly AflTradeProviderDecodedRowCandidate[];
  issues: readonly AflTradeProviderObservationIssue[];
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeAflTradeJson(value)).digest('hex');
}

function normalizedLocatorText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-AU');
}

function buildRow(fields: readonly string[], values: readonly AflTradeDecodedScalar[]) {
  return Object.fromEntries(fields.map((field, index) => [field, values[index]])) as Record<
    string,
    AflTradeDecodedScalar
  >;
}

function optionalText(
  row: Record<string, AflTradeDecodedScalar>,
  field: string | null
): string | null {
  if (field === null) return null;
  const source = row[field];
  if (
    source === undefined ||
    source.kind === 'missing' ||
    source.kind === 'nan' ||
    source.kind === 'positive_infinity' ||
    source.kind === 'negative_infinity'
  ) {
    return null;
  }
  const value = decodedScalarToSourceText(source);
  return value === null || value.trim().length === 0 ? null : value;
}

function requiredText(input: {
  row: Record<string, AflTradeDecodedScalar>;
  field: string;
  rowNumber: number;
  issues: AflTradeProviderObservationIssue[];
}): string | null {
  const value = optionalText(input.row, input.field);
  if (
    value === null &&
    !input.issues.some(
      (issue) =>
        issue.rowNumber === input.rowNumber &&
        issue.code === 'required_field_missing' &&
        issue.field === input.field
    )
  ) {
    input.issues.push({
      rowNumber: input.rowNumber,
      code: 'required_field_missing',
      field: input.field,
      message: `Required source field ${input.field} is missing.`,
    });
  }
  return value;
}

function requiredSourceFields(fieldMap: AflTradeFitzRoyFieldMap): readonly string[] {
  const bindings = [
    fieldMap.seasonField,
    fieldMap.roundLabelField,
    fieldMap.observedDateField,
    ...Object.values(fieldMap.identity ?? {}),
    ...Object.values(fieldMap.match ?? {}),
  ];
  return [
    ...new Set(
      bindings.flatMap((binding) =>
        binding !== null && binding.required ? [binding.sourceField] : []
      )
    ),
  ];
}

function boundText(input: {
  row: Record<string, AflTradeDecodedScalar>;
  binding: { sourceField: string; required: boolean } | null;
  rowNumber: number;
  issues: AflTradeProviderObservationIssue[];
}): string | null {
  if (input.binding === null) return null;
  return input.binding.required
    ? requiredText({
        row: input.row,
        field: input.binding.sourceField,
        rowNumber: input.rowNumber,
        issues: input.issues,
      })
    : optionalText(input.row, input.binding.sourceField);
}

function clubLocator(nativeId: string | null, name: string) {
  return nativeId === null
    ? { recordedName: normalizedLocatorText(name) }
    : { nativeClubId: nativeId };
}

function makeMatchCandidate(input: {
  row: Record<string, AflTradeDecodedScalar>;
  rowNumber: number;
  provider: string;
  competition: string;
  seasonYear: number;
  captureReceiptSha256: string;
  interpretationSha256: string;
  bindings: NonNullable<AflTradeFitzRoyFieldMap['match']>;
  issues: AflTradeProviderObservationIssue[];
}): AflTradeProviderMatchCandidate | null {
  const homeClubName = requiredText({
    row: input.row,
    field: input.bindings.homeClubName.sourceField,
    rowNumber: input.rowNumber,
    issues: input.issues,
  });
  const awayClubName = requiredText({
    row: input.row,
    field: input.bindings.awayClubName.sourceField,
    rowNumber: input.rowNumber,
    issues: input.issues,
  });
  const roundLabel = requiredText({
    row: input.row,
    field: input.bindings.roundLabel.sourceField,
    rowNumber: input.rowNumber,
    issues: input.issues,
  });
  if (homeClubName === null || awayClubName === null || roundLabel === null) return null;

  const bindingInput = {
    row: input.row,
    rowNumber: input.rowNumber,
    issues: input.issues,
  };
  const nativeMatchId = boundText({ ...bindingInput, binding: input.bindings.nativeMatchId });
  const homeClubNativeId = boundText({
    ...bindingInput,
    binding: input.bindings.homeClubNativeId,
  });
  const awayClubNativeId = boundText({
    ...bindingInput,
    binding: input.bindings.awayClubNativeId,
  });
  const matchDateText = boundText({ ...bindingInput, binding: input.bindings.matchDate });
  const clubs = [
    clubLocator(homeClubNativeId, homeClubName),
    clubLocator(awayClubNativeId, awayClubName),
  ].sort((left, right) =>
    canonicalizeAflTradeJson(left).localeCompare(canonicalizeAflTradeJson(right))
  );
  const orderIndependentSha256 = sha256({
    provider: input.provider,
    competition: input.competition,
    seasonYear: input.seasonYear,
    locator:
      nativeMatchId === null
        ? { roundLabel: normalizedLocatorText(roundLabel), matchDateText, clubs }
        : { nativeMatchId },
  });
  return {
    candidateId: `match-candidate:${sha256({ captureReceiptSha256: input.captureReceiptSha256, interpretationSha256: input.interpretationSha256, rowNumber: input.rowNumber, orderIndependentSha256 })}`,
    provider: input.provider,
    nativeMatchId,
    roundLabel,
    matchDateText,
    homeClubNativeId,
    homeClubName,
    awayClubNativeId,
    awayClubName,
    providerStatus: boundText({ ...bindingInput, binding: input.bindings.status }),
    orderIndependentSha256,
    resolutionState: 'unresolved',
  };
}

function makeIdentityCandidate(input: {
  row: Record<string, AflTradeDecodedScalar>;
  rowNumber: number;
  provider: string;
  competition: string;
  seasonYear: number;
  captureReceiptSha256: string;
  interpretationSha256: string;
  bindings: NonNullable<AflTradeFitzRoyFieldMap['identity']>;
  issues: AflTradeProviderObservationIssue[];
}): AflTradeProviderIdentityCandidate | null {
  const recordedName = requiredText({
    row: input.row,
    field: input.bindings.recordedName.sourceField,
    rowNumber: input.rowNumber,
    issues: input.issues,
  });
  if (recordedName === null) return null;
  const bindingInput = {
    row: input.row,
    rowNumber: input.rowNumber,
    issues: input.issues,
  };
  const nativeEntityId = boundText({ ...bindingInput, binding: input.bindings.nativeId });
  const recordedClubId = boundText({
    ...bindingInput,
    binding: input.bindings.recordedClubNativeId,
  });
  const recordedClubName = boundText({
    ...bindingInput,
    binding: input.bindings.recordedClubName,
  });
  const locatorSha256 = sha256({
    provider: input.provider,
    competition: input.competition,
    seasonYear: input.seasonYear,
    locator:
      nativeEntityId === null
        ? {
            recordedName: normalizedLocatorText(recordedName),
            recordedClubId,
            recordedClubName:
              recordedClubName === null ? null : normalizedLocatorText(recordedClubName),
          }
        : { nativeEntityId },
  });
  return {
    candidateId: `identity-candidate:${sha256({ captureReceiptSha256: input.captureReceiptSha256, interpretationSha256: input.interpretationSha256, rowNumber: input.rowNumber, locatorSha256 })}`,
    provider: input.provider,
    entityKind: 'player',
    nativeEntityId,
    recordedName,
    recordedClubId,
    recordedClubName,
    locatorSha256,
    resolutionState: 'unresolved',
  };
}

function makeMetricCandidate(input: {
  row: Record<string, AflTradeDecodedScalar>;
  rowNumber: number;
  binding: AflTradeFitzRoyFieldMap['metrics'][number];
  issues: AflTradeProviderObservationIssue[];
}): AflTradeProviderMetricCandidate {
  const source = input.row[input.binding.sourceField];
  if (source.kind === 'missing') {
    return {
      ...input.binding,
      availability: 'missing',
      numericValue: null,
      missingReason: 'provider_value_missing',
    };
  }
  if (source.kind !== 'integer' && source.kind !== 'finite_number') {
    input.issues.push({
      rowNumber: input.rowNumber,
      code: 'invalid_metric',
      field: input.binding.sourceField,
      message: `${input.binding.metricCode} must be a finite non-negative integer.`,
    });
    return {
      ...input.binding,
      availability: 'quarantined',
      numericValue: null,
      missingReason: `invalid_${source.kind}`,
    };
  }
  const numeric = Number(source.value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    input.issues.push({
      rowNumber: input.rowNumber,
      code: 'invalid_metric',
      field: input.binding.sourceField,
      message: `${input.binding.metricCode} must be a safe non-negative integer.`,
    });
    return {
      ...input.binding,
      availability: 'quarantined',
      numericValue: null,
      missingReason: 'invalid_numeric_value',
    };
  }
  if (numeric === 0 && input.binding.zeroSemantics === 'provider_zero_may_mean_missing') {
    input.issues.push({
      rowNumber: input.rowNumber,
      code: 'ambiguous_provider_zero',
      field: input.binding.sourceField,
      message: `${input.binding.metricCode} zero is quarantined because this provider path may zero-fill missing values.`,
    });
    return {
      ...input.binding,
      availability: 'quarantined',
      numericValue: null,
      missingReason: 'provider_zero_semantics_unverified',
    };
  }
  return {
    ...input.binding,
    availability: 'exact',
    numericValue: String(numeric),
    missingReason: null,
  };
}

export function normalizeAflTradeFitzRoyDecodedTable(input: {
  table: AflTradeFitzRoyDecodedTable;
  fieldMap: AflTradeFitzRoyFieldMap;
  decodedSha256: string;
}): AflTradeProviderObservationBatch {
  if (!/^[a-f0-9]{64}$/.test(input.decodedSha256)) {
    throw new Error('Decoded fitzRoy artifact digest is invalid.');
  }
  assertAflTradeFitzRoyFieldMapMatchesTable(input);
  const { table, fieldMap } = input;
  const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
    (candidate) => candidate.capabilityId === table.capabilityId
  );
  if (capability === undefined) throw new Error('Unknown fitzRoy capability.');

  const fields = table.fields.map((field) => field.name);
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  const interpretationSha256 = sha256({
    decodedSha256: input.decodedSha256,
    fieldMapSha256,
    normalizerVersion: AFL_TRADE_FITZROY_NORMALIZER_VERSION,
  });
  const issues: AflTradeProviderObservationIssue[] = [];
  const rows: AflTradeProviderDecodedRowCandidate[] = table.rows.map((values, index) => {
    const rowNumber = index + 1;
    const rowIssueStart = issues.length;
    const typedPayload = buildRow(fields, values);
    const sourceRowSha256 = sha256({ rowNumber, typedPayload });
    for (const field of requiredSourceFields(fieldMap)) {
      requiredText({ row: typedPayload, field, rowNumber, issues });
    }
    const observedSeasonText =
      fieldMap.seasonField === null
        ? null
        : boundText({ row: typedPayload, binding: fieldMap.seasonField, rowNumber, issues });
    if (fieldMap.seasonField !== null && observedSeasonText !== String(table.authorizationSeason)) {
      issues.push({
        rowNumber,
        code: 'source_season_mismatch',
        field: fieldMap.seasonField.sourceField,
        message: 'Observed source season does not equal the authorized capture season.',
      });
    }
    const matchCandidate =
      fieldMap.match === null
        ? null
        : makeMatchCandidate({
            row: typedPayload,
            rowNumber,
            provider: capability.provider,
            competition: table.authorizationCompetition,
            seasonYear: table.authorizationSeason,
            captureReceiptSha256: table.captureReceiptSha256,
            interpretationSha256,
            bindings: fieldMap.match,
            issues,
          });
    const identityCandidate =
      fieldMap.identity === null
        ? null
        : makeIdentityCandidate({
            row: typedPayload,
            rowNumber,
            provider: capability.provider,
            competition: table.authorizationCompetition,
            seasonYear: table.authorizationSeason,
            captureReceiptSha256: table.captureReceiptSha256,
            interpretationSha256,
            bindings: fieldMap.identity,
            issues,
          });
    const metricCandidates = fieldMap.metrics.map((binding) =>
      makeMetricCandidate({ row: typedPayload, rowNumber, binding, issues })
    );
    const achievementCandidate =
      fieldMap.achievement === null
        ? null
        : {
            candidateId: `achievement-candidate:${sha256({
              captureReceiptSha256: table.captureReceiptSha256,
              interpretationSha256,
              rowNumber,
              achievementCode: fieldMap.achievement.achievementCode,
            })}`,
            achievementCode: fieldMap.achievement.achievementCode,
            evidenceValue: optionalText(typedPayload, fieldMap.achievement.evidenceField),
            resolutionState: 'unresolved' as const,
          };
    const naturalKey = sha256({
      provider: capability.provider,
      competition: table.authorizationCompetition,
      authorizationSeason: table.authorizationSeason,
      capabilityId: table.capabilityId,
      reviewedComponents: fieldMap.naturalKeyFields.map((field) => ({
        field,
        value: typedPayload[field],
      })),
    });
    for (const field of fieldMap.naturalKeyFields) {
      if (optionalText(typedPayload, field) === null) {
        issues.push({
          rowNumber,
          code: 'natural_key_component_missing',
          field,
          message: `Reviewed natural-key field ${field} is missing.`,
        });
      }
    }
    return {
      providerDecodedRowId: `provider-row:${sha256({
        captureReceiptSha256: table.captureReceiptSha256,
        interpretationSha256,
        rowNumber,
        sourceRowSha256,
      })}`,
      competition: table.authorizationCompetition,
      seasonYear: table.authorizationSeason,
      observedSeasonText,
      roundLabel: optionalText(typedPayload, fieldMap.roundLabelField?.sourceField ?? null),
      observedDateText: optionalText(typedPayload, fieldMap.observedDateField?.sourceField ?? null),
      sourceRowNumber: rowNumber,
      sourceRowSha256,
      rowStatus: issues.length === rowIssueStart ? 'staged' : 'needs_review',
      typedPayload,
      identityCandidate,
      matchCandidate,
      metricCandidates,
      achievementCandidate,
      appearanceCandidate:
        fieldMap.observationKind === 'player_stat' &&
        matchCandidate !== null &&
        (capability.metrics as readonly string[]).includes('match_appearance'),
      semanticNaturalKeySha256: naturalKey,
    };
  });

  const naturalKeyRows = new Map<string, number[]>();
  for (const row of rows) {
    if (row.semanticNaturalKeySha256 === null) continue;
    const existing = naturalKeyRows.get(row.semanticNaturalKeySha256) ?? [];
    existing.push(row.sourceRowNumber);
    naturalKeyRows.set(row.semanticNaturalKeySha256, existing);
  }
  for (const duplicateRows of naturalKeyRows.values()) {
    if (duplicateRows.length < 2) continue;
    for (const rowNumber of duplicateRows) {
      issues.push({
        rowNumber,
        code: 'duplicate_natural_key',
        field: null,
        message: `Semantic provider key is duplicated on source rows ${duplicateRows.join(', ')}.`,
      });
      const row = rows[rowNumber - 1];
      if (row !== undefined) row.rowStatus = 'needs_review';
    }
  }

  const quarantinedRowCount = rows.filter((row) => row.rowStatus === 'needs_review').length;
  return {
    receipt: {
      schemaVersion: AFL_TRADE_FITZROY_NORMALIZATION_RECEIPT_SCHEMA_VERSION,
      normalizerVersion: AFL_TRADE_FITZROY_NORMALIZER_VERSION,
      captureReceiptSha256: table.captureReceiptSha256,
      invocationSha256: table.invocationSha256,
      invocationArgumentsSha256: table.invocationArgumentsSha256,
      diagnosticsSha256: table.diagnosticsSha256,
      decodedSha256: input.decodedSha256,
      sourceRdsSha256: table.sourceRdsSha256,
      sourceSchemaSha256: table.sourceSchemaSha256,
      fieldMapSha256,
      capabilityId: table.capabilityId,
      provider: capability.provider,
      competition: table.authorizationCompetition,
      authorizationSeason: table.authorizationSeason,
      sourceRowCount: rows.length,
      acceptedRowCount: rows.length - quarantinedRowCount,
      quarantinedRowCount,
      issueCount: issues.length,
      status: issues.length === 0 ? 'candidate' : 'quarantined',
      publicationEligible: false,
      canonicalIdentityResolutionPerformed: false,
    },
    rows,
    issues,
  };
}
