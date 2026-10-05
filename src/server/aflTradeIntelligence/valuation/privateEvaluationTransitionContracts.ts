import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  governedPrivateEvaluationSelectorSchema,
  privateEvaluationHeadGuardSchema,
  privateEvaluationOperatorReviewSchema,
} from './governedPrivateTradeEvaluationContracts';

export const PRIVATE_EVALUATION_TRANSITION_INTENT_SCHEMA_VERSION =
  'private-evaluation-transition-intent/v1' as const;
export const PRIVATE_EVALUATION_TRANSITION_RECEIPT_SCHEMA_VERSION =
  'private-evaluation-transition-receipt/v1' as const;

const LIMITATION =
  'Append-only private local non-production lifecycle evidence only; it grants no model, factual, publication, production, or fantasy-state authority.' as const;
const instantSchema = z.iso.datetime({ offset: true });
const generationIdSchema = aflTradeContentAddressedIdSchema(
  'local-private-trade-evaluation-generation'
);
const authoritySnapshotIdSchema = aflTradeContentAddressedIdSchema(
  'private-evaluation-authority-snapshot'
);
const inspectionReceiptIdSchema = aflTradeContentAddressedIdSchema(
  'private-evaluation-inspection'
);
const transitionActionSchema = z.enum([
  'construct_and_activate',
  'recover',
  'rollback',
  'withdraw',
]);

const transitionIntentContentSchema = z
  .object({
    schemaVersion: z.literal(PRIVATE_EVALUATION_TRANSITION_INTENT_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    action: transitionActionSchema,
    selector: governedPrivateEvaluationSelectorSchema,
    expectedHead: privateEvaluationHeadGuardSchema,
    targetGenerationId: generationIdSchema.nullable(),
    authoritySnapshotId: authoritySnapshotIdSchema.nullable(),
    inspectionReceiptId: inspectionReceiptIdSchema.nullable(),
    reason: z.string().trim().min(1).max(2_000).nullable(),
    operator: privateEvaluationOperatorReviewSchema,
    requestedAt: instantSchema,
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((intent, context) => {
    const requiresReviewedAuthority = intent.action !== 'withdraw';
    if (
      requiresReviewedAuthority &&
      (intent.authoritySnapshotId === null || intent.inspectionReceiptId === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authoritySnapshotId'],
        message: 'This transition requires an exact authority snapshot and inspection receipt.',
      });
    }
    if (
      !requiresReviewedAuthority &&
      (intent.authoritySnapshotId !== null || intent.inspectionReceiptId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authoritySnapshotId'],
        message: 'Withdrawal must not relabel a retained authority review as transition authority.',
      });
    }
    if (
      (intent.action === 'rollback') !== (intent.targetGenerationId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetGenerationId'],
        message: 'Only rollback requires one exact target generation.',
      });
    }
    if ((intent.action === 'withdraw') !== (intent.reason !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Only withdrawal requires an operator reason.',
      });
    }
    if (intent.action === 'withdraw' && intent.expectedHead.status !== 'active') {
      context.addIssue({
        code: 'custom',
        path: ['expectedHead'],
        message: 'Withdrawal requires an exact active generation head.',
      });
    }
  });

export const privateEvaluationTransitionIntentSchema = z
  .object({
    intentId: aflTradeContentAddressedIdSchema('private-evaluation-transition-intent'),
    content: transitionIntentContentSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-transition-intent',
      intent.intentId,
      intent.content,
      context,
      ['intentId']
    );
  });

export type PrivateEvaluationTransitionIntent = z.infer<
  typeof privateEvaluationTransitionIntentSchema
>;

export function createPrivateEvaluationTransitionIntent(
  input: Omit<
    z.input<typeof transitionIntentContentSchema>,
    | 'schemaVersion'
    | 'environment'
    | 'publicationEligible'
    | 'publicationProhibited'
    | 'limitation'
  >
): PrivateEvaluationTransitionIntent {
  const content = transitionIntentContentSchema.parse({
    schemaVersion: PRIVATE_EVALUATION_TRANSITION_INTENT_SCHEMA_VERSION,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    ...input,
    limitation: LIMITATION,
  });
  return privateEvaluationTransitionIntentSchema.parse({
    intentId: createAflTradeContentAddress('private-evaluation-transition-intent', content),
    content,
  });
}

const transitionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal(PRIVATE_EVALUATION_TRANSITION_RECEIPT_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    intentId: aflTradeContentAddressedIdSchema('private-evaluation-transition-intent'),
    intent: privateEvaluationTransitionIntentSchema,
    action: transitionActionSchema,
    selector: governedPrivateEvaluationSelectorSchema,
    previousReceiptId: aflTradeContentAddressedIdSchema(
      'private-evaluation-transition-receipt'
    ).nullable(),
    generationId: generationIdSchema.nullable(),
    authoritySnapshotId: authoritySnapshotIdSchema.nullable(),
    fromHead: privateEvaluationHeadGuardSchema,
    toHead: privateEvaluationHeadGuardSchema,
    changedAt: instantSchema,
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((receipt, context) => {
    const intent = receipt.intent.content;
    if (
      receipt.intentId !== receipt.intent.intentId ||
      receipt.action !== intent.action ||
      receipt.selector.valuationScopeKey !== intent.selector.valuationScopeKey ||
      receipt.selector.tradeId !== intent.selector.tradeId ||
      receipt.fromHead.generationId !== intent.expectedHead.generationId ||
      receipt.fromHead.revision !== intent.expectedHead.revision ||
      receipt.fromHead.status !== intent.expectedHead.status ||
      receipt.authoritySnapshotId !== intent.authoritySnapshotId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['intent'],
        message: 'A transition receipt must exactly bind its retained intent and expected head.',
      });
    }
    if (
      receipt.toHead.revision !== receipt.fromHead.revision + 1 ||
      Date.parse(receipt.changedAt) < Date.parse(intent.requestedAt) ||
      (receipt.fromHead.revision === 0) !== (receipt.previousReceiptId === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toHead'],
        message:
          'A transition receipt must advance one revision, preserve chain ancestry, and follow its intent.',
      });
    }
    if (receipt.action === 'withdraw') {
      if (
        receipt.generationId !== null ||
        receipt.authoritySnapshotId !== null ||
        receipt.toHead.status !== 'withdrawn' ||
        receipt.toHead.generationId !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['generationId'],
          message: 'Withdrawal must remove the current generation without authority relabelling.',
        });
      }
      return;
    }
    if (
      receipt.generationId === null ||
      receipt.authoritySnapshotId === null ||
      receipt.toHead.status !== 'active' ||
      receipt.toHead.generationId !== receipt.generationId ||
      (receipt.action === 'rollback' &&
        receipt.generationId !== intent.targetGenerationId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['generationId'],
        message: 'An activating transition must bind its exact generation and reviewed authority.',
      });
    }
  });

export const privateEvaluationTransitionReceiptSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('private-evaluation-transition-receipt'),
    content: transitionReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-transition-receipt',
      receipt.receiptId,
      receipt.content,
      context,
      ['receiptId']
    );
  });

export type PrivateEvaluationTransitionReceipt = z.infer<
  typeof privateEvaluationTransitionReceiptSchema
>;

export function createPrivateEvaluationTransitionReceipt(input: {
  readonly intent: PrivateEvaluationTransitionIntent;
  readonly previousReceiptId: string | null;
  readonly generationId: string | null;
  readonly authoritySnapshotId: string | null;
  readonly fromHead: z.input<typeof privateEvaluationHeadGuardSchema>;
  readonly toHead: z.input<typeof privateEvaluationHeadGuardSchema>;
  readonly changedAt: string;
}): PrivateEvaluationTransitionReceipt {
  const intent = privateEvaluationTransitionIntentSchema.parse(input.intent);
  const content = transitionReceiptContentSchema.parse({
    schemaVersion: PRIVATE_EVALUATION_TRANSITION_RECEIPT_SCHEMA_VERSION,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    intentId: intent.intentId,
    intent,
    action: intent.content.action,
    selector: intent.content.selector,
    previousReceiptId: input.previousReceiptId,
    generationId: input.generationId,
    authoritySnapshotId: input.authoritySnapshotId,
    fromHead: input.fromHead,
    toHead: input.toHead,
    changedAt: input.changedAt,
    limitation: LIMITATION,
  });
  return privateEvaluationTransitionReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('private-evaluation-transition-receipt', content),
    content,
  });
}
