import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  governedPrivateEvaluationSelectorSchema,
  privateEvaluationAuthoritySnapshotSchema,
  privateEvaluationExecutionCommandSchema,
  privateEvaluationExecutionResultSchema,
  privateEvaluationInspectionReceiptSchema,
  type GovernedPrivateTradeEvaluationWorkspace,
  type PrivateEvaluationExecutionStore,
  type PrivateEvaluationInspectionStore,
} from './governedPrivateTradeEvaluationContracts';

export function createGovernedPrivateTradeEvaluationWorkspace(dependencies: {
  readonly inspectionStore: PrivateEvaluationInspectionStore;
  readonly executionStore: PrivateEvaluationExecutionStore;
}): GovernedPrivateTradeEvaluationWorkspace {
  return {
    async inspect(unparsedSelector) {
      const selector = governedPrivateEvaluationSelectorSchema.parse(unparsedSelector);
      const inspectionReceiptId = await dependencies.inspectionStore.capture(selector);
      const retainedInspection = await dependencies.inspectionStore.load(inspectionReceiptId);
      if (retainedInspection === null) {
        throw new TypeError('Private evaluation inspection was not exactly retained.');
      }
      const inspectionReceipt = privateEvaluationInspectionReceiptSchema.parse(retainedInspection);
      if (inspectionReceipt.receiptId !== inspectionReceiptId) {
        throw new TypeError('Private evaluation inspection was not exactly retained.');
      }
      if (
        canonicalizeAflTradeJson(inspectionReceipt.content.selector) !==
        canonicalizeAflTradeJson(selector)
      ) {
        throw new RangeError('The retained private evaluation inspection escaped its selector.');
      }
      if (inspectionReceipt.content.state === 'unavailable') {
        return {
          state: 'unavailable',
          selector,
          blockers: inspectionReceipt.content.blockers,
          inspectionReceipt,
        };
      }
      const { authoritySnapshotId, validThrough } = inspectionReceipt.content;
      if (authoritySnapshotId === null || validThrough === null) {
        throw new TypeError('A ready private evaluation inspection has no review guard authority.');
      }
      const retainedAuthoritySnapshot = await dependencies.inspectionStore.loadAuthoritySnapshot(
        authoritySnapshotId
      );
      if (retainedAuthoritySnapshot === null) {
        throw new TypeError('Private evaluation authority snapshot was not exactly retained.');
      }
      const authoritySnapshot = privateEvaluationAuthoritySnapshotSchema.parse(
        retainedAuthoritySnapshot
      );
      if (
        authoritySnapshot.snapshotId !== authoritySnapshotId ||
        canonicalizeAflTradeJson(authoritySnapshot.content.selector) !==
          canonicalizeAflTradeJson(selector) ||
        authoritySnapshot.content.capturedAt !== inspectionReceipt.content.inspectedAt ||
        authoritySnapshot.content.validThrough !== validThrough ||
        authoritySnapshot.content.promotedWorkbookSha256 !==
          inspectionReceipt.content.promotedWorkbookSha256 ||
        canonicalizeAflTradeJson(authoritySnapshot.content.dependencies) !==
          canonicalizeAflTradeJson(inspectionReceipt.content.observedDependencies) ||
        canonicalizeAflTradeJson(authoritySnapshot.content.expectedHead) !==
          canonicalizeAflTradeJson(inspectionReceipt.content.expectedHead)
      ) {
        throw new TypeError('Private evaluation authority snapshot was not exactly retained.');
      }
      return {
        state: 'ready',
        selector,
        reviewGuard: {
          authoritySnapshotId,
          inspectionReceiptId: inspectionReceipt.receiptId,
          expectedHead: inspectionReceipt.content.expectedHead,
          validThrough,
        },
        blockers: [],
        inspectionReceipt,
      };
    },
    async execute(unparsedCommand) {
      const command = privateEvaluationExecutionCommandSchema.parse(unparsedCommand);
      const unparsedResult = await dependencies.executionStore.execute(command);
      const result = privateEvaluationExecutionResultSchema.parse(unparsedResult);
      if (
        canonicalizeAflTradeJson(result.selector) !==
        canonicalizeAflTradeJson(command.selector)
      ) {
        throw new RangeError('The private evaluation execution escaped its selector.');
      }
      return result;
    },
  };
}
