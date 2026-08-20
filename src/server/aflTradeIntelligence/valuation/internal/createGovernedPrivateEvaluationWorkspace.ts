import { doesAflTradeArtifactRefMatchBytes } from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { GovernedPrivateEvaluationWorkspace } from '../governedPrivateEvaluationWorkspace';
import {
  governedPrivateEvaluationExecuteRequestSchema,
  governedPrivateEvaluationExecuteResultSchema,
  governedPrivateEvaluationInspectRequestSchema,
  governedPrivateEvaluationInspectResultSchema,
  governedPrivateEvaluationReadRequestSchema,
  governedPrivateEvaluationReadResultSchema,
  type GovernedPrivateEvaluationExecuteRequest,
  type GovernedPrivateEvaluationInspectRequest,
  type GovernedPrivateEvaluationReadRequest,
} from './governedPrivateEvaluationWorkspaceContracts';

interface GovernedPrivateEvaluationInternalComposition {
  readonly inspect: (request: GovernedPrivateEvaluationInspectRequest) => Promise<unknown>;
  readonly execute: (request: GovernedPrivateEvaluationExecuteRequest) => Promise<unknown>;
  readonly read: (request: GovernedPrivateEvaluationReadRequest) => Promise<unknown>;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

export function createGovernedPrivateEvaluationWorkspaceForInternalComposition(
  composition: GovernedPrivateEvaluationInternalComposition
): GovernedPrivateEvaluationWorkspace {
  return {
    async inspect(unparsedRequest) {
      const request = governedPrivateEvaluationInspectRequestSchema.parse(unparsedRequest);
      const result = governedPrivateEvaluationInspectResultSchema.parse(
        await composition.inspect(request)
      );
      if (!sameCanonicalJson(result.selector, request)) {
        throw new RangeError('The governed private evaluation inspection escaped its selector.');
      }
      return result;
    },

    async execute(unparsedRequest) {
      const request = governedPrivateEvaluationExecuteRequestSchema.parse(unparsedRequest);
      const result = governedPrivateEvaluationExecuteResultSchema.parse(
        await composition.execute(request)
      );
      if (result.operationId !== request.operationId) {
        throw new RangeError('The governed private evaluation execution escaped its operation.');
      }
      if (result.inspectionId !== request.inspectionId) {
        throw new RangeError('The governed private evaluation execution escaped its inspection.');
      }
      return result;
    },

    async read(unparsedRequest) {
      const request = governedPrivateEvaluationReadRequestSchema.parse(unparsedRequest);
      const result = governedPrivateEvaluationReadResultSchema.parse(await composition.read(request));
      if (!sameCanonicalJson(result.selector, request.selector)) {
        throw new RangeError('The governed private evaluation read escaped its selector.');
      }
      if (!sameCanonicalJson(result.selection, request.selection)) {
        throw new RangeError('The governed private evaluation read escaped its exact selection.');
      }
      if (result.document.kind !== request.document.kind) {
        throw new RangeError('The governed private evaluation read escaped its document selection.');
      }
      if (
        result.state === 'available' &&
        request.selection.kind === 'generation' &&
        result.generationId !== request.selection.generationId
      ) {
        throw new RangeError('The governed private evaluation read escaped its exact generation.');
      }
      if (
        result.state === 'available' &&
        !doesAflTradeArtifactRefMatchBytes(result.document.artifact, result.bytes)
      ) {
        throw new RangeError('The governed private evaluation read returned unauthenticated bytes.');
      }
      return result;
    },
  };
}
