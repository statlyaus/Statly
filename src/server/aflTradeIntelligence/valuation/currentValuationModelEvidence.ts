import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const idSchema = z.string().trim().min(1).max(400);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const instantSchema = z.iso.datetime({ offset: true });

export const AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_SCHEMA_VERSION =
  'afl-current-valuation-model-evidence-result/v1' as const;
export const AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_LIMITATION =
  'Private local non-production model evidence only; no prepared-input, valuation, production, activation, or publication authority is granted.' as const;

export const aflTradeCurrentPrivateFactualAuthoritySchema = z
  .object({
    valuationScopeKey: idSchema,
    candidateId: aflTradeContentAddressedIdSchema('private-factual-candidate'),
    evidenceScopeKey: idSchema,
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    reviewDecisionId: aflTradeContentAddressedIdSchema(
      'private-reviewed-evidence-evaluation-decision'
    ),
    normalizedReconciledCustodySha256: sha256Schema,
    revision: z.number().int().positive(),
  })
  .strict();

export const aflTradeCurrentValuationModelEvidenceRequestSchema = z
  .object({
    scopeKey: idSchema,
    factualOperationId: aflTradeContentAddressedIdSchema(
      'current-valuation-factual-refresh-operation'
    ),
    privateFactualAuthority: aflTradeCurrentPrivateFactualAuthoritySchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.scopeKey !== request.privateFactualAuthority.valuationScopeKey) {
      context.addIssue({
        code: 'custom',
        path: ['privateFactualAuthority', 'valuationScopeKey'],
        message: 'Current model evidence must use the requested factual authority scope.',
      });
    }
  });

const evidenceBaseShape = {
  schemaVersion: z.literal(AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_SCHEMA_VERSION),
  operationId: aflTradeContentAddressedIdSchema('current-valuation-model-evidence-operation'),
  scopeKey: idSchema,
  factualOperationId: aflTradeContentAddressedIdSchema(
    'current-valuation-factual-refresh-operation'
  ),
  privateFactualAuthority: aflTradeCurrentPrivateFactualAuthoritySchema,
  expectedModelRevision: z.number().int().nonnegative(),
  modelRevision: z.number().int().nonnegative(),
  capturedAt: instantSchema,
  completedAt: instantSchema,
  executionLocation: z.literal('local'),
  visibility: z.literal('private'),
  environment: z.literal('non_production'),
  publicationEligible: z.literal(false),
  publicationProhibited: z.literal(true),
  limitation: z.literal(AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_LIMITATION),
} as const;

const componentEvidenceShape = {
  playerObservationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
  pickBenchmarkEvidenceId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
  playerRunId: aflTradeContentAddressedIdSchema('model-run'),
  pickRunId: aflTradeContentAddressedIdSchema('model-run'),
  qualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
} as const;

const qualifiedCurrentValuationModelEvidenceResultShapeSchema = z
  .object({
    ...evidenceBaseShape,
    ...componentEvidenceShape,
    state: z.literal('qualified'),
    qualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    playerGate3DecisionId: idSchema,
    pickGate3DecisionId: idSchema,
  })
  .strict();

const failedCurrentValuationModelEvidenceResultShapeSchema = z
  .object({
    ...evidenceBaseShape,
    ...componentEvidenceShape,
    state: z.literal('qualification_failed'),
    failureCodes: z.array(idSchema).min(1).max(100),
  })
  .strict();

export const aflTradeCurrentValuationModelEvidenceResultSchema = z
  .discriminatedUnion('state', [
    qualifiedCurrentValuationModelEvidenceResultShapeSchema,
    failedCurrentValuationModelEvidenceResultShapeSchema,
  ])
  .superRefine((result, context) => {
    if (result.scopeKey !== result.privateFactualAuthority.valuationScopeKey) {
      context.addIssue({
        code: 'custom',
        path: ['privateFactualAuthority', 'valuationScopeKey'],
        message: 'Retained model evidence escaped its factual authority scope.',
      });
    }
    const expectedOperationId = createAflTradeContentAddress(
      'current-valuation-model-evidence-operation',
      createAflTradeCurrentValuationModelEvidenceOperationPreimage(result)
    );
    if (result.operationId !== expectedOperationId) {
      context.addIssue({
        code: 'custom',
        path: ['operationId'],
        message: 'Current model evidence operation identity must bind exact factual authority.',
      });
    }
    const expectedRevision =
      result.state === 'qualified'
        ? result.expectedModelRevision + 1
        : result.expectedModelRevision;
    if (result.modelRevision !== expectedRevision) {
      context.addIssue({
        code: 'custom',
        path: ['modelRevision'],
        message: 'Current model revision must advance exactly once only for a qualified pair.',
      });
    }
    if (result.playerRunId === result.pickRunId) {
      context.addIssue({
        code: 'custom',
        path: ['pickRunId'],
        message: 'Current model evidence requires distinct player and pick runs.',
      });
    }
    if (
      result.state === 'qualified' &&
      result.playerGate3DecisionId === result.pickGate3DecisionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickGate3DecisionId'],
        message: 'Qualified player and pick components require distinct Gate 3 decisions.',
      });
    }
    if (
      result.state === 'qualification_failed' &&
      (new Set(result.failureCodes).size !== result.failureCodes.length ||
        result.failureCodes.some(
          (code, index) => index > 0 && result.failureCodes[index - 1]! > code
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failureCodes'],
        message: 'Qualification failure codes must be unique and canonically ordered.',
      });
    }
    if (Date.parse(result.completedAt) < Date.parse(result.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Current model evidence cannot complete before authority capture.',
      });
    }
  });

export const aflTradeQualifiedCurrentValuationModelEvidenceResultSchema = z.intersection(
  aflTradeCurrentValuationModelEvidenceResultSchema,
  z.object({ state: z.literal('qualified') }).passthrough()
);

export type AflTradeCurrentValuationModelEvidenceRequest = z.infer<
  typeof aflTradeCurrentValuationModelEvidenceRequestSchema
>;
export type AflTradeCurrentValuationModelEvidenceResult = z.infer<
  typeof aflTradeCurrentValuationModelEvidenceResultSchema
>;

export function createAflTradeCurrentValuationModelEvidenceOperationPreimage(input: {
  readonly scopeKey: string;
  readonly factualOperationId: string;
  readonly privateFactualAuthority: z.infer<typeof aflTradeCurrentPrivateFactualAuthoritySchema>;
}) {
  return {
    scopeKey: input.scopeKey,
    factualOperationId: input.factualOperationId,
    privateFactualAuthority: input.privateFactualAuthority,
  } as const;
}

export type AflTradeCurrentValuationPreparedModelEvidence =
  | Readonly<{
      state: 'qualified';
      playerObservationSetId: string;
      pickBenchmarkEvidenceId: string;
      playerRunId: string;
      pickRunId: string;
      qualificationId: string;
      qualificationWorkId: string;
      playerGate3DecisionId: string;
      pickGate3DecisionId: string;
    }>
  | Readonly<{
      state: 'qualification_failed';
      playerObservationSetId: string;
      pickBenchmarkEvidenceId: string;
      playerRunId: string;
      pickRunId: string;
      qualificationId: string;
      failureCodes: readonly string[];
    }>;

export interface AflTradeCurrentValuationModelEvidenceRepository {
  load(operationId: string): Promise<AflTradeCurrentValuationModelEvidenceResult | null>;
  commit(input: {
    readonly expectedModelRevision: number;
    readonly result: AflTradeCurrentValuationModelEvidenceResult;
  }): Promise<
    | { readonly state: 'committed'; readonly result: AflTradeCurrentValuationModelEvidenceResult }
    | { readonly state: 'stale_authority' }
  >;
}

export function createAflTradeCurrentValuationModelEvidenceOperationId(
  unparsedRequest: AflTradeCurrentValuationModelEvidenceRequest
): string {
  const request = aflTradeCurrentValuationModelEvidenceRequestSchema.parse(unparsedRequest);
  return createAflTradeContentAddress(
    'current-valuation-model-evidence-operation',
    createAflTradeCurrentValuationModelEvidenceOperationPreimage(request)
  );
}

export function createAflTradeCurrentValuationModelEvidenceCoordinator(dependencies: {
  readonly repository: AflTradeCurrentValuationModelEvidenceRepository;
  readonly captureCurrentModelRevision: (scopeKey: string) => Promise<number>;
  readonly prepareAndQualify: (
    input: AflTradeCurrentValuationModelEvidenceRequest & { readonly operationId: string }
  ) => Promise<AflTradeCurrentValuationPreparedModelEvidence>;
  readonly clock: { readonly now: () => string };
}) {
  return {
    async refresh(unparsedRequest: AflTradeCurrentValuationModelEvidenceRequest) {
      const request = aflTradeCurrentValuationModelEvidenceRequestSchema.parse(unparsedRequest);
      const operationId = createAflTradeCurrentValuationModelEvidenceOperationId(request);
      const replay = await dependencies.repository.load(operationId);
      if (replay !== null) return replay;
      const expectedModelRevision = z
        .number()
        .int()
        .nonnegative()
        .parse(await dependencies.captureCurrentModelRevision(request.scopeKey));
      const capturedAt = instantSchema.parse(dependencies.clock.now());
      const prepared = await dependencies.prepareAndQualify({ ...request, operationId });
      const completedAt = instantSchema.parse(dependencies.clock.now());
      const result = aflTradeCurrentValuationModelEvidenceResultSchema.parse({
        schemaVersion: AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_SCHEMA_VERSION,
        operationId,
        scopeKey: request.scopeKey,
        factualOperationId: request.factualOperationId,
        privateFactualAuthority: request.privateFactualAuthority,
        expectedModelRevision,
        modelRevision:
          prepared.state === 'qualified' ? expectedModelRevision + 1 : expectedModelRevision,
        ...prepared,
        capturedAt,
        completedAt,
        executionLocation: 'local',
        visibility: 'private',
        environment: 'non_production',
        publicationEligible: false,
        publicationProhibited: true,
        limitation: AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_LIMITATION,
      });
      const committed = await dependencies.repository.commit({ expectedModelRevision, result });
      return committed.state === 'committed'
        ? committed.result
        : ({
            state: 'stale_authority' as const,
            operationId,
            expectedModelRevision,
          } as const);
    },
  };
}
