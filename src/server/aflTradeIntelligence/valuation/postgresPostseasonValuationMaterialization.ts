import { findAflTradeAssetCustodian } from '../domain/lineageAttribution';
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
import { createAflTradePostseasonValuationCase } from './postseasonValuationCase';
import { createAflTradeLineageGraphId } from './valuationCaseContracts';
import {
  buildParties,
  requireCompleteAssetBinding,
  selectedTransaction,
  transfersFor,
} from './valuationCaseMaterialization';

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
  const {
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    lineageGraph: graph,
  } = valuationParents;
  const archive = await loadAflTradePromotionBackedArchiveFromRelease(
    transaction,
    selection.release.releaseId,
    selection.release.content.createdAt
  );
  const trade = selectedTransaction(archive, review.tradeId);
  if (
    trade.eventVersionId !== review.eventVersionId ||
    trade.seasonYear !== review.tradeYear ||
    trade.occurredOn !== review.tradeDate
  )
    throw new Error('Valuation trade differs from the current reviewed context.');
  const transfers = transfersFor(archive, trade);
  requireCompleteAssetBinding(transfers, componentDrawSet);
  const partyIds = new Set(trade.parties.map(({ club }) => club.clubId));
  const roots = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  if (
    componentDrawSet.content.assets.some(
      (asset) => asset.status === 'supported' && asset.assetKind === 'future_pick_entitlement'
    )
  )
    throw new Error('Future picks require a calendar-aware component adapter.');
  const transferByRoot = new Map(transfers.map((transfer) => [transfer.assetVersionId, transfer]));
  const expectedTypes = {
    player: 'player',
    current_pick: 'current_pick_entitlement',
    future_pick: 'future_pick_entitlement',
    cash: 'unsupported_consideration',
    list_right: 'unsupported_consideration',
    other: 'unsupported_consideration',
  };
  if (
    transfers.some(
      (transfer) =>
        !partyIds.has(transfer.fromClub.clubId) ||
        !partyIds.has(transfer.toClub.clubId) ||
        roots.get(transfer.assetVersionId)?.assetType !== expectedTypes[transfer.assetKind]
    )
  )
    throw new Error('Valuation roots or transfer endpoints differ.');
  // A year-only trade has no invented day: authenticate custody at the original outcome-window boundary.
  const custodyAt = review.tradeDate
    ? `${review.tradeDate}T00:00:00.000Z`
    : `${review.tradeYear + 1}-01-01T00:00:00.000Z`;
  if (
    transfers.some(
      (transfer) =>
        findAflTradeAssetCustodian(graph.custodySpells, transfer.assetVersionId, {
          effectiveAsOf: custodyAt,
          knowledgeCutoffAt: selection.context.content.knowledgeCutoffAt,
        }) !== transfer.toClub.clubId
    )
  )
    throw new Error(
      'Valuation lineage custody differs from the canonical recipient at the trade boundary.'
    );
  if (
    realizedContributionLedger.content.records.some(
      (record) => transferByRoot.get(record.rootAssetId)?.toClub.clubId !== record.aflClubId
    )
  )
    throw new Error('Valuation contribution is not bound to its receiving party.');
  const current = await transaction.query<{ asset_version_id: string }>(
    `SELECT asset_version_id FROM outcome_event_asset WHERE event_version_id=$1 AND status='approved' FOR SHARE`,
    [review.eventVersionId]
  );
  if (
    canonicalizeAflTradeJson(current.rows.map((row) => row.asset_version_id).sort()) !==
    canonicalizeAflTradeJson(transfers.map((transfer) => transfer.assetVersionId).sort())
  )
    throw new Error('Valuation transfer authority is incomplete.');
  const start = `${review.tradeYear + 1}-01-01T00:00:00.000Z`;
  const end = `${review.tradeYear + 4}-01-01T00:00:00.000Z`;
  if (
    componentDrawSet.content.draws.some((draw) =>
      draw.assetOutcomes.some((outcome) =>
        outcome.forecasts.some((forecast) =>
          forecast.seasons.some((season) => season.seasonOffset > 2)
        )
      )
    ) ||
    realizedContributionLedger.content.records.some(
      (record) =>
        Date.parse(record.periodStartAt) < Date.parse(start) ||
        Date.parse(record.periodEndAt) > Date.parse(end) ||
        Date.parse(record.periodEndAt) > Date.parse(parents.laterEffectiveAt) ||
        Date.parse(record.knownFrom) > Date.parse(selection.context.content.knowledgeCutoffAt)
    )
  )
    throw new Error('Valuation parents extend beyond the original horizon or assessment.');
  const valuationCase = createAflTradePostseasonValuationCase({
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: review.tradeId,
    context: selection.context,
    valuationBundleId: componentDrawSet.content.valuationBundleId,
    ...(componentDrawSet.content.valuationInputBundleId
      ? { valuationInputBundleId: componentDrawSet.content.valuationInputBundleId }
      : {}),
    lineageGraphId: createAflTradeLineageGraphId(graph),
    componentDrawSetId: componentDrawSet.componentDrawSetId,
    realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
    valueUnitId: componentDrawSet.content.valueUnitId,
    parties: buildParties(trade, transfers),
    laterAssessment: {
      effectiveAt: parents.laterEffectiveAt,
      knowledgeCutoffAt: selection.context.content.knowledgeCutoffAt,
      valuationAsOf: selection.context.content.knowledgeCutoffAt,
    },
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
  });
  return { ...materialized, valuationCase, valuationParents };
}
