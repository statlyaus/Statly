import type { DraftTradeDetail } from '@/lib/draftTrades/read';

import type { AflTradePrivateConfirmedValuationLifecycleV2 } from './privateConfirmedTradeValuationConstruction';
import {
  prepareLocalPrivateTradeEvaluationFromConfirmedResult,
  type LocalPrivatePickEvaluationEvidence,
} from './localPrivateTradeEvaluationPreparation';

export interface LocalPrivateTradeEvaluationPickEvidenceLoader {
  load(input: {
    valuationScopeKey: string;
    tradeId: string;
    workbookSha256: string;
    detail: DraftTradeDetail;
  }): Promise<ReadonlyMap<string, LocalPrivatePickEvaluationEvidence>>;
}

export function createLocalPrivateTradeEvaluationPreparationLoader(dependencies: {
  valuationScopeKey: string;
  workbookSha256: string;
  loadDetail(tradeId: string): Promise<DraftTradeDetail | null>;
  confirmedLifecycle: AflTradePrivateConfirmedValuationLifecycleV2;
  pickEvidence?: LocalPrivateTradeEvaluationPickEvidenceLoader;
}) {
  if (!/^[a-f0-9]{64}$/u.test(dependencies.workbookSha256)) {
    throw new TypeError('Private evaluation preparation requires the pinned workbook digest.');
  }
  return async (tradeId: string) => {
    const detail = await dependencies.loadDetail(tradeId);
    if (
      detail === null ||
      detail.trade.tradeId !== tradeId ||
      dependencies.valuationScopeKey !== `afl-men:${detail.trade.year}-trades`
    ) {
      return {
        state: 'blocked' as const,
        reasons: ['transaction_not_confirmed'],
        evidenceRefs: [],
      };
    }
    const retained = await dependencies.confirmedLifecycle.loadLatestResultForTrade({
      valuationScopeKey: dependencies.valuationScopeKey,
      tradeId,
      workbookSha256: dependencies.workbookSha256,
    });
    if (retained === null) {
      return {
        state: 'blocked' as const,
        reasons: ['transaction_not_confirmed'],
        evidenceRefs: [],
      };
    }
    const pickEvidenceByAssetId = await dependencies.pickEvidence?.load({
      valuationScopeKey: dependencies.valuationScopeKey,
      tradeId,
      workbookSha256: dependencies.workbookSha256,
      detail,
    });
    return {
      state: 'ready' as const,
      preparation: prepareLocalPrivateTradeEvaluationFromConfirmedResult({
        result: retained.result,
        resultArtifact: retained.artifact,
        workbookSha256: retained.workbookSha256,
        labelsByAssetId: new Map(
          detail.assets.map((asset) => [asset.id, asset.assetText] as const)
        ),
        pickEvidenceByAssetId,
      }),
    };
  };
}
