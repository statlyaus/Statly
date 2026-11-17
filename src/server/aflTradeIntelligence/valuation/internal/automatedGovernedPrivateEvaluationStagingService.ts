import { z } from 'zod';

import { createAflTradeCanonicalJsonArtifactRef, type AflTradeArtifactRef } from '../../artifacts/artifactReference';
import { aflTradeContentAddressedIdSchema, canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import {
  createAutomatedGovernedPrivateEvaluationGeneration,
  type GovernedPrivateEvaluationGenerationMaterialization,
} from '../governedPrivateEvaluationGeneration';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../automatedPrivateEvaluationPolicy';
import {
  createAutomatedGovernedPrivateEvaluationTransitionIntent,
  createAutomatedGovernedPrivateEvaluationTransitionReceipt,
  type AutomatedGovernedPrivateEvaluationTransitionIntent,
  type AutomatedGovernedPrivateEvaluationTransitionReceipt,
} from './governedPrivateEvaluationLifecycle';
import type { GovernedPrivateEvaluationMaterializationResult } from './governedPrivateEvaluationMaterializer';
import { governedPrivateEvaluationSelectorSchema } from './governedPrivateEvaluationWorkspaceContracts';

const requestSchema = z
  .object({
    selector: governedPrivateEvaluationSelectorSchema,
    operationId: aflTradeContentAddressedIdSchema('private-evaluation-operation'),
  })
  .strict();

type Selector = z.infer<typeof governedPrivateEvaluationSelectorSchema>;
type Head = Readonly<{
  status: 'absent' | 'active' | 'withdrawn';
  revision: number;
  generationId: string | null;
}>;
type CapturedAuthority =
  | Readonly<{
      state: 'unavailable';
      selector: Selector;
      blockers: readonly Readonly<{ code: string; message: string }>[];
    }>
  | Readonly<{
      state: 'ready';
      selector: Selector;
      inspectionId: string;
      authoritySnapshotId: string;
      validThrough: string;
      head: Head;
      previousTransitionId: string | null;
      materializationManifestId: string;
    }>;

interface StagedOperation {
  readonly selector: Selector;
  readonly principalId: string;
  readonly generationId: string;
  readonly intent: AutomatedGovernedPrivateEvaluationTransitionIntent;
  readonly previousTransitionId: string | null;
}

interface Dependencies {
  readonly trustedNow: () => Promise<string>;
  readonly loadStaged: (operationId: string) => Promise<StagedOperation | null>;
  readonly captureAuthority: (input: { readonly selector: Selector }) => Promise<CapturedAuthority>;
  readonly replayMaterialization: (input: {
    readonly materializationManifestId: string;
  }) => Promise<GovernedPrivateEvaluationMaterializationResult>;
  readonly stage: (input: {
    readonly intent: AutomatedGovernedPrivateEvaluationTransitionIntent;
    readonly intentArtifact: AflTradeArtifactRef;
    readonly materialization: GovernedPrivateEvaluationGenerationMaterialization;
  }) => Promise<{
    readonly transitionIntentId: string;
    readonly generationId: string | null;
  }>;
  readonly retainArtifact: (input: {
    readonly reference: AflTradeArtifactRef;
    readonly bytes: Uint8Array;
  }) => Promise<AflTradeArtifactRef>;
  readonly commit: (input: {
    readonly receipt: AutomatedGovernedPrivateEvaluationTransitionReceipt;
    readonly receiptArtifact: AflTradeArtifactRef;
  }) => Promise<
    | Readonly<{
        state: 'committed' | 'replayed';
        head: Head;
        transitionId: string;
      }>
    | Readonly<{ state: 'conflict'; expectedHead: Head; actualHead: Head }>
  >;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

export function createAutomatedGovernedPrivateEvaluationStagingService(
  dependencies: Dependencies
) {
  if ('principalId' in dependencies) {
    throw new TypeError(
      'Automated private staging does not accept a caller-supplied principal.'
    );
  }
  const activate = async (input: {
    readonly request: z.infer<typeof requestSchema>;
    readonly intent: AutomatedGovernedPrivateEvaluationTransitionIntent;
    readonly generationId: string;
    readonly previousTransitionId: string | null;
  }) => {
    const receipt = createAutomatedGovernedPrivateEvaluationTransitionReceipt({
      intent: input.intent,
      previousTransitionId: input.previousTransitionId,
      toGenerationId: input.generationId,
      transitionedAt: input.intent.content.requestedAt,
    });
    const receiptArtifact = createAflTradeCanonicalJsonArtifactRef(
      receipt,
      receipt.content.transitionedAt
    );
    const retained = await dependencies.retainArtifact({
      reference: receiptArtifact,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(receipt)),
    });
    if (!same(retained, receiptArtifact)) {
      throw new TypeError('Automated private activation changed its receipt identity.');
    }
    const committed = await dependencies.commit({ receipt, receiptArtifact });
    if (committed.state === 'conflict') {
      return {
        state: 'stale_authority' as const,
        selector: input.request.selector,
        operationId: input.request.operationId,
      };
    }
    return {
      state: 'activated' as const,
      selector: input.request.selector,
      operationId: input.request.operationId,
      generationId: input.generationId,
      head: committed.head,
    };
  };
  return {
    async stage(unparsedRequest: z.input<typeof requestSchema>) {
      const request = requestSchema.parse(unparsedRequest);
      const existing = await dependencies.loadStaged(request.operationId);
      if (existing !== null) {
        if (
          existing.principalId !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID ||
          !same(existing.selector, request.selector)
        ) {
          throw new TypeError('Automated private staging replay conflicts with its operation.');
        }
        return activate({
          request,
          intent: existing.intent,
          generationId: existing.generationId,
          previousTransitionId: existing.previousTransitionId,
        });
      }
      const authority = await dependencies.captureAuthority({ selector: request.selector });
      if (!same(authority.selector, request.selector)) {
        throw new TypeError('Automated private staging escaped its requested selector.');
      }
      if (authority.state === 'unavailable') {
        return {
          state: 'unavailable' as const,
          selector: request.selector,
          operationId: request.operationId,
          blockers: authority.blockers,
        };
      }
      const requestedAt = await dependencies.trustedNow();
      if (
        !Number.isFinite(Date.parse(requestedAt)) ||
        Date.parse(requestedAt) > Date.parse(authority.validThrough)
      ) {
        return {
          state: 'stale_authority' as const,
          selector: request.selector,
          operationId: request.operationId,
        };
      }
      const replay = await dependencies.replayMaterialization({
        materializationManifestId: authority.materializationManifestId,
      });
      if (replay.state === 'unavailable') {
        return {
          state: 'unavailable' as const,
          selector: request.selector,
          operationId: request.operationId,
          blockers: replay.blockers.map(({ code, message }) => ({
            code: 'insufficient_data' as const,
            message: `${code}: ${message}`,
          })),
        };
      }
      const constructionAuthority = {
        kind: 'automated_private_calculation_agent' as const,
        principalId: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
      };
      const intent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
        selector: request.selector,
        inspectionId: authority.inspectionId,
        authoritySnapshotId: authority.authoritySnapshotId,
        operationId: request.operationId,
        action: { kind: 'construct_and_activate' },
        expectedHead: authority.head,
        constructionAuthority,
        requestedAt,
        expiresAt: authority.validThrough,
      });
      const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, requestedAt);
      const materialization = createAutomatedGovernedPrivateEvaluationGeneration({
        selector: request.selector,
        transitionIntentId: intent.transitionIntentId,
        generatedAt: requestedAt,
        constructionAuthority,
        narrative: replay.narrative,
      });
      const staged = await dependencies.stage({ intent, intentArtifact, materialization });
      if (
        staged.transitionIntentId !== intent.transitionIntentId ||
        staged.generationId !== materialization.generation.generationId
      ) {
        throw new TypeError('Automated private staging did not retain its exact generation.');
      }
      return activate({
        request,
        intent,
        generationId: materialization.generation.generationId,
        previousTransitionId: authority.previousTransitionId,
      });
    },
  };
}
