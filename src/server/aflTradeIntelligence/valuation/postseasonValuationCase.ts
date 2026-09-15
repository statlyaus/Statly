import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradePostseasonYearContextSchema,
  aflTradePostseasonSeasonWindow,
} from '../domain/postseasonYearContext';
import { aflTradeValuationCaseContentSchema } from './valuationCaseContracts';

const legacy = aflTradeValuationCaseContentSchema.shape;
const instant = z.iso.datetime({ offset: true });

/** One later context structurally prevents realized/remaining/current from using different assessment dates. */
export const aflTradePostseasonValuationCaseContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-case/v2'),
    publicAssetBoundary: legacy.publicAssetBoundary,
    calculationUnit: legacy.calculationUnit,
    tradeId: legacy.tradeId,
    context: aflTradePostseasonYearContextSchema,
    valuationBundleId: legacy.valuationBundleId,
    valuationInputBundleId: legacy.valuationInputBundleId,
    lineageGraphId: legacy.lineageGraphId,
    componentDrawSetId: legacy.componentDrawSetId,
    realizedContributionLedgerId: legacy.realizedContributionLedgerId,
    packagePolicyId: legacy.packagePolicyId,
    valueUnitId: legacy.valueUnitId,
    parties: legacy.parties,
    outcomeSeasons: z.array(z.number().int()).length(3),
    laterAssessment: z
      .object({
        effectiveAt: instant,
        knowledgeCutoffAt: instant,
        valuationAsOf: instant,
      })
      .strict(),
    legacySourceMetricsTreatment: legacy.legacySourceMetricsTreatment,
  })
  .strict()
  .superRefine((record, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const context = record.context.content;
    if (record.tradeId !== context.tradeId) issue('Valuation case must bind the reviewed trade.');
    const expected = aflTradePostseasonSeasonWindow(record.context, 1).outcomeSeasons;
    if (record.outcomeSeasons.some((year, index) => year !== expected[index]))
      issue('All views must retain the original Y+1 through Y+3 window.');
    const clubs = record.parties.map((party) => party.aflClubId);
    const roots = record.parties.flatMap((party) => party.receivedRootAssetIds);
    if (
      new Set(clubs).size !== clubs.length ||
      clubs.some((club, index) => club !== [...clubs].sort()[index]) ||
      new Set(roots).size !== roots.length ||
      record.parties.some((party) =>
        party.receivedRootAssetIds.some(
          (root, index) => root !== [...party.receivedRootAssetIds].sort()[index]
        )
      )
    ) {
      issue('Parties and root assets must be unique and canonically ordered.');
    }
    const assessment = record.laterAssessment;
    // A year-only trade is certainly past only after the end of that year.
    const latestTradeDay = context.tradeDate ?? `${context.tradeYear}-12-31`;
    if (
      new Date(assessment.effectiveAt).toISOString().slice(0, 10) <= latestTradeDay ||
      Date.parse(assessment.effectiveAt) > Date.parse(assessment.valuationAsOf) ||
      Date.parse(assessment.knowledgeCutoffAt) > Date.parse(assessment.valuationAsOf) ||
      Date.parse(context.knowledgeCutoffAt) > Date.parse(assessment.knowledgeCutoffAt)
    ) {
      issue(
        'Later assessment must follow the trade bounds and include reconstruction knowledge by valuation time.'
      );
    }
  });

export const aflTradePostseasonValuationCaseSchema = z
  .object({
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    content: aflTradePostseasonValuationCaseContentSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    addAflTradeContentAddressIssue('valuation-case', record.valuationCaseId, record.content, ctx, [
      'valuationCaseId',
    ]);
  });

/** Builds a v2 contract only; legacy numerical materialization/admission must reject it until upgraded. */
export function createAflTradePostseasonValuationCase(
  input: Omit<
    z.input<typeof aflTradePostseasonValuationCaseContentSchema>,
    'schemaVersion' | 'outcomeSeasons'
  >
) {
  const context = aflTradePostseasonYearContextSchema.parse(input.context);
  const content = aflTradePostseasonValuationCaseContentSchema.parse({
    ...input,
    schemaVersion: 'afl-trade-valuation-case/v2',
    outcomeSeasons: aflTradePostseasonSeasonWindow(context, 1).outcomeSeasons,
    parties: input.parties
      .map((party) => ({ ...party, receivedRootAssetIds: [...party.receivedRootAssetIds].sort() }))
      .sort((a, b) => (a.aflClubId < b.aflClubId ? -1 : a.aflClubId > b.aflClubId ? 1 : 0)),
  });
  return aflTradePostseasonValuationCaseSchema.parse({
    valuationCaseId: createAflTradeContentAddress('valuation-case', content),
    content,
  });
}
