import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from './automatedPrivateEvaluationPolicy';

export const AFL_TRADE_PRIVATE_VALUATION_SOURCE_ADMISSION_SCHEMA_VERSION =
  'afl-trade-private-valuation-source-admission/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_SOURCE_ADMISSION_LIMITATION =
  'Non-production private-calculation source admission only; it grants no model, public-display, redistribution, publication, or production authority.' as const;

const instantSchema = z.string().datetime({ offset: true });

export const aflTradePrivateValuationSourceAdmissionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_SOURCE_ADMISSION_SCHEMA_VERSION),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    captureBindingId: aflTradeContentAddressedIdSchema('private-valuation-capture-binding'),
    sourceCaptureId: aflTradeContentAddressedIdSchema('source-capture'),
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    factBatchId: aflTradeContentAddressedIdSchema('source-fact-batch'),
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    admittedAt: instantSchema,
    principalId: z.literal(AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_PRIVATE_VALUATION_SOURCE_ADMISSION_LIMITATION),
  })
  .strict();

export const aflTradePrivateValuationSourceAdmissionSchema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('private-valuation-source-admission'),
    content: aflTradePrivateValuationSourceAdmissionContentSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-source-admission',
      admission.admissionId,
      admission.content,
      context,
      ['admissionId']
    );
  });

export type AflTradePrivateValuationSourceAdmission = z.infer<
  typeof aflTradePrivateValuationSourceAdmissionSchema
>;

export function createAflTradePrivateValuationSourceAdmission(
  input: Omit<
    z.input<typeof aflTradePrivateValuationSourceAdmissionContentSchema>,
    | 'schemaVersion'
    | 'principalId'
    | 'environment'
    | 'publicationEligible'
    | 'publicationProhibited'
    | 'limitation'
  >
): AflTradePrivateValuationSourceAdmission {
  const content = aflTradePrivateValuationSourceAdmissionContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_SOURCE_ADMISSION_SCHEMA_VERSION,
    ...input,
    principalId: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_PRIVATE_VALUATION_SOURCE_ADMISSION_LIMITATION,
  });
  return aflTradePrivateValuationSourceAdmissionSchema.parse({
    admissionId: createAflTradeContentAddress('private-valuation-source-admission', content),
    content,
  });
}

export function parseAflTradePrivateValuationSourceAdmission(
  value: unknown
): AflTradePrivateValuationSourceAdmission {
  return aflTradePrivateValuationSourceAdmissionSchema.parse(value);
}
