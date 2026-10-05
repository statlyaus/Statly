import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const LOCAL_WORKBOOK_PICK_SELECTION_CONFIRMATION_SCHEMA_VERSION =
  'local-workbook-pick-selection-confirmation/v1' as const;

const boundedText = z.string().trim().min(1).max(2_000);
const publicId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const sortedUniqueIds = z
  .array(publicId)
  .min(1)
  .max(10_000)
  .superRefine((values, context) => {
    if (
      new Set(values).size !== values.length ||
      values.some((value, index) => index > 0 && values[index - 1]! > value)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Evidence identities must be unique and canonically ordered.',
      });
    }
  });

const contentSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_WORKBOOK_PICK_SELECTION_CONFIRMATION_SCHEMA_VERSION),
    workbookSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    valuationScopeKey: publicId,
    tradeId: publicId,
    assetId: publicId,
    assetKind: z.enum(['pick', 'future_pick']),
    sourceAssetText: boundedText,
    receivingClubName: boundedText,
    tradeYear: z.number().int().min(1897).max(2200),
    draftYear: z.number().int().min(1897).max(2200),
    selectionNumber: z.number().int().positive().max(10_000),
    draftedPlayerName: boundedText,
    canonicalPlayerId: publicId,
    recordedName: boundedText,
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    identityDecisionIds: sortedUniqueIds,
    reviewedSeasonIds: sortedUniqueIds,
    reviewerId: publicId,
    rationale: boundedText,
    reviewedAt: z.iso.datetime({ offset: true }),
    authority: z.literal('private_local_workbook_pick_selection_confirmation'),
    numericalAuthority: z.literal('none'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.valuationScopeKey !== `afl-men:${content.tradeYear}-trades`) {
      context.addIssue({
        code: 'custom',
        path: ['valuationScopeKey'],
        message: 'Pick-selection confirmation scope must match the workbook trade year.',
      });
    }
    if (
      (content.assetKind === 'pick' && content.draftYear !== content.tradeYear) ||
      (content.assetKind === 'future_pick' && content.draftYear <= content.tradeYear)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['draftYear'],
        message: 'Draft year must match the temporal meaning of the traded pick entitlement.',
      });
    }
  });

const confirmationSchema = z
  .object({
    confirmationId: aflTradeContentAddressedIdSchema(
      'local-workbook-pick-selection-confirmation'
    ),
    content: contentSchema,
  })
  .strict()
  .superRefine((confirmation, context) => {
    addAflTradeContentAddressIssue(
      'local-workbook-pick-selection-confirmation',
      confirmation.confirmationId,
      confirmation.content,
      context,
      ['confirmationId']
    );
  });

export type LocalWorkbookPickSelectionConfirmation = z.infer<typeof confirmationSchema>;

export function createLocalWorkbookPickSelectionConfirmation(
  input: Omit<
    LocalWorkbookPickSelectionConfirmation['content'],
    | 'schemaVersion'
    | 'authority'
    | 'numericalAuthority'
    | 'publicationEligible'
    | 'publicationProhibited'
  >
): LocalWorkbookPickSelectionConfirmation {
  const content = contentSchema.parse({
    schemaVersion: LOCAL_WORKBOOK_PICK_SELECTION_CONFIRMATION_SCHEMA_VERSION,
    ...input,
    identityDecisionIds: [...input.identityDecisionIds].sort(),
    reviewedSeasonIds: [...input.reviewedSeasonIds].sort(),
    authority: 'private_local_workbook_pick_selection_confirmation',
    numericalAuthority: 'none',
    publicationEligible: false,
    publicationProhibited: true,
  });
  return confirmationSchema.parse({
    confirmationId: createAflTradeContentAddress(
      'local-workbook-pick-selection-confirmation',
      content
    ),
    content,
  });
}

export function parseLocalWorkbookPickSelectionConfirmation(
  input: unknown
): LocalWorkbookPickSelectionConfirmation {
  const parsed = confirmationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError('Local workbook pick-selection confirmation failed exact authentication.');
  }
  return parsed.data;
}
