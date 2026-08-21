import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import { governedPrivateEvaluationSelectorSchema } from './governedPrivateEvaluationWorkspaceContracts';

const LIMITATION =
  'Private test-fixture lifecycle evidence only; it grants no factual, model, production, or publication authority.' as const;
const instantSchema = z.iso.datetime({ offset: true });
const generationIdSchema = aflTradeContentAddressedIdSchema(
  'local-private-trade-evaluation-generation'
);
const transitionIdSchema = aflTradeContentAddressedIdSchema(
  'private-evaluation-transition'
);

const lifecycleHeadSchema = z
  .object({
    status: z.enum(['absent', 'active', 'withdrawn']),
    revision: z.number().int().nonnegative(),
    generationId: generationIdSchema.nullable(),
  })
  .strict()
  .superRefine((head, context) => {
    if ((head.status === 'active') !== (head.generationId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['generationId'],
        message: 'Only an active lifecycle head may identify a generation.',
      });
    }
    if ((head.status === 'absent') !== (head.revision === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Only an absent lifecycle head may have revision zero.',
      });
    }
  });

const transitionActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('construct_and_activate') }).strict(),
  z
    .object({
      kind: z.literal('withdraw'),
      reason: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rollback'),
      targetGenerationId: generationIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('recover') }).strict(),
]);

const transitionIntentContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-transition-intent/v1'),
    environment: z.literal('test_fixture'),
    publicationProhibited: z.literal(true),
    selector: governedPrivateEvaluationSelectorSchema,
    inspectionId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    authoritySnapshotId: aflTradeContentAddressedIdSchema(
      'private-evaluation-authority-snapshot'
    ).nullable(),
    operationId: aflTradeContentAddressedIdSchema('private-evaluation-operation'),
    action: transitionActionSchema,
    expectedHead: lifecycleHeadSchema,
    review: z
      .object({
        principalId: z.string().trim().min(1).max(400),
        rationale: z.string().trim().min(1).max(2_000),
      })
      .strict(),
    requestedAt: instantSchema,
    expiresAt: instantSchema,
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((intent, context) => {
    const requiresAuthority = intent.action.kind !== 'withdraw';
    if (requiresAuthority !== (intent.authoritySnapshotId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['authoritySnapshotId'],
        message: 'Activating transitions require retained authority; withdrawal must not relabel it.',
      });
    }
    if (Date.parse(intent.expiresAt) <= Date.parse(intent.requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'A transition intent must have a positive trusted-time validity window.',
      });
    }
    if (intent.action.kind === 'withdraw' && intent.expectedHead.status !== 'active') {
      context.addIssue({
        code: 'custom',
        path: ['expectedHead'],
        message: 'Withdrawal requires one exact active head.',
      });
    }
    if (
      intent.action.kind === 'rollback' &&
      (intent.expectedHead.status !== 'active' ||
        intent.expectedHead.generationId === intent.action.targetGenerationId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action'],
        message: 'Rollback requires a different generation from one exact active head.',
      });
    }
    if (intent.action.kind === 'recover' && intent.expectedHead.status !== 'withdrawn') {
      context.addIssue({
        code: 'custom',
        path: ['expectedHead'],
        message: 'Recovery requires one exact withdrawn head.',
      });
    }
  });

export const governedPrivateEvaluationTransitionIntentSchema = z
  .object({
    transitionIntentId: aflTradeContentAddressedIdSchema(
      'private-evaluation-transition-intent'
    ),
    content: transitionIntentContentSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-transition-intent',
      intent.transitionIntentId,
      intent.content,
      context,
      ['transitionIntentId']
    );
  });

export type GovernedPrivateEvaluationTransitionIntent = z.infer<
  typeof governedPrivateEvaluationTransitionIntentSchema
>;

export function createGovernedPrivateEvaluationTransitionIntent(
  input: Omit<
    z.input<typeof transitionIntentContentSchema>,
    'schemaVersion' | 'environment' | 'publicationProhibited' | 'limitation'
  >
): GovernedPrivateEvaluationTransitionIntent {
  const content = transitionIntentContentSchema.parse({
    schemaVersion: 'private-evaluation-transition-intent/v1',
    environment: 'test_fixture',
    publicationProhibited: true,
    ...input,
    limitation: LIMITATION,
  });
  return governedPrivateEvaluationTransitionIntentSchema.parse({
    transitionIntentId: createAflTradeContentAddress(
      'private-evaluation-transition-intent',
      content
    ),
    content,
  });
}

const transitionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-transition-receipt/v1'),
    environment: z.literal('test_fixture'),
    publicationProhibited: z.literal(true),
    intent: governedPrivateEvaluationTransitionIntentSchema,
    selector: governedPrivateEvaluationSelectorSchema,
    action: transitionActionSchema,
    previousTransitionId: transitionIdSchema.nullable(),
    fromHead: lifecycleHeadSchema,
    toHead: lifecycleHeadSchema,
    transitionedAt: instantSchema,
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((receipt, context) => {
    const intent = receipt.intent.content;
    const inWindow =
      Date.parse(receipt.transitionedAt) >= Date.parse(intent.requestedAt) &&
      Date.parse(receipt.transitionedAt) <= Date.parse(intent.expiresAt);
    if (
      receipt.selector.valuationScopeKey !== intent.selector.valuationScopeKey ||
      receipt.selector.tradeId !== intent.selector.tradeId ||
      receipt.action.kind !== intent.action.kind ||
      receipt.fromHead.status !== intent.expectedHead.status ||
      receipt.fromHead.revision !== intent.expectedHead.revision ||
      receipt.fromHead.generationId !== intent.expectedHead.generationId ||
      receipt.toHead.revision !== receipt.fromHead.revision + 1 ||
      (receipt.fromHead.status === 'absent') !== (receipt.previousTransitionId === null) ||
      !inWindow
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toHead'],
        message: 'A transition receipt must bind its intent, exact predecessor, next revision, and validity window.',
      });
    }
    if (
      (receipt.action.kind === 'withdraw' && receipt.toHead.status !== 'withdrawn') ||
      (receipt.action.kind !== 'withdraw' && receipt.toHead.status !== 'active') ||
      (receipt.action.kind === 'rollback' &&
        receipt.toHead.generationId !== receipt.action.targetGenerationId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toHead'],
        message: 'The resulting head does not match the authenticated lifecycle action.',
      });
    }
  });

export const governedPrivateEvaluationTransitionReceiptSchema = z
  .object({
    transitionId: transitionIdSchema,
    content: transitionReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-transition',
      receipt.transitionId,
      receipt.content,
      context,
      ['transitionId']
    );
  });

export type GovernedPrivateEvaluationTransitionReceipt = z.infer<
  typeof governedPrivateEvaluationTransitionReceiptSchema
>;

export function createGovernedPrivateEvaluationTransitionReceipt(input: {
  readonly intent: GovernedPrivateEvaluationTransitionIntent;
  readonly previousTransitionId: string | null;
  readonly toGenerationId: string | null;
  readonly transitionedAt: string;
}): GovernedPrivateEvaluationTransitionReceipt {
  const intent = governedPrivateEvaluationTransitionIntentSchema.parse(input.intent);
  const action = intent.content.action;
  if (
    (action.kind === 'withdraw') !== (input.toGenerationId === null) ||
    (action.kind === 'rollback' && input.toGenerationId !== action.targetGenerationId)
  ) {
    throw new TypeError('The lifecycle result generation does not match its authenticated action.');
  }
  const content = transitionReceiptContentSchema.parse({
    schemaVersion: 'private-evaluation-transition-receipt/v1',
    environment: 'test_fixture',
    publicationProhibited: true,
    intent,
    selector: intent.content.selector,
    action,
    previousTransitionId: input.previousTransitionId,
    fromHead: intent.content.expectedHead,
    toHead: {
      status: action.kind === 'withdraw' ? 'withdrawn' : 'active',
      revision: intent.content.expectedHead.revision + 1,
      generationId: input.toGenerationId,
    },
    transitionedAt: input.transitionedAt,
    limitation: LIMITATION,
  });
  return governedPrivateEvaluationTransitionReceiptSchema.parse({
    transitionId: createAflTradeContentAddress('private-evaluation-transition', content),
    content,
  });
}

const AUTOMATED_LIMITATION =
  'Automated private calculation only; it grants no source approval, production, publication, withdrawal, rollback, or recovery authority.' as const;
const automatedConstructionAuthoritySchema = z
  .object({
    kind: z.literal('automated_private_calculation_agent'),
    principalId: z.string().regex(/^system:[a-z0-9][a-z0-9._:-]{0,199}$/u),
  })
  .strict();
const automatedTransitionActionSchema = z
  .object({ kind: z.literal('construct_and_activate') })
  .strict();
const automatedTransitionIntentContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-transition-intent/v2'),
    environment: z.literal('non_production'),
    publicationProhibited: z.literal(true),
    selector: governedPrivateEvaluationSelectorSchema,
    inspectionId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    authoritySnapshotId: aflTradeContentAddressedIdSchema(
      'private-evaluation-authority-snapshot'
    ),
    operationId: aflTradeContentAddressedIdSchema('private-evaluation-operation'),
    action: automatedTransitionActionSchema,
    expectedHead: lifecycleHeadSchema,
    constructionAuthority: automatedConstructionAuthoritySchema,
    requestedAt: instantSchema,
    expiresAt: instantSchema,
    limitation: z.literal(AUTOMATED_LIMITATION),
  })
  .strict()
  .superRefine((intent, context) => {
    if (Date.parse(intent.expiresAt) <= Date.parse(intent.requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'An automated transition intent requires a positive validity window.',
      });
    }
  });

export const automatedGovernedPrivateEvaluationTransitionIntentSchema = z
  .object({
    transitionIntentId: aflTradeContentAddressedIdSchema(
      'private-evaluation-transition-intent'
    ),
    content: automatedTransitionIntentContentSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-transition-intent',
      intent.transitionIntentId,
      intent.content,
      context,
      ['transitionIntentId']
    );
  });

export type AutomatedGovernedPrivateEvaluationTransitionIntent = z.infer<
  typeof automatedGovernedPrivateEvaluationTransitionIntentSchema
>;

export function createAutomatedGovernedPrivateEvaluationTransitionIntent(
  input: Omit<
    z.input<typeof automatedTransitionIntentContentSchema>,
    'schemaVersion' | 'environment' | 'publicationProhibited' | 'limitation'
  >
): AutomatedGovernedPrivateEvaluationTransitionIntent {
  const content = automatedTransitionIntentContentSchema.parse({
    schemaVersion: 'private-evaluation-transition-intent/v2',
    environment: 'non_production',
    publicationProhibited: true,
    ...input,
    limitation: AUTOMATED_LIMITATION,
  });
  return automatedGovernedPrivateEvaluationTransitionIntentSchema.parse({
    transitionIntentId: createAflTradeContentAddress(
      'private-evaluation-transition-intent',
      content
    ),
    content,
  });
}

const automatedTransitionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-transition-receipt/v2'),
    environment: z.literal('non_production'),
    publicationProhibited: z.literal(true),
    intent: automatedGovernedPrivateEvaluationTransitionIntentSchema,
    selector: governedPrivateEvaluationSelectorSchema,
    action: automatedTransitionActionSchema,
    previousTransitionId: transitionIdSchema.nullable(),
    fromHead: lifecycleHeadSchema,
    toHead: lifecycleHeadSchema,
    transitionedAt: instantSchema,
    limitation: z.literal(AUTOMATED_LIMITATION),
  })
  .strict()
  .superRefine((receipt, context) => {
    const intent = receipt.intent.content;
    const inWindow =
      Date.parse(receipt.transitionedAt) >= Date.parse(intent.requestedAt) &&
      Date.parse(receipt.transitionedAt) <= Date.parse(intent.expiresAt);
    if (
      receipt.selector.valuationScopeKey !== intent.selector.valuationScopeKey ||
      receipt.selector.tradeId !== intent.selector.tradeId ||
      receipt.fromHead.status !== intent.expectedHead.status ||
      receipt.fromHead.revision !== intent.expectedHead.revision ||
      receipt.fromHead.generationId !== intent.expectedHead.generationId ||
      receipt.toHead.status !== 'active' ||
      receipt.toHead.revision !== receipt.fromHead.revision + 1 ||
      receipt.toHead.generationId === null ||
      (receipt.fromHead.status === 'absent') !== (receipt.previousTransitionId === null) ||
      !inWindow
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toHead'],
        message: 'An automated receipt must bind one exact construct-and-activate transition.',
      });
    }
  });

export const automatedGovernedPrivateEvaluationTransitionReceiptSchema = z
  .object({
    transitionId: transitionIdSchema,
    content: automatedTransitionReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-transition',
      receipt.transitionId,
      receipt.content,
      context,
      ['transitionId']
    );
  });

export type AutomatedGovernedPrivateEvaluationTransitionReceipt = z.infer<
  typeof automatedGovernedPrivateEvaluationTransitionReceiptSchema
>;
export type AnyGovernedPrivateEvaluationTransitionIntent =
  | GovernedPrivateEvaluationTransitionIntent
  | AutomatedGovernedPrivateEvaluationTransitionIntent;
export type AnyGovernedPrivateEvaluationTransitionReceipt =
  | GovernedPrivateEvaluationTransitionReceipt
  | AutomatedGovernedPrivateEvaluationTransitionReceipt;

export function parseAnyGovernedPrivateEvaluationTransitionIntent(
  value: unknown
): AnyGovernedPrivateEvaluationTransitionIntent {
  const version = (value as { readonly content?: { readonly schemaVersion?: unknown } } | null)
    ?.content?.schemaVersion;
  return version === 'private-evaluation-transition-intent/v2'
    ? automatedGovernedPrivateEvaluationTransitionIntentSchema.parse(value)
    : governedPrivateEvaluationTransitionIntentSchema.parse(value);
}

export function parseAnyGovernedPrivateEvaluationTransitionReceipt(
  value: unknown
): AnyGovernedPrivateEvaluationTransitionReceipt {
  const version = (value as { readonly content?: { readonly schemaVersion?: unknown } } | null)
    ?.content?.schemaVersion;
  return version === 'private-evaluation-transition-receipt/v2'
    ? automatedGovernedPrivateEvaluationTransitionReceiptSchema.parse(value)
    : governedPrivateEvaluationTransitionReceiptSchema.parse(value);
}

export function createAutomatedGovernedPrivateEvaluationTransitionReceipt(input: {
  readonly intent: AutomatedGovernedPrivateEvaluationTransitionIntent;
  readonly previousTransitionId: string | null;
  readonly toGenerationId: string;
  readonly transitionedAt: string;
}): AutomatedGovernedPrivateEvaluationTransitionReceipt {
  const intent = automatedGovernedPrivateEvaluationTransitionIntentSchema.parse(input.intent);
  const content = automatedTransitionReceiptContentSchema.parse({
    schemaVersion: 'private-evaluation-transition-receipt/v2',
    environment: 'non_production',
    publicationProhibited: true,
    intent,
    selector: intent.content.selector,
    action: intent.content.action,
    previousTransitionId: input.previousTransitionId,
    fromHead: intent.content.expectedHead,
    toHead: {
      status: 'active',
      revision: intent.content.expectedHead.revision + 1,
      generationId: input.toGenerationId,
    },
    transitionedAt: input.transitionedAt,
    limitation: AUTOMATED_LIMITATION,
  });
  return automatedGovernedPrivateEvaluationTransitionReceiptSchema.parse({
    transitionId: createAflTradeContentAddress('private-evaluation-transition', content),
    content,
  });
}
