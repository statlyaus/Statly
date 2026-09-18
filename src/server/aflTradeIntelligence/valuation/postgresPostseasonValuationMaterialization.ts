import {
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeHpnPavMethodAuthority } from '../modeling/hpnPavCalculationService';
import { materializeAflTradePostseasonObservation } from '../modeling/postgresPostseasonObservationMaterialization';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { loadAflTradePromotionBackedArchiveFromRelease } from '../outcomes/postgresPromotionBackedPublicArchiveRepository';
import { postseasonValuationParentsSchema } from './postseasonValuationParents';
import { materializeAflTradePostseasonValuationCase } from './postseasonValuationCaseMaterialization';

/** Connects both builders to the same reviewed owners. No model execution or admission occurs. */
export async function materializeAflTradePostseasonValuation(
  transaction: AflOutcomeSqlTransaction,
  input: unknown,
  methodAuthority: AflTradeHpnPavMethodAuthority,
  evidence: AflTradeAcquisitionRegistrationEvidenceReader
) {
  const materialized = await materializeAflTradePostseasonObservation(
    transaction,
    input,
    methodAuthority,
    evidence
  );
  const { selection } = materialized;
  const review = selection.review.content;
  if (review.schemaVersion !== 'afl-trade-postseason-materialization-review/v2')
    throw new Error('Valuation materialization requires reviewed retained parents.');
  const context = selection.context.content;
  if (
    review.tradeId !== context.tradeId ||
    review.promotionId !== context.promotionId ||
    review.eventVersionId !== context.eventVersionId ||
    review.tradeYear !== context.tradeYear ||
    review.tradeDate !== context.tradeDate
  )
    throw new Error('Valuation trade differs from the current reviewed context.');
  const parents = review.valuation;
  const readJson = async (ref: AflTradeArtifactRef): Promise<unknown> => {
    const bytes = await evidence.read(ref);
    if (!doesAflTradeArtifactRefMatchBytes(ref, bytes))
      throw new Error('Valuation parent bytes differ.');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (canonicalizeAflTradeJson(value) !== new TextDecoder().decode(bytes))
      throw new Error('Valuation parent is not canonical JSON.');
    return value;
  };
  const valuationParents = postseasonValuationParentsSchema.parse({
    componentDrawSet: await readJson(parents.componentDrawSetArtifact),
    realizedContributionLedger: await readJson(parents.realizedContributionLedgerArtifact),
    packagePolicy: await readJson(parents.packagePolicyArtifact),
    lineageGraph: await readJson(parents.lineageGraphArtifact),
  });
  const { componentDrawSet } = valuationParents;
  const archive = await loadAflTradePromotionBackedArchiveFromRelease(
    transaction,
    selection.release.releaseId,
    selection.release.content.createdAt
  );
  const current = await transaction.query<{ asset_version_id: string }>(
    `SELECT asset_version_id FROM outcome_event_asset WHERE event_version_id=$1 AND status='approved' FOR SHARE`,
    [review.eventVersionId]
  );
  const approvedAssetIds = current.rows.map((row) => row.asset_version_id).sort();
  const parentAssetIds = componentDrawSet.content.assets.map((asset) => asset.assetId).sort();
  if (canonicalizeAflTradeJson(approvedAssetIds) !== canonicalizeAflTradeJson(parentAssetIds))
    throw new Error('Valuation transfer authority is incomplete.');
  const valuationCase = materializeAflTradePostseasonValuationCase({
    archive,
    context: selection.context,
    laterAssessment: {
      effectiveAt: parents.laterEffectiveAt,
      knowledgeCutoffAt: selection.context.content.knowledgeCutoffAt,
      valuationAsOf: selection.context.content.knowledgeCutoffAt,
    },
    valuationParents,
  });
  return { ...materialized, valuationCase, valuationParents };
}
