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

const observationContent = z
  .object({
    schemaVersion: z.literal('afl-trade-player-pav-observation/v3'),
    context: aflTradePostseasonYearContextSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    acquisitionSpell: aflTradeAcquisitionSpellRegistrationSchema,
    historySeasons: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    features: z.array(annual).min(1).max(3),
    outcomes: z.array(annual).length(3),
  })
  .strict();

type Observation = z.infer<typeof observationContent>;
type Season = z.infer<typeof annual>;
type Value = z.infer<typeof aflTradePlayerPavValueSchema>;
type Kind = 'features' | 'outcomes';
interface Validation {
  record: Observation;
  cutoff: number;
  bounds: ReturnType<typeof deriveAflTradeAcquisitionMembershipBounds>;
  calculations: Map<string, string>;
  issue: (message: string) => void;
}

function hasCompatibleTradeDate({ record, bounds }: Validation): boolean {
  const knownEntry = record.acquisitionSpell.content.entry.eventDate;
  const tradeDate = record.context.content.tradeDate;
  if (knownEntry !== null) return knownEntry === tradeDate;
  if (tradeDate === null) return true;
  return tradeDate >= bounds.possible.startDate && tradeDate <= bounds.certain.startDate;
}

function validateAcquisition(check: Validation): void {
  const { record, bounds, cutoff, issue } = check;
  const context = record.context.content;
  const spell = record.acquisitionSpell.content;
  const bindingMatches =
    spell.environment === context.environment &&
    spell.competition === context.competition &&
    spell.entry.promotionId === context.promotionId &&
    spell.entry.eventVersionId === context.eventVersionId;
  const year = String(context.tradeYear);
  const datesMatch =
    bounds.possible.startDate.slice(0, 4) === year &&
    bounds.certain.startDate.slice(0, 4) === year &&
    hasCompatibleTradeDate(check);
  if (!bindingMatches || !datesMatch || Date.parse(spell.createdAt) > cutoff) {
    issue(
      'Acquisition must match the reviewed trade, scope, date bounds and reconstruction cutoff.'
    );
  }
}

function validateCalculation(value: Value, check: Validation): void {
  const binding = JSON.stringify([value.seasonYear, value.effectiveThrough, value.calculatedAt]);
  const previous = check.calculations.get(value.calculationId);
  if (previous !== undefined && previous !== binding) {
    check.issue('One calculation cannot identify conflicting season metadata.');
  }
  check.calculations.set(value.calculationId, binding);
}

function validateValue(value: Value, seasonYear: number, kind: Kind, check: Validation): void {
  const { record, bounds, cutoff, issue } = check;
  const spell = record.acquisitionSpell.content;
  validateCalculation(value, check);
  if (
    value.playerId !== spell.playerId ||
    value.seasonYear !== seasonYear ||
    Date.parse(value.calculatedAt) > cutoff
  ) {
    issue('PAV values must match the player, annual season and recording cutoff.');
  }
  if (kind !== 'outcomes') return;
  if (
    value.clubId !== spell.clubId ||
    value.spellVersionId !== record.acquisitionSpell.spellVersionId ||
    `${seasonYear}-01-01` < bounds.certain.startDate ||
    `${seasonYear}-01-01` > bounds.certain.endDate
  ) {
    issue('Outcome values must belong to the receiving spell within evidenced membership.');
  }
}

function validateSeason(season: Season, kind: Kind, check: Validation): void {
  if (season.state === 'unavailable') return;
  const { issue, cutoff, bounds } = check;
  if (kind === 'features' && season.state !== 'observed') {
    issue('Incomplete seasons cannot enter completed-season features.');
  }
  if (Date.parse(season.coverageEvidence.createdAt) > cutoff) {
    issue('Coverage evidence exceeds the reconstruction cutoff.');
  }
  const keys = season.values.map((value) => `${value.seasonYear}|${value.spellVersionId}`);
  if (new Set(keys).size !== keys.length)
    issue('A season cannot duplicate a player spell contribution.');
  for (const value of season.values) validateValue(value, season.seasonYear, kind, check);
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

function validateWindow(
  seasons: Season[],
  expected: number[],
  kind: Kind,
  check: Validation
): void {
  if (
    seasons.length !== expected.length ||
    seasons.some((season, i) => season.seasonYear !== expected[i])
  ) {
    check.issue(
      'Annual records must cover the exact ordered history or original three-season outcome window.'
    );
  }
  for (const season of seasons) validateSeason(season, kind, check);
}

/** Versioned structural input; persistence must separately authenticate release, calculations and current spell authority. */
export const aflTradePostseasonPlayerPavObservationContentSchema = observationContent.superRefine(
  (record, ctx) => {
    const check: Validation = {
      record,
      cutoff: Date.parse(record.context.content.knowledgeCutoffAt),
      bounds: deriveAflTradeAcquisitionMembershipBounds(record.acquisitionSpell),
      calculations: new Map(),
      issue: (message) => ctx.addIssue({ code: 'custom', message }),
    };
    validateAcquisition(check);
    const window = aflTradePostseasonSeasonWindow(record.context, record.historySeasons);
    validateWindow(record.features, window.featureSeasons, 'features', check);
    validateWindow(record.outcomes, window.outcomeSeasons, 'outcomes', check);
  }
);

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
