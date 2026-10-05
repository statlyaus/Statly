import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  privateEvaluationAuthoritySnapshotSchema,
  privateEvaluationInspectionReceiptSchema,
  type PrivateEvaluationAuthoritySnapshot,
  type PrivateEvaluationInspectionReceipt,
} from './governedPrivateTradeEvaluationContracts';
import {
  LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION,
  localPrivateTradeEvaluationGenerationV2ContentSchema,
  parseLocalPrivateTradeEvaluationGenerationV2,
  type LocalPrivateTradeEvaluationGenerationV2,
} from './localPrivateTradeEvaluationGenerationV2';
import {
  privateEvaluationTransitionIntentSchema,
  type PrivateEvaluationTransitionIntent,
} from './privateEvaluationTransitionContracts';

export const LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION =
  'local-private-trade-evaluation-generation/v3' as const;
export const GOVERNED_PRIVATE_EVALUATION_PROJECTOR_V3 =
  'governed-private-evaluation-projector/v3' as const;

const authorityReviewSchema = z
  .object({
    authoritySnapshotId: aflTradeContentAddressedIdSchema(
      'private-evaluation-authority-snapshot'
    ),
    authoritySnapshotArtifact: aflTradeArtifactRefSchema,
    inspectionReceiptId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    inspectionReceiptArtifact: aflTradeArtifactRefSchema,
    transitionIntentId: aflTradeContentAddressedIdSchema(
      'private-evaluation-transition-intent'
    ),
    transitionIntentArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const derivationSchema = z
  .object({
    calculationInputId: aflTradeContentAddressedIdSchema(
      'governed-private-valuation-calculation-input'
    ),
    calculationInputArtifact: aflTradeArtifactRefSchema,
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    calculationArtifact: aflTradeArtifactRefSchema,
    directionEvidenceId: aflTradeContentAddressedIdSchema('artifact'),
    directionEvidenceArtifact: aflTradeArtifactRefSchema,
    explanationArtifact: aflTradeArtifactRefSchema,
    projectorVersion: z.literal(GOVERNED_PRIVATE_EVALUATION_PROJECTOR_V3),
  })
  .strict()
  .superRefine((derivation, context) => {
    if (derivation.directionEvidenceId !== derivation.directionEvidenceArtifact.artifactId) {
      context.addIssue({
        code: 'custom',
        path: ['directionEvidenceId'],
        message: 'Direction evidence identity must equal its exact canonical artifact identity.',
      });
    }
  });

const GOVERNANCE_LIMITATION =
  'This governed v3 generation binds one retained review and replayable calculation ancestry. A separate append-only transition receipt is required for activation; publication and production use remain prohibited.' as const;

export const localPrivateTradeEvaluationGenerationV3ContentSchema = z
  .object({
    ...localPrivateTradeEvaluationGenerationV2ContentSchema.shape,
    schemaVersion: z.literal(LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION),
    authorityReview: authorityReviewSchema,
    derivation: derivationSchema,
    derivationFingerprint: aflTradeContentAddressedIdSchema(
      'private-evaluation-derivation'
    ),
    governanceLimitation: z.literal(GOVERNANCE_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const {
      authorityReview: _authorityReview,
      derivation: _derivation,
      derivationFingerprint: _derivationFingerprint,
      governanceLimitation: _governanceLimitation,
      ...legacyContent
    } = content;
    const legacy = localPrivateTradeEvaluationGenerationV2ContentSchema.safeParse({
      ...legacyContent,
      schemaVersion: LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION,
    });
    if (!legacy.success) {
      for (const issue of legacy.error.issues) {
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }

    const dependencyFingerprint = createAflTradeContentAddress(
      'local-private-trade-evaluation-dependencies',
      content.dependencyRefs
    );
    const derivationFingerprint = createAflTradeContentAddress(
      'private-evaluation-derivation',
      { authorityReview: content.authorityReview, derivation: content.derivation }
    );
    if (
      content.dependencyFingerprint !== dependencyFingerprint ||
      content.derivationFingerprint !== derivationFingerprint
    ) {
      context.addIssue({
        code: 'custom',
        path: ['derivationFingerprint'],
        message: 'Generation dependency and derivation fingerprints must be exact.',
      });
    }

    const requiredParents = [
      content.authorityReview.authoritySnapshotArtifact,
      content.authorityReview.inspectionReceiptArtifact,
      content.authorityReview.transitionIntentArtifact,
      content.derivation.calculationInputArtifact,
      content.derivation.calculationArtifact,
      content.derivation.directionEvidenceArtifact,
      content.derivation.explanationArtifact,
    ];
    if (
      requiredParents.some(
        parent =>
          !content.dependencyRefs.some(retained =>
            doAflTradeArtifactRefsExactlyMatch(retained, parent)
          )
      ) ||
      requiredParents.some(parent => Date.parse(parent.createdAt) > Date.parse(content.generatedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dependencyRefs'],
        message: 'Every reviewed and derivation parent must be sealed before generation.',
      });
    }
  });

export const localPrivateTradeEvaluationGenerationV3Schema = z
  .object({
    generationId: aflTradeContentAddressedIdSchema(
      'local-private-trade-evaluation-generation'
    ),
    content: localPrivateTradeEvaluationGenerationV3ContentSchema,
  })
  .strict()
  .superRefine((generation, context) => {
    addAflTradeContentAddressIssue(
      'local-private-trade-evaluation-generation',
      generation.generationId,
      generation.content,
      context,
      ['generationId']
    );
  });

export type LocalPrivateTradeEvaluationGenerationV3 = z.infer<
  typeof localPrivateTradeEvaluationGenerationV3Schema
>;

export interface LocalPrivateTradeEvaluationV3Derivation {
  readonly calculationInputId: string;
  readonly calculationInputArtifact: AflTradeArtifactRef;
  readonly valuationCalculationId: string;
  readonly calculationArtifact: AflTradeArtifactRef;
  readonly directionEvidenceId: string;
  readonly directionEvidenceArtifact: AflTradeArtifactRef;
  readonly explanationArtifact: AflTradeArtifactRef;
  readonly projectorVersion: typeof GOVERNED_PRIVATE_EVALUATION_PROJECTOR_V3;
}

function exactHead(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function collectDependencies(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  const retained = new Map<string, AflTradeArtifactRef>();
  for (const reference of references) {
    const parsed = aflTradeArtifactRefSchema.parse(reference);
    const existing = retained.get(parsed.artifactId);
    if (existing && !doAflTradeArtifactRefsExactlyMatch(existing, parsed)) {
      throw new TypeError('Generation dependency references disagree for one artifact identity.');
    }
    retained.set(parsed.artifactId, parsed);
  }
  return [...retained.values()].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
}

export function createLocalPrivateTradeEvaluationGenerationV3(input: {
  readonly projection: LocalPrivateTradeEvaluationGenerationV2;
  readonly authoritySnapshot: PrivateEvaluationAuthoritySnapshot;
  readonly inspectionReceipt: PrivateEvaluationInspectionReceipt;
  readonly transitionIntent: PrivateEvaluationTransitionIntent;
  readonly derivation: LocalPrivateTradeEvaluationV3Derivation;
}): LocalPrivateTradeEvaluationGenerationV3 {
  const projection = parseLocalPrivateTradeEvaluationGenerationV2(input.projection);
  const authoritySnapshot = privateEvaluationAuthoritySnapshotSchema.parse(
    input.authoritySnapshot
  );
  const inspectionReceipt = privateEvaluationInspectionReceiptSchema.parse(
    input.inspectionReceipt
  );
  const transitionIntent = privateEvaluationTransitionIntentSchema.parse(
    input.transitionIntent
  );
  const derivation = derivationSchema.parse(input.derivation);
  const selector = authoritySnapshot.content.selector;
  if (
    inspectionReceipt.content.state !== 'ready' ||
    inspectionReceipt.content.authoritySnapshotId !== authoritySnapshot.snapshotId ||
    inspectionReceipt.content.promotedWorkbookSha256 !==
      authoritySnapshot.content.promotedWorkbookSha256 ||
    inspectionReceipt.content.inspectedAt !== authoritySnapshot.content.capturedAt ||
    inspectionReceipt.content.validThrough !== authoritySnapshot.content.validThrough ||
    !exactHead(
      inspectionReceipt.content.expectedHead,
      authoritySnapshot.content.expectedHead
    ) ||
    !['construct_and_activate', 'recover'].includes(transitionIntent.content.action) ||
    transitionIntent.content.authoritySnapshotId !== authoritySnapshot.snapshotId ||
    transitionIntent.content.inspectionReceiptId !== inspectionReceipt.receiptId ||
    !exactHead(transitionIntent.content.expectedHead, authoritySnapshot.content.expectedHead) ||
    transitionIntent.content.selector.valuationScopeKey !== selector.valuationScopeKey ||
    transitionIntent.content.selector.tradeId !== selector.tradeId ||
    projection.content.valuationScopeKey !== selector.valuationScopeKey ||
    projection.content.tradeId !== selector.tradeId ||
    projection.content.workbookSha256 !== authoritySnapshot.content.promotedWorkbookSha256 ||
    Date.parse(projection.content.generatedAt) <
      Date.parse(transitionIntent.content.requestedAt) ||
    Date.parse(projection.content.generatedAt) >=
      Date.parse(authoritySnapshot.content.validThrough)
  ) {
    throw new TypeError('Governed generation review ancestry does not exactly match its projection.');
  }

  const authorityReview = authorityReviewSchema.parse({
    authoritySnapshotId: authoritySnapshot.snapshotId,
    authoritySnapshotArtifact: createAflTradeCanonicalJsonArtifactRef(
      authoritySnapshot,
      authoritySnapshot.content.capturedAt
    ),
    inspectionReceiptId: inspectionReceipt.receiptId,
    inspectionReceiptArtifact: createAflTradeCanonicalJsonArtifactRef(
      inspectionReceipt,
      inspectionReceipt.content.inspectedAt
    ),
    transitionIntentId: transitionIntent.intentId,
    transitionIntentArtifact: createAflTradeCanonicalJsonArtifactRef(
      transitionIntent,
      transitionIntent.content.requestedAt
    ),
  });
  const dependencyRefs = collectDependencies([
    ...projection.content.dependencyRefs,
    authorityReview.authoritySnapshotArtifact,
    authorityReview.inspectionReceiptArtifact,
    authorityReview.transitionIntentArtifact,
    derivation.calculationInputArtifact,
    derivation.calculationArtifact,
    derivation.directionEvidenceArtifact,
    derivation.explanationArtifact,
  ]);
  const content = localPrivateTradeEvaluationGenerationV3ContentSchema.parse({
    ...projection.content,
    schemaVersion: LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION,
    dependencyRefs,
    dependencyFingerprint: createAflTradeContentAddress(
      'local-private-trade-evaluation-dependencies',
      dependencyRefs
    ),
    authorityReview,
    derivation,
    derivationFingerprint: createAflTradeContentAddress(
      'private-evaluation-derivation',
      { authorityReview, derivation }
    ),
    governanceLimitation: GOVERNANCE_LIMITATION,
  });
  return localPrivateTradeEvaluationGenerationV3Schema.parse({
    generationId: createAflTradeContentAddress(
      'local-private-trade-evaluation-generation',
      content
    ),
    content,
  });
}

export function parseLocalPrivateTradeEvaluationGenerationV3(
  input: unknown
): LocalPrivateTradeEvaluationGenerationV3 {
  const parsed = localPrivateTradeEvaluationGenerationV3Schema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError(
      'Local private trade evaluation generation v3 failed exact authentication.'
    );
  }
  return parsed.data;
}
