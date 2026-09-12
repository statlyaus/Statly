import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';
import { AflTradeCurrentValuationModelEvidencePreparationError } from './currentValuationModelEvidencePreparation';

export type AflTradePrivateRecalculationDispatch = Readonly<{
  request: ReturnType<typeof aflTradePrivateValuationDispatchRequestSchema.parse>;
  claim: Readonly<{ claimId: string; leaseToken: string }>;
}>;

type FactualRefresh =
  | Readonly<{ state: 'no_change' }>
  | Readonly<{
      state: 'factual_refresh_complete';
      operationId: string;
      scopeKey: string;
      privateFactualAuthority: unknown;
    }>;

type EvidenceResult =
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{ state: 'complete'; currentValuationRefresh: FactualRefresh }>;

type ModelEvidenceResult = Readonly<{
  state: 'qualified' | 'qualification_failed' | 'stale_authority';
}>;

type PreparedResult = Readonly<{
  state: 'advanced' | 'already_current' | 'stale_authority';
}>;

export function createAflTradePrivateRecalculationCoordinator(dependencies: {
  readonly evidence: Readonly<{
    refreshCurrent(input: {
      readonly scopeKey: string;
      readonly trigger: AflTradePrivateRecalculationDispatch['request']['trigger'];
      readonly stableOperationKey: string;
    }): Promise<EvidenceResult>;
  }>;
  readonly modelEvidence: Readonly<{
    refresh(input: {
      readonly dispatch: AflTradePrivateRecalculationDispatch;
      readonly factual: Extract<FactualRefresh, { readonly state: 'factual_refresh_complete' }>;
    }): Promise<ModelEvidenceResult>;
  }>;
  readonly prepared: Readonly<{
    prepare(input: AflTradePrivateRecalculationDispatch): Promise<PreparedResult>;
  }>;
  readonly batch: Readonly<{
    runPrivate(input: AflTradePrivateRecalculationDispatch): Promise<unknown>;
  }>;
}) {
  return {
    async run(unparsedDispatch: AflTradePrivateRecalculationDispatch) {
      const dispatch = {
        request: aflTradePrivateValuationDispatchRequestSchema.parse(unparsedDispatch.request),
        claim: unparsedDispatch.claim,
      };
      const factual = await dependencies.evidence.refreshCurrent({
        scopeKey: dispatch.request.scopeKey,
        trigger: dispatch.request.trigger,
        stableOperationKey: dispatch.request.requestId,
      });
      if (factual.state === 'unavailable') return { state: 'exhausted' as const };
      if (factual.currentValuationRefresh.state === 'no_change') {
        return dependencies.batch.runPrivate(dispatch);
      }

      let model: ModelEvidenceResult;
      try {
        model = await dependencies.modelEvidence.refresh({
          dispatch,
          factual: factual.currentValuationRefresh,
        });
      } catch (error) {
        if (!(error instanceof AflTradeCurrentValuationModelEvidencePreparationError)) throw error;
        return {
          state:
            error.state === 'deterministic_failure' ? ('unexpected_failure' as const) : error.state,
        };
      }
      if (model.state === 'stale_authority') return { state: 'stale_authority' as const };
      if (model.state === 'qualification_failed') {
        return { state: 'unexpected_failure' as const };
      }

      const prepared = await dependencies.prepared.prepare(dispatch);
      if (prepared.state === 'stale_authority') return { state: 'stale_authority' as const };
      return dependencies.batch.runPrivate(dispatch);
    },
  };
}
