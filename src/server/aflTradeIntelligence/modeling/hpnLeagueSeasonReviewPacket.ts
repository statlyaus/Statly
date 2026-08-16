import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeHpnCalculationEligibilityReportSchema,
  aflTradeHpnCalculationMethodSelectionSchema,
  type AflTradeHpnCalculationEligibilityReport,
  type AflTradeHpnCalculationMethodSelection,
} from './hpnCalculationEligibility';

export const AFL_TRADE_HPN_LEAGUE_SEASON_REVIEW_PACKET_SCHEMA_VERSION =
  'afl-trade-hpn-league-season-review-packet/v2' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const slotSchema = z.enum([
  'completed_match_result',
  'primary_player_stats',
  'corroborating_player_stats',
]);
const blockerSchema = z.enum([
  'canonical_identity_not_current',
  'factual_review_not_current',
  'field_map_not_current',
  'raw_field_missing',
  'source_use_not_permitted',
  'method_not_authenticated',
]);
const fieldCountsSchema = z
  .object({
    totalFields: z.number().int().positive(),
    eligibleFields: z.number().int().nonnegative(),
    blockedFields: z.number().int().nonnegative(),
  })
  .strict();
const sourceSummarySchema = z
  .object({
    slot: slotSchema,
    selectionState: z.enum(['selected', 'missing']),
  })
  .strict();
const blockerCountSchema = z
  .object({ blocker: blockerSchema, count: z.number().int().positive() })
  .strict();
const seasonSummarySchema = z
  .object({
    seasonYear: z.number().int().min(1998).max(2200),
    eligibilityReportId: aflTradeContentAddressedIdSchema(
      'hpn-calculation-eligibility'
    ),
    eligibilityReportArtifact: aflTradeArtifactRefSchema,
    state: z.enum(['eligible', 'blocked']),
    sources: z.array(sourceSummarySchema).length(3),
    counts: fieldCountsSchema,
    blockerCounts: z.array(blockerCountSchema).max(6),
  })
  .strict();
const missingSourceSchema = z
  .object({ seasonYear: z.number().int(), slot: slotSchema })
  .strict();

function slotFor(source: {
  inputKind: 'completed_match_result' | 'player_match_stats';
  role: 'primary' | 'corroborating' | null;
}) {
  if (source.inputKind === 'completed_match_result') return 'completed_match_result' as const;
  return source.role === 'primary'
    ? ('primary_player_stats' as const)
    : ('corroborating_player_stats' as const);
}

function expectedSeasons(fromSeason: number, throughSeason: number): number[] {
  if (throughSeason < fromSeason) {
    throw new TypeError('The HPN review season range cannot run backwards.');
  }
  return Array.from({ length: throughSeason - fromSeason + 1 }, (_, index) => fromSeason + index);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_LEAGUE_SEASON_REVIEW_PACKET_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    purpose: z.literal('private_confirmed_realized_hpn_pav_review'),
    valuationScopeKey: publicIdSchema,
    competition: z.literal('AFLM'),
    fromSeason: z.number().int().min(1998).max(2200),
    throughSeason: z.number().int().min(1998).max(2200),
    methodSelection: aflTradeHpnCalculationMethodSelectionSchema,
    seasons: z.array(seasonSummarySchema).min(1).max(50),
    missingSources: z.array(missingSourceSchema).max(150),
    blockerCounts: z.array(blockerCountSchema).max(6),
    state: z.enum(['ready_for_human_review', 'blocked']),
    reviewDisposition: z.literal('requires_human_decision'),
    counts: z
      .object({
        seasonCount: z.number().int().positive(),
        eligibleSeasons: z.number().int().nonnegative(),
        blockedSeasons: z.number().int().nonnegative(),
        sourceSlots: z.number().int().positive(),
        missingSourceSlots: z.number().int().nonnegative(),
        totalFields: z.number().int().positive(),
        eligibleFields: z.number().int().nonnegative(),
        blockedFields: z.number().int().nonnegative(),
      })
      .strict(),
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Review evidence only; this packet grants no source use, factual approval, calculation, model training, publication, production, activation, or live-capture authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const expected = expectedSeasons(content.fromSeason, content.throughSeason);
    if (!sameJson(content.seasons.map(({ seasonYear }) => seasonYear), expected)) {
      context.addIssue({ code: 'custom', path: ['seasons'], message: 'Packet seasons must exactly cover the requested range.' });
    }
    const missingSources = content.seasons.flatMap((season) =>
      season.sources
        .filter(({ selectionState }) => selectionState === 'missing')
        .map(({ slot }) => ({ seasonYear: season.seasonYear, slot }))
    );
    const blockerCounts = new Map<string, number>();
    for (const season of content.seasons) {
      for (const blocker of season.blockerCounts) {
        blockerCounts.set(blocker.blocker, (blockerCounts.get(blocker.blocker) ?? 0) + blocker.count);
      }
    }
    const expectedBlockers = [...blockerCounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([blocker, count]) => ({ blocker, count }));
    const eligibleSeasons = content.seasons.filter(({ state }) => state === 'eligible').length;
    const expectedCounts = {
      seasonCount: content.seasons.length,
      eligibleSeasons,
      blockedSeasons: content.seasons.length - eligibleSeasons,
      sourceSlots: content.seasons.length * 3,
      missingSourceSlots: missingSources.length,
      totalFields: content.seasons.reduce((sum, season) => sum + season.counts.totalFields, 0),
      eligibleFields: content.seasons.reduce((sum, season) => sum + season.counts.eligibleFields, 0),
      blockedFields: content.seasons.reduce((sum, season) => sum + season.counts.blockedFields, 0),
    };
    if (
      !sameJson(content.missingSources, missingSources) ||
      !sameJson(content.blockerCounts, expectedBlockers) ||
      !sameJson(content.counts, expectedCounts) ||
      content.state !== (expectedCounts.blockedSeasons === 0 ? 'ready_for_human_review' : 'blocked')
    ) {
      context.addIssue({ code: 'custom', message: 'Packet summaries must equal the exact season reports.' });
    }
    if (content.seasons.some(({ eligibilityReportArtifact }) => Date.parse(eligibilityReportArtifact.createdAt) > Date.parse(content.createdAt))) {
      context.addIssue({ code: 'custom', message: 'Packet evidence must predate packet creation.' });
    }
  });

export const aflTradeHpnLeagueSeasonReviewPacketSchema = z
  .object({
    packetId: aflTradeContentAddressedIdSchema('hpn-league-season-review-packet'),
    content: contentSchema,
  })
  .strict()
  .superRefine((packet, context) => {
    addAflTradeContentAddressIssue(
      'hpn-league-season-review-packet',
      packet.packetId,
      packet.content,
      context,
      ['packetId']
    );
  });

export type AflTradeHpnLeagueSeasonReviewPacket = z.infer<
  typeof aflTradeHpnLeagueSeasonReviewPacketSchema
>;

function summarizeReport(
  report: AflTradeHpnCalculationEligibilityReport,
  artifact: AflTradeArtifactRef
) {
  const blockerCounts = new Map<z.infer<typeof blockerSchema>, number>();
  for (const blocker of report.content.blockers) {
    blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
  }
  for (const assessment of report.content.sources.flatMap(({ fields }) => fields)) {
    for (const blocker of assessment.blockers) {
      blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
    }
  }
  return seasonSummarySchema.parse({
    seasonYear: report.content.seasonYear,
    eligibilityReportId: report.reportId,
    eligibilityReportArtifact: artifact,
    state: report.content.state,
    sources: report.content.sources.map((source) => ({
      slot: slotFor(source),
      selectionState: source.selectionState,
    })),
    counts: report.content.counts,
    blockerCounts: [...blockerCounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([blocker, count]) => ({ blocker, count })),
  });
}

export function createAflTradeHpnLeagueSeasonReviewPacket(input: {
  readonly valuationScopeKey: string;
  readonly fromSeason: number;
  readonly throughSeason: number;
  readonly reports: readonly Readonly<{
    eligibilityReport: unknown;
    eligibilityReportArtifact: AflTradeArtifactRef;
  }>[];
  readonly createdAt: string;
}): AflTradeHpnLeagueSeasonReviewPacket {
  let methodSelection: AflTradeHpnCalculationMethodSelection | null = null;
  const reports = input.reports.map(({ eligibilityReport, eligibilityReportArtifact }) => {
    const parsed = aflTradeHpnCalculationEligibilityReportSchema.parse(eligibilityReport);
    if (!doesAflTradeArtifactRefMatchCanonicalJson(eligibilityReportArtifact, parsed)) {
      throw new TypeError('An exact eligibility-report artifact is required.');
    }
    if (parsed.content.valuationScopeKey !== input.valuationScopeKey) {
      throw new TypeError('Eligibility reports must share exact scope and method ancestry.');
    }
    if (methodSelection === null) {
      methodSelection = aflTradeHpnCalculationMethodSelectionSchema.parse(
        parsed.content.methodSelection
      );
    } else if (!sameJson(methodSelection, parsed.content.methodSelection)) {
      throw new TypeError('Eligibility reports must share exact scope and method ancestry.');
    }
    return summarizeReport(parsed, eligibilityReportArtifact);
  });
  reports.sort((left, right) => left.seasonYear - right.seasonYear);
  if (!sameJson(reports.map(({ seasonYear }) => seasonYear), expectedSeasons(input.fromSeason, input.throughSeason))) {
    throw new TypeError('The review packet must contain every requested season exactly once.');
  }
  if (methodSelection === null) {
    throw new TypeError('The review packet requires at least one exact method selection.');
  }
  const partial = {
    schemaVersion: AFL_TRADE_HPN_LEAGUE_SEASON_REVIEW_PACKET_SCHEMA_VERSION,
    environment: 'non_production' as const,
    purpose: 'private_confirmed_realized_hpn_pav_review' as const,
    valuationScopeKey: input.valuationScopeKey,
    competition: 'AFLM' as const,
    fromSeason: input.fromSeason,
    throughSeason: input.throughSeason,
    methodSelection,
    seasons: reports,
  };
  const missingSources = reports.flatMap((season) =>
    season.sources.filter(({ selectionState }) => selectionState === 'missing').map(({ slot }) => ({ seasonYear: season.seasonYear, slot }))
  );
  const blockers = new Map<string, number>();
  reports.flatMap(({ blockerCounts }) => blockerCounts).forEach(({ blocker, count }) => blockers.set(blocker, (blockers.get(blocker) ?? 0) + count));
  const eligibleSeasons = reports.filter(({ state }) => state === 'eligible').length;
  const content = contentSchema.parse({
    ...partial,
    missingSources,
    blockerCounts: [...blockers].sort(([left], [right]) => left.localeCompare(right)).map(([blocker, count]) => ({ blocker, count })),
    state: eligibleSeasons === reports.length ? 'ready_for_human_review' : 'blocked',
    reviewDisposition: 'requires_human_decision',
    counts: {
      seasonCount: reports.length,
      eligibleSeasons,
      blockedSeasons: reports.length - eligibleSeasons,
      sourceSlots: reports.length * 3,
      missingSourceSlots: missingSources.length,
      totalFields: reports.reduce((sum, report) => sum + report.counts.totalFields, 0),
      eligibleFields: reports.reduce((sum, report) => sum + report.counts.eligibleFields, 0),
      blockedFields: reports.reduce((sum, report) => sum + report.counts.blockedFields, 0),
    },
    createdAt: input.createdAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation: 'Review evidence only; this packet grants no source use, factual approval, calculation, model training, publication, production, activation, or live-capture authority.',
  });
  return aflTradeHpnLeagueSeasonReviewPacketSchema.parse({
    packetId: createAflTradeContentAddress('hpn-league-season-review-packet', content),
    content,
  });
}
