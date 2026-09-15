import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradePostseasonSeasonWindow,
  aflTradePostseasonYearContextSchema,
} from '../domain/postseasonYearContext';
import {
  aflTradeAcquisitionSpellRegistrationSchema,
  deriveAflTradeAcquisitionMembershipBounds,
} from '../outcomes/acquisitionSpellRegistrationContracts';
import { aflTradePlayerPavValueSchema } from './playerPavObservationContracts';

const measured = z
  .object({
    seasonYear: z.number().int(),
    values: z.array(aflTradePlayerPavValueSchema).min(1).max(50),
    coverageEvidence: aflTradeArtifactRefSchema,
  })
  .strict();
const annual = z.discriminatedUnion('state', [
  measured.extend({ state: z.literal('observed') }),
  measured.extend({ state: z.literal('partial') }),
  z
    .object({
      seasonYear: z.number().int(),
      state: z.literal('unavailable'),
      reason: z.enum([
        'source_missing',
        'season_incomplete',
        'membership_incomplete',
        'historical_contract_unsupported',
      ]),
    })
    .strict(),
]);

/** Versioned structural input; persistence must separately authenticate release, calculations and current spell authority. */
export const aflTradePostseasonPlayerPavObservationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-pav-observation/v3'),
    context: aflTradePostseasonYearContextSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    acquisitionSpell: aflTradeAcquisitionSpellRegistrationSchema,
    historySeasons: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    features: z.array(annual).min(1).max(3),
    outcomes: z.array(annual).length(3),
  })
  .strict()
  .superRefine((record, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const context = record.context.content;
    const spell = record.acquisitionSpell.content;
    const window = aflTradePostseasonSeasonWindow(record.context, record.historySeasons);
    const cutoff = Date.parse(context.knowledgeCutoffAt);
    const bounds = deriveAflTradeAcquisitionMembershipBounds(record.acquisitionSpell);
    const entryYear =
      spell.entry.eventDate?.slice(0, 4) ??
      ('datePrecision' in spell.entry ? spell.entry.datePrecision.earliestDate.slice(0, 4) : null);
    const entryLastYear =
      spell.entry.eventDate?.slice(0, 4) ??
      ('datePrecision' in spell.entry ? spell.entry.datePrecision.latestDate.slice(0, 4) : null);
    if (
      spell.environment !== context.environment ||
      spell.competition !== context.competition ||
      spell.entry.promotionId !== context.promotionId ||
      spell.entry.eventVersionId !== context.eventVersionId ||
      (spell.entry.eventDate !== null && spell.entry.eventDate !== context.tradeDate) ||
      entryYear !== String(context.tradeYear) ||
      entryLastYear !== String(context.tradeYear) ||
      (context.tradeDate !== null &&
        (context.tradeDate < bounds.possible.startDate ||
          context.tradeDate > bounds.certain.startDate)) ||
      Date.parse(spell.createdAt) > cutoff
    ) {
      issue(
        'Acquisition must match the reviewed trade, scope, date bounds and reconstruction cutoff.'
      );
    }
    const calculations = new Map<string, string>();
    for (const [kind, seasons, expected] of [
      ['features', record.features, window.featureSeasons],
      ['outcomes', record.outcomes, window.outcomeSeasons],
    ] as const) {
      if (
        seasons.length !== expected.length ||
        seasons.some((season, i) => season.seasonYear !== expected[i])
      ) {
        issue(
          'Annual records must cover the exact ordered history or original three-season outcome window.'
        );
      }
      for (const season of seasons) {
        if (season.state === 'unavailable') continue;
        if (kind === 'features' && season.state !== 'observed')
          issue('Incomplete seasons cannot enter completed-season features.');
        if (Date.parse(season.coverageEvidence.createdAt) > cutoff)
          issue('Coverage evidence exceeds the reconstruction cutoff.');
        const keys = season.values.map((value) => `${value.seasonYear}|${value.spellVersionId}`);
        if (new Set(keys).size !== keys.length)
          issue('A season cannot duplicate a player spell contribution.');
        for (const value of season.values) {
          const binding = JSON.stringify([
            value.seasonYear,
            value.effectiveThrough,
            value.calculatedAt,
          ]);
          const previous = calculations.get(value.calculationId);
          if (previous !== undefined && previous !== binding)
            issue('One calculation cannot identify conflicting season metadata.');
          calculations.set(value.calculationId, binding);
          if (
            value.playerId !== spell.playerId ||
            value.seasonYear !== season.seasonYear ||
            Date.parse(value.calculatedAt) > cutoff
          ) {
            issue('PAV values must match the player, annual season and recording cutoff.');
          }
          if (
            kind === 'outcomes' &&
            (value.clubId !== spell.clubId ||
              value.spellVersionId !== record.acquisitionSpell.spellVersionId ||
              `${season.seasonYear}-01-01` < bounds.certain.startDate ||
              value.effectiveThrough.slice(0, 10) > bounds.certain.endDate)
          ) {
            issue('Outcome values must belong to the receiving spell within evidenced membership.');
          }
        }
        if (
          kind === 'outcomes' &&
          season.state === 'observed' &&
          `${season.seasonYear}-12-31` > bounds.certain.endDate
        ) {
          issue(
            'Incomplete membership requires partial or unavailable outcomes, never a complete season or invented zero.'
          );
        }
      }
    }
  });

export const aflTradePostseasonPlayerPavObservationSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('player-pav-observation'),
    content: aflTradePostseasonPlayerPavObservationContentSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    addAflTradeContentAddressIssue(
      'player-pav-observation',
      record.observationId,
      record.content,
      ctx,
      ['observationId']
    );
  });

export function createAflTradePostseasonPlayerPavObservation(
  input: Omit<z.input<typeof aflTradePostseasonPlayerPavObservationContentSchema>, 'schemaVersion'>
) {
  const content = aflTradePostseasonPlayerPavObservationContentSchema.parse({
    ...input,
    schemaVersion: 'afl-trade-player-pav-observation/v3',
  });
  return aflTradePostseasonPlayerPavObservationSchema.parse({
    observationId: createAflTradeContentAddress('player-pav-observation', content),
    content,
  });
}
