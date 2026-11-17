import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from './automatedPrivateEvaluationPolicy';

export const AFL_TRADE_PRIVATE_VALUATION_HPN_SOURCE_ADMISSION_SCHEMA_VERSION =
  'afl-trade-private-valuation-hpn-source-admission/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_HPN_SOURCE_ADMISSION_LIMITATION =
  'Non-production private HPN source admission only; it grants no factual, model-training, public-display, redistribution, publication, production, or activation authority.' as const;

const instantSchema = z.string().datetime({ offset: true });

export const aflTradePrivateValuationHpnSourceRoleSchema = z.enum([
  'hpn_completed_results',
  'hpn_primary_player_stats',
  'hpn_corroborating_player_stats',
]);

export const aflTradePrivateValuationHpnSourceAdmissionContentSchema = z
  .object({
    schemaVersion: z.literal(
      AFL_TRADE_PRIVATE_VALUATION_HPN_SOURCE_ADMISSION_SCHEMA_VERSION
    ),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    dispatchClaimId: aflTradeContentAddressedIdSchema(
      'private-valuation-dispatch-claim'
    ),
    attemptSequence: z.number().int().positive(),
    attemptNumber: z.number().int().min(1).max(3),
    sourceRole: aflTradePrivateValuationHpnSourceRoleSchema,
    captureBindingId: aflTradeContentAddressedIdSchema(
      'private-valuation-capture-binding'
    ),
    sourceCaptureId: aflTradeContentAddressedIdSchema('source-capture'),
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    projectedFieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    admittedAt: instantSchema,
    principalId: z.literal(AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_PRIVATE_VALUATION_HPN_SOURCE_ADMISSION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.attemptNumber > content.attemptSequence) {
      context.addIssue({
        code: 'custom',
        path: ['attemptNumber'],
        message: 'The technical attempt number cannot exceed its dispatch claim sequence.',
      });
    }
  });

export const aflTradePrivateValuationHpnSourceAdmissionSchema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema(
      'private-valuation-hpn-source-admission'
    ),
    content: aflTradePrivateValuationHpnSourceAdmissionContentSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-hpn-source-admission',
      admission.admissionId,
      admission.content,
      context,
      ['admissionId']
    );
  });

export type AflTradePrivateValuationHpnSourceRole = z.infer<
  typeof aflTradePrivateValuationHpnSourceRoleSchema
>;
export type AflTradePrivateValuationHpnSourceAdmission = z.infer<
  typeof aflTradePrivateValuationHpnSourceAdmissionSchema
>;

export function createAflTradePrivateValuationHpnSourceAdmission(
  input: Omit<
    z.input<typeof aflTradePrivateValuationHpnSourceAdmissionContentSchema>,
    | 'schemaVersion'
    | 'principalId'
    | 'environment'
    | 'publicationEligible'
    | 'publicationProhibited'
    | 'limitation'
  >
): AflTradePrivateValuationHpnSourceAdmission {
  const content = aflTradePrivateValuationHpnSourceAdmissionContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_HPN_SOURCE_ADMISSION_SCHEMA_VERSION,
    ...input,
    principalId: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_PRIVATE_VALUATION_HPN_SOURCE_ADMISSION_LIMITATION,
  });
  return aflTradePrivateValuationHpnSourceAdmissionSchema.parse({
    admissionId: createAflTradeContentAddress(
      'private-valuation-hpn-source-admission',
      content
    ),
    content,
  });
}

export function parseAflTradePrivateValuationHpnSourceAdmission(
  value: unknown
): AflTradePrivateValuationHpnSourceAdmission {
  return aflTradePrivateValuationHpnSourceAdmissionSchema.parse(value);
}
