import { z } from 'zod';

import { aflTradePostseasonValuationCaseSchema } from './postseasonValuationCase';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

export const aflTradeAnyValuationCaseSchema = z.union([
  aflTradeValuationCaseSchema,
  aflTradePostseasonValuationCaseSchema,
]);

export type AflTradeAnyValuationCase = z.infer<typeof aflTradeAnyValuationCaseSchema>;
export type AflTradePostseasonValuationCase = z.infer<typeof aflTradePostseasonValuationCaseSchema>;

export function isAflTradePostseasonValuationCase(
  valuationCase: AflTradeAnyValuationCase
): valuationCase is AflTradePostseasonValuationCase {
  return valuationCase.content.schemaVersion === 'afl-trade-valuation-case/v2';
}

export function valuationCaseAssessmentInstants(
  valuationCase: AflTradeAnyValuationCase
): readonly string[] {
  return isAflTradePostseasonValuationCase(valuationCase)
    ? [valuationCase.content.laterAssessment.valuationAsOf]
    : valuationCase.content.viewContexts.map(({ valuationAsOf }) => valuationAsOf);
}

export type { AflTradeValuationCase };
