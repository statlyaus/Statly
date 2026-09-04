import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import {
  governedPrivateEvaluationInspectResultSchema,
  governedPrivateEvaluationSelectorSchema,
} from './governedPrivateEvaluationWorkspaceContracts';
import { aflTradePrivatePreparedValuationDispatchAuthoritySchema } from '../preparedValuationInputSet';

const LIMITATION =
  'Private test-fixture inspection only; unavailable calculation authority permits no construction, grade, production use, or publication.' as const;
const READY_FIXTURE_LIMITATION =
  'Private synthetic test-fixture authority only; it grants no factual, production, or publication authority.' as const;
const READY_NON_PRODUCTION_LIMITATION =
  'Authenticated private non-production calculation authority only; publication and production use remain prohibited.' as const;
const UNAVAILABLE_NON_PRODUCTION_LIMITATION =
  'Authenticated private non-production inspection only; unavailable calculation authority permits no construction, grade, production use, or publication.' as const;
const instantSchema = z.iso.datetime({ offset: true });
const generationIdSchema = aflTradeContentAddressedIdSchema(
  'local-private-trade-evaluation-generation'
);
const transitionIdSchema = aflTradeContentAddressedIdSchema('private-evaluation-transition');
const modelRunIdSchema = aflTradeContentAddressedIdSchema('model-run');
const componentRoles = [
  'player_contribution_and_availability',
  'draft_pick_and_future_pick_distribution',
] as const;

const headSchema = z
  .object({
    status: z.enum(['absent', 'active', 'withdrawn']),
    revision: z.number().int().nonnegative(),
    generationId: generationIdSchema.nullable(),
  })
  .strict()
  .superRefine((head, context) => {
    if (
      (head.status === 'absent') !== (head.revision === 0) ||
      (head.status === 'active') !== (head.generationId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['generationId'],
        message: 'Authority snapshot lifecycle head is inconsistent.',
      });
    }
  });

const blockerSchema = z
  .object({
    code: z.enum([
      'source_blocked',
      'insufficient_data',
      'identity_unresolved',
      'lineage_unresolved',
      'model_not_approved',
      'reconciliation_failed',
      'engineering_unavailable',
    ]),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

const lifecycleCommonBase = {
  publicationProhibited: z.literal(true),
  selector: governedPrivateEvaluationSelectorSchema,
  capturedAt: instantSchema,
  validThrough: instantSchema,
  head: headSchema,
  lastTransitionId: transitionIdSchema.nullable(),
};

const fixtureAuthorityCommonBase = {
  ...lifecycleCommonBase,
  environment: z.literal('test_fixture'),
};

const unavailableAuthorityContent = {
  ...fixtureAuthorityCommonBase,
  calculationAuthority: z
    .object({
      state: z.literal('unavailable'),
      playerModelRunId: z.null(),
      pickModelRunId: z.null(),
    })
    .strict(),
  blockers: z.array(blockerSchema).min(1).max(10_000),
  limitation: z.literal(LIMITATION),
};

const unavailableNonProductionAuthorityContent = {
  ...lifecycleCommonBase,
  environment: z.literal('non_production'),
  calculationAuthority: z
    .object({
      state: z.literal('unavailable'),
      playerModelRunId: z.null(),
      pickModelRunId: z.null(),
    })
    .strict(),
  blockers: z.array(blockerSchema).min(1).max(10_000),
  limitation: z.literal(UNAVAILABLE_NON_PRODUCTION_LIMITATION),
};

const readyFixtureAuthorityContent = {
  ...fixtureAuthorityCommonBase,
  calculationAuthority: z
    .object({
      state: z.literal('ready'),
      playerModelRunId: modelRunIdSchema,
      pickModelRunId: modelRunIdSchema,
    })
    .strict(),
  blockers: z.tuple([]),
  limitation: z.literal(READY_FIXTURE_LIMITATION),
};

const readyComponentSchema = z
  .object({
    role: z.enum(componentRoles),
    runId: modelRunIdSchema,
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    datasetAdmissionGateLedgerRevision: z.number().int().positive(),
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gate3DecisionVersion: z.number().int().positive(),
    qualificationId: aflTradeContentAddressedIdSchema('model-qualification').optional(),
    qualificationPolicyVersion: aflTradeContentAddressedIdSchema(
      'model-qualification-policy'
    ).optional(),
  })
  .strict()
  .superRefine((component, context) => {
    if (
      (component.qualificationId === undefined) !==
      (component.qualificationPolicyVersion === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['qualificationId'],
        message: 'Ready component qualification identity and policy version must travel together.',
      });
    }
  });

const qualifiedReadyComponentSchema = readyComponentSchema.superRefine((component, context) => {
  if (
    component.qualificationId === undefined ||
    component.qualificationPolicyVersion === undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['qualificationId'],
      message: 'New ready authority requires exact model-pair qualification custody.',
    });
  }
});

const qualifiedReadyComponentsSchema = z
  .array(qualifiedReadyComponentSchema)
  .length(componentRoles.length);

function refineSharedReadyQualification(
  components: readonly z.output<typeof readyComponentSchema>[],
  context: z.RefinementCtx
): void {
  const qualificationIds = new Set(components.map(({ qualificationId }) => qualificationId));
  const policyVersions = new Set(
    components.map(({ qualificationPolicyVersion }) => qualificationPolicyVersion)
  );
  if (qualificationIds.size !== 1 || policyVersions.size !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['components'],
      message: 'Ready components must share one exact model-pair qualification and policy version.',
    });
  }
}

const readyCalculationAuthoritySchema = z
  .object({
    state: z.literal('ready'),
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetArtifact: aflTradeArtifactRefSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
    calculationInputPackageId: aflTradeContentAddressedIdSchema('valuation-calculation-input'),
    calculationInputArtifact: aflTradeArtifactRefSchema,
    inputTraceId: aflTradeContentAddressedIdSchema('private-evaluation-input-trace'),
    inputTraceArtifact: aflTradeArtifactRefSchema,
    gateLedgerRevision: z.number().int().positive(),
    components: z.array(readyComponentSchema).length(componentRoles.length),
  })
  .strict()
  .superRefine((authority, context) => {
    refineSharedReadyQualification(authority.components, context);
    if (
      canonicalizeAflTradeJson(authority.components.map(({ role }) => role)) !==
      canonicalizeAflTradeJson(componentRoles)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Calculation-authority components must use canonical roles.',
      });
    }
    for (const field of [
      'runId',
      'protocolId',
      'datasetId',
      'datasetAdmissionId',
      'gate3DecisionId',
    ] as const) {
      if (new Set(authority.components.map((component) => component[field])).size !== 2) {
        context.addIssue({
          code: 'custom',
          path: ['components'],
          message: `Calculation-authority component ${field} values must be distinct.`,
        });
      }
    }
    if (
      authority.components.some(
        ({ datasetAdmissionGateLedgerRevision }) =>
          datasetAdmissionGateLedgerRevision > authority.gateLedgerRevision
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gateLedgerRevision'],
        message: 'Gate ledger head cannot predate an admitted component.',
      });
    }
    const artifactIds = [
      authority.preparedInputSetArtifact.artifactId,
      authority.valuationInputBundleArtifact.artifactId,
      authority.calculationInputArtifact.artifactId,
      authority.inputTraceArtifact.artifactId,
    ];
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['preparedInputSetArtifact'],
        message: 'Calculation-authority documents require distinct retained bytes.',
      });
    }
  });

const readyCalculationAuthorityV3Schema = z
  .object({
    state: z.literal('ready'),
    preparedInputHeadRevision: z.number().int().positive(),
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    factualRegistryRevision: z.number().int().positive(),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    activeFactualReleaseRevision: z.number().int().positive(),
    privateValuationDecisionId: aflTradeContentAddressedIdSchema(
      'private-valuation-evaluation-decision'
    ),
    privateValuationDecisionRevision: z.number().int().positive(),
    materializationManifestId: aflTradeContentAddressedIdSchema(
      'private-evaluation-materialization-manifest'
    ),
    materializationManifestArtifact: aflTradeArtifactRefSchema,
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
    gateLedgerRevision: z.number().int().positive(),
    components: z.array(readyComponentSchema).length(componentRoles.length),
  })
  .strict()
  .superRefine((authority, context) => {
    refineSharedReadyQualification(authority.components, context);
    if (
      canonicalizeAflTradeJson(authority.components.map(({ role }) => role)) !==
      canonicalizeAflTradeJson(componentRoles)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Calculation-authority components must use canonical roles.',
      });
    }
    for (const field of [
      'runId',
      'protocolId',
      'datasetId',
      'datasetAdmissionId',
      'gate3DecisionId',
    ] as const) {
      if (new Set(authority.components.map((component) => component[field])).size !== 2) {
        context.addIssue({
          code: 'custom',
          path: ['components'],
          message: `Calculation-authority component ${field} values must be distinct.`,
        });
      }
    }
    if (
      authority.components.some(
        ({ datasetAdmissionGateLedgerRevision }) =>
          datasetAdmissionGateLedgerRevision > authority.gateLedgerRevision
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gateLedgerRevision'],
        message: 'Gate ledger head cannot predate an admitted component.',
      });
    }
    if (
      authority.materializationManifestArtifact.artifactId ===
      authority.valuationInputBundleArtifact.artifactId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializationManifestArtifact'],
        message: 'Calculation-authority documents require distinct retained bytes.',
      });
    }
  });

const readyPrivateCalculationAuthorityV3Schema = z
  .object({
    state: z.literal('ready'),
    preparedInputHeadRevision: z.number().int().positive(),
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparationAuthority: z.literal('qualified_current_model_evidence'),
    preparationOperationId: aflTradeContentAddressedIdSchema(
      'valuation-cohort-preparation-operation'
    ),
    currentModelEvidenceOperationId: aflTradeContentAddressedIdSchema(
      'current-valuation-model-evidence-operation'
    ),
    dispatchAuthority: aflTradePrivatePreparedValuationDispatchAuthoritySchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    materializationManifestId: aflTradeContentAddressedIdSchema(
      'private-evaluation-materialization-manifest'
    ),
    materializationManifestArtifact: aflTradeArtifactRefSchema,
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
    gateLedgerRevision: z.number().int().positive(),
    components: z.array(readyComponentSchema).length(componentRoles.length),
  })
  .strict()
  .superRefine((authority, context) => {
    refineSharedReadyQualification(authority.components, context);
    if (
      canonicalizeAflTradeJson(authority.components.map(({ role }) => role)) !==
      canonicalizeAflTradeJson(componentRoles)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Calculation-authority components must use canonical roles.',
      });
    }
    for (const field of [
      'runId',
      'protocolId',
      'datasetId',
      'datasetAdmissionId',
      'gate3DecisionId',
    ] as const) {
      if (new Set(authority.components.map((component) => component[field])).size !== 2) {
        context.addIssue({
          code: 'custom',
          path: ['components'],
          message: `Calculation-authority component ${field} values must be distinct.`,
        });
      }
    }
    if (
      authority.components.some(
        ({ datasetAdmissionGateLedgerRevision }) =>
          datasetAdmissionGateLedgerRevision > authority.gateLedgerRevision
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gateLedgerRevision'],
        message: 'Gate ledger head cannot predate an admitted component.',
      });
    }
    if (
      authority.materializationManifestArtifact.artifactId ===
      authority.valuationInputBundleArtifact.artifactId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializationManifestArtifact'],
        message: 'Calculation-authority documents require distinct retained bytes.',
      });
    }
  });

const readyNonProductionAuthorityContent = {
  ...lifecycleCommonBase,
  environment: z.literal('non_production'),
  calculationAuthority: readyCalculationAuthoritySchema,
  blockers: z.tuple([]),
  limitation: z.literal(READY_NON_PRODUCTION_LIMITATION),
};

const readyNonProductionAuthorityV3Content = {
  ...lifecycleCommonBase,
  environment: z.literal('non_production'),
  calculationAuthority: z.union([
    readyCalculationAuthorityV3Schema,
    readyPrivateCalculationAuthorityV3Schema,
  ]),
  blockers: z.tuple([]),
  limitation: z.literal(READY_NON_PRODUCTION_LIMITATION),
};

function addAuthorityIssues(
  value: {
    capturedAt: string;
    validThrough: string;
    head: z.output<typeof headSchema>;
    lastTransitionId: string | null;
    blockers: readonly z.output<typeof blockerSchema>[];
  },
  context: z.RefinementCtx
): void {
  const window = Date.parse(value.validThrough) - Date.parse(value.capturedAt);
  if (window <= 0 || window > 15 * 60 * 1_000) {
    context.addIssue({
      code: 'custom',
      path: ['validThrough'],
      message: 'Authority snapshot requires one positive short trusted-time window.',
    });
  }
  if ((value.head.status === 'absent') !== (value.lastTransitionId === null)) {
    context.addIssue({
      code: 'custom',
      path: ['lastTransitionId'],
      message: 'Authority snapshot predecessor does not match its lifecycle head.',
    });
  }
  const sorted = [...value.blockers].sort(
    (left, right) =>
      left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
  );
  if (canonicalizeAflTradeJson(sorted) !== canonicalizeAflTradeJson(value.blockers)) {
    context.addIssue({
      code: 'custom',
      path: ['blockers'],
      message: 'Authority snapshot blockers must use canonical ordering.',
    });
  }
}

const unavailableSnapshotContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-authority-snapshot/v1'),
    ...unavailableAuthorityContent,
  })
  .strict()
  .superRefine(addAuthorityIssues);

const readyFixtureSnapshotContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-authority-snapshot/v1'),
    ...readyFixtureAuthorityContent,
  })
  .strict()
  .superRefine(addAuthorityIssues);

const readyNonProductionSnapshotContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-authority-snapshot/v2'),
    ...readyNonProductionAuthorityContent,
  })
  .strict()
  .superRefine((value, context) => {
    addAuthorityIssues(value, context);
    if (
      [
        value.calculationAuthority.preparedInputSetArtifact,
        value.calculationAuthority.valuationInputBundleArtifact,
        value.calculationAuthority.calculationInputArtifact,
        value.calculationAuthority.inputTraceArtifact,
      ].some(({ createdAt }) => Date.parse(createdAt) > Date.parse(value.capturedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculationAuthority'],
        message: 'Calculation-authority artifacts must exist before snapshot capture.',
      });
    }
  });

const unavailableNonProductionSnapshotContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-authority-snapshot/v3'),
    ...unavailableNonProductionAuthorityContent,
  })
  .strict()
  .superRefine(addAuthorityIssues);

const readyNonProductionSnapshotContentV3Schema = z
  .object({
    schemaVersion: z.literal('private-evaluation-authority-snapshot/v3'),
    ...readyNonProductionAuthorityV3Content,
  })
  .strict()
  .superRefine((value, context) => {
    addAuthorityIssues(value, context);
    if (
      [
        value.calculationAuthority.materializationManifestArtifact,
        value.calculationAuthority.valuationInputBundleArtifact,
      ].some(({ createdAt }) => Date.parse(createdAt) > Date.parse(value.capturedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculationAuthority'],
        message: 'Calculation-authority artifacts must exist before snapshot capture.',
      });
    }
  });

const snapshotContentSchema = z.union([
  unavailableSnapshotContentSchema,
  readyFixtureSnapshotContentSchema,
  readyNonProductionSnapshotContentSchema,
  unavailableNonProductionSnapshotContentSchema,
  readyNonProductionSnapshotContentV3Schema,
]);

const snapshotSchema = z
  .object({
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    content: snapshotContentSchema,
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

const unavailableInspectionContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-inspection/v1'),
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    state: z.literal('unavailable'),
    ...unavailableAuthorityContent,
  })
  .strict()
  .superRefine(addAuthorityIssues);

const readyFixtureInspectionContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-inspection/v1'),
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    state: z.literal('ready'),
    ...readyFixtureAuthorityContent,
  })
  .strict()
  .superRefine(addAuthorityIssues);

const readyNonProductionInspectionContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-inspection/v2'),
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    state: z.literal('ready'),
    ...readyNonProductionAuthorityContent,
  })
  .strict()
  .superRefine((value, context) => {
    addAuthorityIssues(value, context);
    if (
      [
        value.calculationAuthority.preparedInputSetArtifact,
        value.calculationAuthority.valuationInputBundleArtifact,
        value.calculationAuthority.calculationInputArtifact,
        value.calculationAuthority.inputTraceArtifact,
      ].some(({ createdAt }) => Date.parse(createdAt) > Date.parse(value.capturedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculationAuthority'],
        message: 'Calculation-authority artifacts must exist before inspection.',
      });
    }
  });

const unavailableNonProductionInspectionContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-inspection/v3'),
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    state: z.literal('unavailable'),
    ...unavailableNonProductionAuthorityContent,
  })
  .strict()
  .superRefine(addAuthorityIssues);

const readyNonProductionInspectionContentV3Schema = z
  .object({
    schemaVersion: z.literal('private-evaluation-inspection/v3'),
    snapshotId: aflTradeContentAddressedIdSchema('private-evaluation-authority-snapshot'),
    state: z.literal('ready'),
    ...readyNonProductionAuthorityV3Content,
  })
  .strict()
  .superRefine((value, context) => {
    addAuthorityIssues(value, context);
    if (
      [
        value.calculationAuthority.materializationManifestArtifact,
        value.calculationAuthority.valuationInputBundleArtifact,
      ].some(({ createdAt }) => Date.parse(createdAt) > Date.parse(value.capturedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculationAuthority'],
        message: 'Calculation-authority artifacts must exist before inspection.',
      });
    }
  });

const inspectionContentSchema = z.union([
  unavailableInspectionContentSchema,
  readyFixtureInspectionContentSchema,
  readyNonProductionInspectionContentSchema,
  unavailableNonProductionInspectionContentSchema,
  readyNonProductionInspectionContentV3Schema,
]);

const inspectionSchema = z
  .object({
    inspectionId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    content: inspectionContentSchema,
  })
  .strict()
  .superRefine((inspection, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-inspection',
      inspection.inspectionId,
      inspection.content,
      context,
      ['inspectionId']
    );
  });

const retainedSchema = z
  .object({ snapshot: snapshotSchema, inspection: inspectionSchema })
  .strict()
  .superRefine((retained, context) => {
    const {
      snapshotId: _snapshotId,
      schemaVersion: _snapshotVersion,
      ...snapshotCommon
    } = {
      snapshotId: retained.snapshot.snapshotId,
      ...retained.snapshot.content,
    };
    const {
      snapshotId,
      state: _state,
      schemaVersion: _inspectionVersion,
      ...inspectionCommon
    } = retained.inspection.content;
    if (
      snapshotId !== retained.snapshot.snapshotId ||
      canonicalizeAflTradeJson(snapshotCommon) !== canonicalizeAflTradeJson(inspectionCommon)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['inspection'],
        message: 'Authority inspection does not authenticate its exact snapshot.',
      });
    }
  });

type CreationInput = Readonly<{
  selector: z.input<typeof governedPrivateEvaluationSelectorSchema>;
  capturedAt: string;
  validThrough: string;
  head: z.input<typeof headSchema>;
  lastTransitionId: string | null;
  blockers: readonly z.input<typeof blockerSchema>[];
}>;

type ReadyFixtureCreationInput = Readonly<{
  selector: z.input<typeof governedPrivateEvaluationSelectorSchema>;
  capturedAt: string;
  validThrough: string;
  head: z.input<typeof headSchema>;
  lastTransitionId: string | null;
  playerModelRunId: string;
  pickModelRunId: string;
}>;

type ReadyCreationInput = Readonly<{
  selector: z.input<typeof governedPrivateEvaluationSelectorSchema>;
  capturedAt: string;
  validThrough: string;
  head: z.input<typeof headSchema>;
  lastTransitionId: string | null;
  preparedInputSetId: string;
  preparedInputSetArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  factualReleaseId: string;
  valuationInputBundleId: string;
  valuationInputBundleArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  calculationInputPackageId: string;
  calculationInputArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  inputTraceId: string;
  inputTraceArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  gateLedgerRevision: number;
  components: readonly z.input<typeof qualifiedReadyComponentSchema>[];
}>;

type ReadyV3CommonCreationInput = Readonly<{
  selector: z.input<typeof governedPrivateEvaluationSelectorSchema>;
  capturedAt: string;
  validThrough: string;
  head: z.input<typeof headSchema>;
  lastTransitionId: string | null;
  preparedInputHeadRevision: number;
  preparedInputSetId: string;
  factualReleaseId: string;
  materializationManifestId: string;
  materializationManifestArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  valuationInputBundleId: string;
  valuationInputBundleArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  gateLedgerRevision: number;
  components: readonly z.input<typeof qualifiedReadyComponentSchema>[];
}>;

type ReadyV3CreationInput = ReadyV3CommonCreationInput &
  (
    | Readonly<{
        factualRegistryRevision: number;
        activeFactualReleaseRevision: number;
        privateValuationDecisionId: string;
        privateValuationDecisionRevision: number;
      }>
    | Readonly<{
        preparationAuthority: 'qualified_current_model_evidence';
        preparationOperationId: string;
        currentModelEvidenceOperationId: string;
        dispatchAuthority: z.input<typeof aflTradePrivatePreparedValuationDispatchAuthoritySchema>;
      }>
  );

function resultOf(retained: z.output<typeof retainedSchema>) {
  return governedPrivateEvaluationInspectResultSchema.parse({
    state: retained.inspection.content.state,
    selector: retained.inspection.content.selector,
    inspectionId: retained.inspection.inspectionId,
    validThrough: retained.inspection.content.validThrough,
    head: retained.inspection.content.head,
    blockers: retained.inspection.content.blockers,
  });
}

export function authenticateGovernedPrivateEvaluationAuthorityInspection(input: unknown) {
  const retainedInput = input as { snapshot?: unknown; inspection?: unknown };
  const retained = retainedSchema.parse({
    snapshot: retainedInput?.snapshot,
    inspection: retainedInput?.inspection,
  });
  return { ...retained, result: resultOf(retained) };
}

export function createUnavailableGovernedPrivateEvaluationAuthorityInspection(
  input: CreationInput
) {
  const common = {
    environment: 'test_fixture' as const,
    publicationProhibited: true as const,
    selector: input.selector,
    capturedAt: input.capturedAt,
    validThrough: input.validThrough,
    head: input.head,
    lastTransitionId: input.lastTransitionId,
    calculationAuthority: {
      state: 'unavailable' as const,
      playerModelRunId: null,
      pickModelRunId: null,
    },
    blockers: [...input.blockers].sort(
      (left, right) =>
        left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
    ),
    limitation: LIMITATION,
  };
  const snapshotContent = snapshotContentSchema.parse({
    schemaVersion: 'private-evaluation-authority-snapshot/v1',
    ...common,
  });
  const snapshot = snapshotSchema.parse({
    snapshotId: createAflTradeContentAddress(
      'private-evaluation-authority-snapshot',
      snapshotContent
    ),
    content: snapshotContent,
  });
  const inspectionContent = inspectionContentSchema.parse({
    schemaVersion: 'private-evaluation-inspection/v1',
    snapshotId: snapshot.snapshotId,
    state: 'unavailable',
    ...common,
  });
  const inspection = inspectionSchema.parse({
    inspectionId: createAflTradeContentAddress('private-evaluation-inspection', inspectionContent),
    content: inspectionContent,
  });
  return authenticateGovernedPrivateEvaluationAuthorityInspection({ snapshot, inspection });
}

export function createUnavailableNonProductionGovernedPrivateEvaluationAuthorityInspection(
  input: CreationInput
) {
  const common = {
    environment: 'non_production' as const,
    publicationProhibited: true as const,
    selector: input.selector,
    capturedAt: input.capturedAt,
    validThrough: input.validThrough,
    head: input.head,
    lastTransitionId: input.lastTransitionId,
    calculationAuthority: {
      state: 'unavailable' as const,
      playerModelRunId: null,
      pickModelRunId: null,
    },
    blockers: [...input.blockers].sort(
      (left, right) =>
        left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
    ),
    limitation: UNAVAILABLE_NON_PRODUCTION_LIMITATION,
  };
  const snapshotContent = unavailableNonProductionSnapshotContentSchema.parse({
    schemaVersion: 'private-evaluation-authority-snapshot/v3',
    ...common,
  });
  const snapshot = snapshotSchema.parse({
    snapshotId: createAflTradeContentAddress(
      'private-evaluation-authority-snapshot',
      snapshotContent
    ),
    content: snapshotContent,
  });
  const inspectionContent = unavailableNonProductionInspectionContentSchema.parse({
    schemaVersion: 'private-evaluation-inspection/v3',
    snapshotId: snapshot.snapshotId,
    state: 'unavailable',
    ...common,
  });
  const inspection = inspectionSchema.parse({
    inspectionId: createAflTradeContentAddress('private-evaluation-inspection', inspectionContent),
    content: inspectionContent,
  });
  return authenticateGovernedPrivateEvaluationAuthorityInspection({ snapshot, inspection });
}

export function createReadyFixtureGovernedPrivateEvaluationAuthorityInspection(
  input: ReadyFixtureCreationInput
) {
  const common = {
    environment: 'test_fixture' as const,
    publicationProhibited: true as const,
    selector: input.selector,
    capturedAt: input.capturedAt,
    validThrough: input.validThrough,
    head: input.head,
    lastTransitionId: input.lastTransitionId,
    calculationAuthority: {
      state: 'ready' as const,
      playerModelRunId: input.playerModelRunId,
      pickModelRunId: input.pickModelRunId,
    },
    blockers: [] as const,
    limitation: READY_FIXTURE_LIMITATION,
  };
  const snapshotContent = readyFixtureSnapshotContentSchema.parse({
    schemaVersion: 'private-evaluation-authority-snapshot/v1',
    ...common,
  });
  const snapshot = snapshotSchema.parse({
    snapshotId: createAflTradeContentAddress(
      'private-evaluation-authority-snapshot',
      snapshotContent
    ),
    content: snapshotContent,
  });
  const inspectionContent = readyFixtureInspectionContentSchema.parse({
    schemaVersion: 'private-evaluation-inspection/v1',
    snapshotId: snapshot.snapshotId,
    state: 'ready',
    ...common,
  });
  const inspection = inspectionSchema.parse({
    inspectionId: createAflTradeContentAddress('private-evaluation-inspection', inspectionContent),
    content: inspectionContent,
  });
  return authenticateGovernedPrivateEvaluationAuthorityInspection({ snapshot, inspection });
}

export function createReadyGovernedPrivateEvaluationAuthorityInspection(input: ReadyCreationInput) {
  const components = qualifiedReadyComponentsSchema.parse(input.components);
  const common = {
    environment: 'non_production' as const,
    publicationProhibited: true as const,
    selector: input.selector,
    capturedAt: input.capturedAt,
    validThrough: input.validThrough,
    head: input.head,
    lastTransitionId: input.lastTransitionId,
    calculationAuthority: {
      state: 'ready' as const,
      preparedInputSetId: input.preparedInputSetId,
      preparedInputSetArtifact: input.preparedInputSetArtifact,
      factualReleaseId: input.factualReleaseId,
      valuationInputBundleId: input.valuationInputBundleId,
      valuationInputBundleArtifact: input.valuationInputBundleArtifact,
      calculationInputPackageId: input.calculationInputPackageId,
      calculationInputArtifact: input.calculationInputArtifact,
      inputTraceId: input.inputTraceId,
      inputTraceArtifact: input.inputTraceArtifact,
      gateLedgerRevision: input.gateLedgerRevision,
      components,
    },
    blockers: [] as const,
    limitation: READY_NON_PRODUCTION_LIMITATION,
  };
  const snapshotContent = readyNonProductionSnapshotContentSchema.parse({
    schemaVersion: 'private-evaluation-authority-snapshot/v2',
    ...common,
  });
  const snapshot = snapshotSchema.parse({
    snapshotId: createAflTradeContentAddress(
      'private-evaluation-authority-snapshot',
      snapshotContent
    ),
    content: snapshotContent,
  });
  const inspectionContent = readyNonProductionInspectionContentSchema.parse({
    schemaVersion: 'private-evaluation-inspection/v2',
    snapshotId: snapshot.snapshotId,
    state: 'ready',
    ...common,
  });
  const inspection = inspectionSchema.parse({
    inspectionId: createAflTradeContentAddress('private-evaluation-inspection', inspectionContent),
    content: inspectionContent,
  });
  return authenticateGovernedPrivateEvaluationAuthorityInspection({ snapshot, inspection });
}

export function createReadyGovernedPrivateEvaluationAuthorityInspectionV3(
  input: ReadyV3CreationInput
) {
  const components = qualifiedReadyComponentsSchema.parse(input.components);
  const preparedAuthority =
    'preparationAuthority' in input
      ? {
          preparationAuthority: input.preparationAuthority,
          preparationOperationId: input.preparationOperationId,
          currentModelEvidenceOperationId: input.currentModelEvidenceOperationId,
          dispatchAuthority: input.dispatchAuthority,
        }
      : {
          factualRegistryRevision: input.factualRegistryRevision,
          activeFactualReleaseRevision: input.activeFactualReleaseRevision,
          privateValuationDecisionId: input.privateValuationDecisionId,
          privateValuationDecisionRevision: input.privateValuationDecisionRevision,
        };
  const common = {
    environment: 'non_production' as const,
    publicationProhibited: true as const,
    selector: input.selector,
    capturedAt: input.capturedAt,
    validThrough: input.validThrough,
    head: input.head,
    lastTransitionId: input.lastTransitionId,
    calculationAuthority: {
      state: 'ready' as const,
      preparedInputHeadRevision: input.preparedInputHeadRevision,
      preparedInputSetId: input.preparedInputSetId,
      factualReleaseId: input.factualReleaseId,
      ...preparedAuthority,
      materializationManifestId: input.materializationManifestId,
      materializationManifestArtifact: input.materializationManifestArtifact,
      valuationInputBundleId: input.valuationInputBundleId,
      valuationInputBundleArtifact: input.valuationInputBundleArtifact,
      gateLedgerRevision: input.gateLedgerRevision,
      components,
    },
    blockers: [] as const,
    limitation: READY_NON_PRODUCTION_LIMITATION,
  };
  const snapshotContent = readyNonProductionSnapshotContentV3Schema.parse({
    schemaVersion: 'private-evaluation-authority-snapshot/v3',
    ...common,
  });
  const snapshot = snapshotSchema.parse({
    snapshotId: createAflTradeContentAddress(
      'private-evaluation-authority-snapshot',
      snapshotContent
    ),
    content: snapshotContent,
  });
  const inspectionContent = readyNonProductionInspectionContentV3Schema.parse({
    schemaVersion: 'private-evaluation-inspection/v3',
    snapshotId: snapshot.snapshotId,
    state: 'ready',
    ...common,
  });
  const inspection = inspectionSchema.parse({
    inspectionId: createAflTradeContentAddress('private-evaluation-inspection', inspectionContent),
    content: inspectionContent,
  });
  return authenticateGovernedPrivateEvaluationAuthorityInspection({ snapshot, inspection });
}
