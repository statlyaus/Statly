import { z } from 'zod';

import { aflTradeArtifactRefSchema, type AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';

export const PRIVATE_EVALUATION_INSPECTION_SCHEMA_VERSION =
  'private-evaluation-inspection/v1' as const;
export const PRIVATE_EVALUATION_AUTHORITY_SNAPSHOT_SCHEMA_VERSION =
  'private-evaluation-authority-snapshot/v1' as const;

const publicIdSchema = z.string().trim().min(1).max(400);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const instantSchema = z.iso.datetime({ offset: true });

export const governedPrivateEvaluationSelectorSchema = z
  .object({
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
  })
  .strict();

export type GovernedPrivateEvaluationSelector = z.infer<
  typeof governedPrivateEvaluationSelectorSchema
>;

export const privateEvaluationHeadGuardSchema = z
  .object({
    generationId: aflTradeContentAddressedIdSchema(
      'local-private-trade-evaluation-generation'
    ).nullable(),
    revision: z.number().int().nonnegative(),
    status: z.enum(['absent', 'active', 'withdrawn']),
  })
  .strict()
  .superRefine((head, context) => {
    if ((head.status === 'active') !== (head.generationId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['generationId'],
        message: 'Only an active private evaluation head may identify a current generation.',
      });
    }
    if (head.status === 'absent' && head.revision !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'An absent private evaluation head must begin at revision zero.',
      });
    }
  });

export type PrivateEvaluationHeadGuard = z.infer<
  typeof privateEvaluationHeadGuardSchema
>;

export const privateEvaluationAuthorityClassSchema = z.enum([
  'runtime',
  'confirmed_result',
  'source_use',
  'private_evaluation',
  'factual_release',
  'evaluation_evidence',
  'dataset_admission',
  'model_run',
  'gate_3',
  'valuation_bundle',
  'player_horizon',
  'pick_lineage',
  'pick_forecast',
  'integrity',
]);

const privateEvaluationInspectionBlockerRegistry = {
  confirmed_result_not_promoted: {
    authorityClass: 'confirmed_result',
    classification: 'internal_evidence',
  },
  source_use_not_authorized: {
    authorityClass: 'source_use',
    classification: 'external_authority',
  },
  factual_release_not_active: {
    authorityClass: 'factual_release',
    classification: 'external_authority',
  },
  private_evaluation_not_authorized: {
    authorityClass: 'private_evaluation',
    classification: 'external_authority',
  },
  player_model_run_not_authorized: {
    authorityClass: 'model_run',
    classification: 'external_authority',
  },
  pick_model_run_not_authorized: {
    authorityClass: 'model_run',
    classification: 'external_authority',
  },
  player_gate3_not_approved: {
    authorityClass: 'gate_3',
    classification: 'external_authority',
  },
  pick_gate3_not_approved: {
    authorityClass: 'gate_3',
    classification: 'external_authority',
  },
  valuation_bundle_not_authorized: {
    authorityClass: 'valuation_bundle',
    classification: 'external_authority',
  },
  evaluation_evidence_bundle_unavailable: {
    authorityClass: 'evaluation_evidence',
    classification: 'internal_evidence',
  },
  evaluation_evidence_gate3_not_approved: {
    authorityClass: 'gate_3',
    classification: 'external_authority',
  },
  player_hpn_horizon_missing: {
    authorityClass: 'player_horizon',
    classification: 'internal_evidence',
  },
  pick_lineage_missing: {
    authorityClass: 'pick_lineage',
    classification: 'internal_evidence',
  },
  pick_forecast_unavailable: {
    authorityClass: 'pick_forecast',
    classification: 'internal_evidence',
  },
} as const satisfies Record<
  string,
  {
    readonly authorityClass: z.infer<typeof privateEvaluationAuthorityClassSchema>;
    readonly classification:
      | 'external_authority'
      | 'internal_evidence'
      | 'engineering';
  }
>;

export const privateEvaluationInspectionBlockerSchema = z
  .object({
    code: publicIdSchema,
    authorityClass: privateEvaluationAuthorityClassSchema,
    classification: z.enum(['external_authority', 'internal_evidence', 'engineering']),
    assetId: publicIdSchema.nullable(),
    message: z.string().trim().min(1).max(2_000),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).max(1_000),
  })
  .strict()
  .superRefine((blocker, context) => {
    const registered =
      privateEvaluationInspectionBlockerRegistry[
        blocker.code as keyof typeof privateEvaluationInspectionBlockerRegistry
      ];
    if (registered === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Inspection blocker code is not registered.',
      });
      return;
    }
    if (
      blocker.authorityClass !== registered.authorityClass ||
      blocker.classification !== registered.classification
    ) {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Inspection blocker classification does not match its registered code.',
      });
    }
  });

export type PrivateEvaluationInspectionBlocker = z.infer<
  typeof privateEvaluationInspectionBlockerSchema
>;

const privateEvaluationAuthorityDependencySchema = z
  .object({
    role: z.enum([
      'confirmed_result',
      'transaction_promotion',
      'source_use',
      'private_evaluation',
      'factual_release',
      'evaluation_evidence',
      'trade_correspondence',
      'dataset_admission',
      'observation_set',
      'model_run',
      'gate_3',
      'valuation_bundle',
      'player_evidence',
      'pick_evidence',
    ]),
    artifact: aflTradeArtifactRefSchema,
  })
  .strict();

function canonicalDependencies(
  dependencies: readonly z.input<typeof privateEvaluationAuthorityDependencySchema>[]
) {
  return dependencies
    .map((dependency) => privateEvaluationAuthorityDependencySchema.parse(dependency))
    .sort((left, right) =>
      `${left.role}|${left.artifact.artifactId}`.localeCompare(
        `${right.role}|${right.artifact.artifactId}`
      )
    );
}

function dependenciesAreCanonical(
  dependencies: readonly z.infer<typeof privateEvaluationAuthorityDependencySchema>[]
): boolean {
  const identities = dependencies.map(
    ({ role, artifact }) => `${role}|${artifact.artifactId}`
  );
  return (
    new Set(identities).size === identities.length &&
    !identities.some((identity, index) => index > 0 && identities[index - 1]! > identity)
  );
}

const privateEvaluationAuthoritySnapshotContentSchema = z
  .object({
    schemaVersion: z.literal(PRIVATE_EVALUATION_AUTHORITY_SNAPSHOT_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    selector: governedPrivateEvaluationSelectorSchema,
    promotedWorkbookSha256: sha256Schema,
    capturedAt: instantSchema,
    validThrough: instantSchema,
    expectedHead: privateEvaluationHeadGuardSchema,
    dependencies: z.array(privateEvaluationAuthorityDependencySchema).min(1).max(10_000),
    dependencyFingerprint: sha256Schema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      !dependenciesAreCanonical(snapshot.dependencies) ||
      snapshot.dependencyFingerprint !== sha256AflTradeCanonicalJson(snapshot.dependencies)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'Authority snapshot dependencies must be unique, sorted, and exactly sealed.',
      });
    }
    if (Date.parse(snapshot.validThrough) <= Date.parse(snapshot.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validThrough'],
        message: 'Authority snapshot validity must extend beyond its trusted capture time.',
      });
    }
  });

export const privateEvaluationAuthoritySnapshotSchema = z
  .object({
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    content: privateEvaluationAuthoritySnapshotContentSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-authority-snapshot',
      snapshot.snapshotId,
      snapshot.content,
      context,
      ['snapshotId']
    );
  });

export type PrivateEvaluationAuthoritySnapshot = z.infer<
  typeof privateEvaluationAuthoritySnapshotSchema
>;

export function createPrivateEvaluationAuthoritySnapshot(input: {
  readonly selector: GovernedPrivateEvaluationSelector;
  readonly promotedWorkbookSha256: string;
  readonly capturedAt: string;
  readonly validThrough: string;
  readonly expectedHead: z.input<typeof privateEvaluationHeadGuardSchema>;
  readonly dependencies: readonly z.input<typeof privateEvaluationAuthorityDependencySchema>[];
}): PrivateEvaluationAuthoritySnapshot {
  const dependencies = canonicalDependencies(input.dependencies);
  const content = privateEvaluationAuthoritySnapshotContentSchema.parse({
    schemaVersion: PRIVATE_EVALUATION_AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    selector: input.selector,
    promotedWorkbookSha256: input.promotedWorkbookSha256,
    capturedAt: input.capturedAt,
    validThrough: input.validThrough,
    expectedHead: input.expectedHead,
    dependencies,
    dependencyFingerprint: sha256AflTradeCanonicalJson(dependencies),
  });
  return privateEvaluationAuthoritySnapshotSchema.parse({
    snapshotId: createAflTradeContentAddress('private-evaluation-authority-snapshot', content),
    content,
  });
}

function blockerKey(blocker: PrivateEvaluationInspectionBlocker): string {
  return [blocker.authorityClass, blocker.assetId ?? '', blocker.code].join('|');
}

const inspectionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal(PRIVATE_EVALUATION_INSPECTION_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    selector: governedPrivateEvaluationSelectorSchema,
    promotedWorkbookSha256: sha256Schema.nullable(),
    authoritySnapshotId: aflTradeContentAddressedIdSchema(
      'private-evaluation-authority-snapshot'
    ).nullable(),
    inspectedAt: instantSchema,
    validThrough: instantSchema.nullable(),
    expectedHead: privateEvaluationHeadGuardSchema,
    state: z.enum(['ready', 'unavailable']),
    observedDependencies: z.array(privateEvaluationAuthorityDependencySchema).max(10_000),
    blockers: z.array(privateEvaluationInspectionBlockerSchema).max(10_000),
    blockerFingerprint: sha256Schema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const keys = receipt.blockers.map(blockerKey);
    if (
      !dependenciesAreCanonical(receipt.observedDependencies) ||
      new Set(keys).size !== keys.length ||
      keys.some((key, index) => index > 0 && keys[index - 1]! > key) ||
      receipt.blockerFingerprint !== sha256AflTradeCanonicalJson(receipt.blockers)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockers'],
        message: 'Inspection blockers must be unique, sorted, and sealed by their exact digest.',
      });
    }
    if (
      (receipt.state === 'ready' &&
        (receipt.blockers.length !== 0 ||
          receipt.promotedWorkbookSha256 === null ||
          receipt.authoritySnapshotId === null ||
          receipt.validThrough === null)) ||
      (receipt.state === 'unavailable' && receipt.blockers.length === 0) ||
      (receipt.validThrough !== null &&
        Date.parse(receipt.validThrough) <= Date.parse(receipt.inspectedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Inspection readiness must match its blockers, snapshot, and validity window.',
      });
    }
  });

export const privateEvaluationInspectionReceiptSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    content: inspectionReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-inspection',
      receipt.receiptId,
      receipt.content,
      context,
      ['receiptId']
    );
  });

export type PrivateEvaluationInspectionReceipt = z.infer<
  typeof privateEvaluationInspectionReceiptSchema
>;

export function createPrivateEvaluationInspectionReceipt(input: {
  readonly selector: GovernedPrivateEvaluationSelector;
  readonly promotedWorkbookSha256: string | null;
  readonly authoritySnapshotId: string | null;
  readonly inspectedAt: string;
  readonly validThrough: string | null;
  readonly expectedHead: z.input<typeof privateEvaluationHeadGuardSchema>;
  readonly observedDependencies: readonly z.input<
    typeof privateEvaluationAuthorityDependencySchema
  >[];
  readonly blockers: readonly z.input<typeof privateEvaluationInspectionBlockerSchema>[];
}): PrivateEvaluationInspectionReceipt {
  const observedDependencies = canonicalDependencies(input.observedDependencies);
  const blockers = input.blockers
    .map((blocker) => privateEvaluationInspectionBlockerSchema.parse(blocker))
    .sort((left, right) => blockerKey(left).localeCompare(blockerKey(right)));
  const content = inspectionReceiptContentSchema.parse({
    schemaVersion: PRIVATE_EVALUATION_INSPECTION_SCHEMA_VERSION,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    selector: input.selector,
    promotedWorkbookSha256: input.promotedWorkbookSha256,
    authoritySnapshotId: input.authoritySnapshotId,
    inspectedAt: input.inspectedAt,
    validThrough: input.validThrough,
    expectedHead: input.expectedHead,
    state: blockers.length === 0 ? 'ready' : 'unavailable',
    observedDependencies,
    blockers,
    blockerFingerprint: sha256AflTradeCanonicalJson(blockers),
  });
  return privateEvaluationInspectionReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('private-evaluation-inspection', content),
    content,
  });
}

export const privateEvaluationReviewGuardSchema = z
  .object({
    authoritySnapshotId: aflTradeContentAddressedIdSchema(
      'private-evaluation-authority-snapshot'
    ),
    inspectionReceiptId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    expectedHead: privateEvaluationHeadGuardSchema,
    validThrough: instantSchema,
  })
  .strict();

export type PrivateEvaluationReviewGuard = z.infer<
  typeof privateEvaluationReviewGuardSchema
>;

export const privateEvaluationOperatorReviewSchema = z
  .object({
    principalId: publicIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type PrivateEvaluationOperatorReview = z.infer<
  typeof privateEvaluationOperatorReviewSchema
>;

const privateEvaluationGenerationIdSchema = aflTradeContentAddressedIdSchema(
  'local-private-trade-evaluation-generation'
);

export const privateEvaluationExecutionCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('construct_and_activate'),
      selector: governedPrivateEvaluationSelectorSchema,
      expected: privateEvaluationReviewGuardSchema,
      operator: privateEvaluationOperatorReviewSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('withdraw'),
      selector: governedPrivateEvaluationSelectorSchema,
      expected: privateEvaluationHeadGuardSchema,
      reason: z.string().trim().min(1).max(2_000),
      operator: privateEvaluationOperatorReviewSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('rollback'),
      selector: governedPrivateEvaluationSelectorSchema,
      targetGenerationId: privateEvaluationGenerationIdSchema,
      expected: privateEvaluationHeadGuardSchema,
      operator: privateEvaluationOperatorReviewSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('recover'),
      selector: governedPrivateEvaluationSelectorSchema,
      expected: privateEvaluationReviewGuardSchema,
      operator: privateEvaluationOperatorReviewSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('verify_reconstruction'),
      selector: governedPrivateEvaluationSelectorSchema,
      generationId: privateEvaluationGenerationIdSchema,
    })
    .strict(),
]);

export type PrivateEvaluationExecutionCommand = z.infer<
  typeof privateEvaluationExecutionCommandSchema
>;

export const privateEvaluationExecutionResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('activated'),
      selector: governedPrivateEvaluationSelectorSchema,
      generationId: privateEvaluationGenerationIdSchema,
      head: privateEvaluationHeadGuardSchema,
    })
    .strict()
    .superRefine((result, context) => {
      if (
        result.head.status !== 'active' ||
        result.head.generationId !== result.generationId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['head'],
          message: 'An activated result must identify its exact active generation head.',
        });
      }
    }),
  z
    .object({
      state: z.literal('withdrawn'),
      selector: governedPrivateEvaluationSelectorSchema,
      head: privateEvaluationHeadGuardSchema,
    })
    .strict()
    .superRefine((result, context) => {
      if (result.head.status !== 'withdrawn') {
        context.addIssue({
          code: 'custom',
          path: ['head'],
          message: 'A withdrawn result must return a withdrawn head.',
        });
      }
    }),
  z
    .object({
      state: z.literal('rolled_back'),
      selector: governedPrivateEvaluationSelectorSchema,
      generationId: privateEvaluationGenerationIdSchema,
      head: privateEvaluationHeadGuardSchema,
    })
    .strict()
    .superRefine((result, context) => {
      if (
        result.head.status !== 'active' ||
        result.head.generationId !== result.generationId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['head'],
          message: 'A rollback result must identify its exact restored active generation head.',
        });
      }
    }),
  z
    .object({
      state: z.literal('recovered'),
      selector: governedPrivateEvaluationSelectorSchema,
      generationId: privateEvaluationGenerationIdSchema,
      head: privateEvaluationHeadGuardSchema,
    })
    .strict()
    .superRefine((result, context) => {
      if (
        result.head.status !== 'active' ||
        result.head.generationId !== result.generationId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['head'],
          message: 'A recovery result must identify its exact reconstructed active generation.',
        });
      }
    }),
  z
    .object({
      state: z.literal('reconstruction_verified'),
      selector: governedPrivateEvaluationSelectorSchema,
      generationId: privateEvaluationGenerationIdSchema,
      exactMatch: z.literal(true),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      selector: governedPrivateEvaluationSelectorSchema,
      blockers: z.array(privateEvaluationInspectionBlockerSchema).min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      state: z.literal('conflict'),
      selector: governedPrivateEvaluationSelectorSchema,
      expectedHead: privateEvaluationHeadGuardSchema,
      actualHead: privateEvaluationHeadGuardSchema,
      message: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      state: z.literal('invalid_transition'),
      selector: governedPrivateEvaluationSelectorSchema,
      reason: z.enum(['target_current', 'never_active', 'authority_no_longer_current']),
      message: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      state: z.literal('not_found'),
      selector: governedPrivateEvaluationSelectorSchema,
      resource: z.enum(['inspection', 'authority_snapshot', 'generation']),
      resourceId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('reconstruction_mismatch'),
      selector: governedPrivateEvaluationSelectorSchema,
      generationId: privateEvaluationGenerationIdSchema,
      message: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

export type PrivateEvaluationExecutionResult = z.infer<
  typeof privateEvaluationExecutionResultSchema
>;

export type GovernedPrivateEvaluationInspectionResult =
  | {
      readonly state: 'ready';
      readonly selector: GovernedPrivateEvaluationSelector;
      readonly reviewGuard: PrivateEvaluationReviewGuard;
      readonly blockers: readonly [];
      readonly inspectionReceipt: PrivateEvaluationInspectionReceipt;
    }
  | {
      readonly state: 'unavailable';
      readonly selector: GovernedPrivateEvaluationSelector;
      readonly blockers: readonly PrivateEvaluationInspectionBlocker[];
      readonly inspectionReceipt: PrivateEvaluationInspectionReceipt;
    };

export interface PrivateEvaluationInspectionStore {
  capture(
    selector: GovernedPrivateEvaluationSelector
  ): Promise<PrivateEvaluationInspectionReceipt['receiptId']>;
  load(
    receiptId: PrivateEvaluationInspectionReceipt['receiptId']
  ): Promise<PrivateEvaluationInspectionReceipt | null>;
  loadAuthoritySnapshot(
    snapshotId: PrivateEvaluationAuthoritySnapshot['snapshotId']
  ): Promise<PrivateEvaluationAuthoritySnapshot | null>;
}

export interface PrivateEvaluationExecutionStore {
  execute(
    command: PrivateEvaluationExecutionCommand
  ): Promise<PrivateEvaluationExecutionResult>;
}

export interface GovernedPrivateTradeEvaluationWorkspace {
  inspect(
    selector: GovernedPrivateEvaluationSelector
  ): Promise<GovernedPrivateEvaluationInspectionResult>;
  execute(
    command: PrivateEvaluationExecutionCommand
  ): Promise<PrivateEvaluationExecutionResult>;
}

export function evidenceRefsFromInspection(
  receipt: PrivateEvaluationInspectionReceipt
): readonly AflTradeArtifactRef[] {
  return [
    ...new Map(
      receipt.content.blockers
        .flatMap(({ evidenceRefs }) => evidenceRefs)
        .map((reference) => [reference.artifactId, reference])
    ).values(),
  ].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}
