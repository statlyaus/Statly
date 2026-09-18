import { findAflTradeAssetCustodian } from '../domain/lineageAttribution';
import {
  aflTradePostseasonSeasonWindow,
  aflTradePostseasonYearContextSchema,
} from '../domain/postseasonYearContext';
import { aflTradePromotionBackedPublicArchiveSchema } from '../outcomes/promotionBackedPublicArchiveContracts';
import { postseasonValuationParentsSchema } from './postseasonValuationParents';
import {
  aflTradePostseasonValuationCaseContentSchema,
  createAflTradePostseasonValuationCase,
} from './postseasonValuationCase';
import {
  buildParties,
  requireCompleteAssetBinding,
  selectedTransaction,
  transfersFor,
} from './valuationCaseMaterialization';

type MaterializationInput = {
  archive: unknown;
  context: unknown;
  laterAssessment: unknown;
  valuationParents: unknown;
};

/** Deterministically replays a reviewed postseason case without resolving mutable SQL authority. */
export function materializeAflTradePostseasonValuationCase(input: MaterializationInput) {
  const archive = aflTradePromotionBackedPublicArchiveSchema.parse(input.archive);
  const context = aflTradePostseasonYearContextSchema.parse(input.context);
  const laterAssessment = aflTradePostseasonValuationCaseContentSchema.shape.laterAssessment.parse(
    input.laterAssessment
  );
  const parents = postseasonValuationParentsSchema.parse(input.valuationParents);
  const { componentDrawSet, realizedContributionLedger, packagePolicy, lineageGraph } = parents;
  const trade = selectedTransaction(archive, context.content.tradeId);
  if (
    trade.eventVersionId !== context.content.eventVersionId ||
    trade.seasonYear !== context.content.tradeYear ||
    trade.occurredOn !== context.content.tradeDate
  ) {
    throw new Error('Valuation trade differs from the reviewed postseason context.');
  }

  const transfers = transfersFor(archive, trade);
  requireCompleteAssetBinding(transfers, componentDrawSet);
  const partyIds = new Set(trade.parties.map(({ club }) => club.clubId));
  const roots = new Map(lineageGraph.assets.map((asset) => [asset.assetId, asset]));
  const expectedTypes = {
    player: 'player',
    current_pick: 'current_pick_entitlement',
    future_pick: 'future_pick_entitlement',
    cash: 'unsupported_consideration',
    list_right: 'unsupported_consideration',
    other: 'unsupported_consideration',
  } as const;
  if (
    transfers.some(
      (transfer) =>
        !partyIds.has(transfer.fromClub.clubId) ||
        !partyIds.has(transfer.toClub.clubId) ||
        roots.get(transfer.assetVersionId)?.assetType !== expectedTypes[transfer.assetKind]
    )
  ) {
    throw new Error('Valuation roots or transfer endpoints differ.');
  }

  const outcomeSeasons = aflTradePostseasonSeasonWindow(context, 1).outcomeSeasons;
  const supportedById = new Map(
    componentDrawSet.content.assets
      .filter((asset) => asset.status === 'supported')
      .map((asset) => [asset.assetId, asset])
  );
  for (const transfer of transfers) {
    const supported = supportedById.get(transfer.assetVersionId);
    if (supported?.assetKind !== 'future_pick_entitlement') continue;
    if (
      transfer.assetKind !== 'future_pick' ||
      transfer.pick === null ||
      !outcomeSeasons.includes(transfer.pick.draftSeasonYear)
    ) {
      throw new Error('Supported future picks require a draft year inside the original horizon.');
    }
  }

  // A year-only trade retains null date precision; this boundary is used only for custody lookup.
  const custodyAt = context.content.tradeDate
    ? `${context.content.tradeDate}T00:00:00.000Z`
    : `${context.content.tradeYear + 1}-01-01T00:00:00.000Z`;
  if (
    transfers.some(
      (transfer) =>
        findAflTradeAssetCustodian(lineageGraph.custodySpells, transfer.assetVersionId, {
          effectiveAsOf: custodyAt,
          knowledgeCutoffAt: context.content.knowledgeCutoffAt,
        }) !== transfer.toClub.clubId
    )
  ) {
    throw new Error(
      'Valuation lineage custody differs from the canonical recipient at the trade boundary.'
    );
  }

  const transferByRoot = new Map(transfers.map((transfer) => [transfer.assetVersionId, transfer]));
  if (
    realizedContributionLedger.content.records.some(
      (record) => transferByRoot.get(record.rootAssetId)?.toClub.clubId !== record.aflClubId
    )
  ) {
    throw new Error('Valuation contribution is not bound to its receiving party.');
  }
  const start = `${context.content.tradeYear + 1}-01-01T00:00:00.000Z`;
  const end = `${context.content.tradeYear + 4}-01-01T00:00:00.000Z`;
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
        Date.parse(record.periodEndAt) > Date.parse(laterAssessment.effectiveAt) ||
        Date.parse(record.knownFrom) > Date.parse(context.content.knowledgeCutoffAt)
    )
  ) {
    throw new Error('Valuation parents extend beyond the original horizon or assessment.');
  }

  return createAflTradePostseasonValuationCase({
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: context.content.tradeId,
    context,
    valuationBundleId: componentDrawSet.content.valuationBundleId,
    ...(componentDrawSet.content.valuationInputBundleId
      ? { valuationInputBundleId: componentDrawSet.content.valuationInputBundleId }
      : {}),
    lineageGraphId: realizedContributionLedger.content.lineageGraphId,
    componentDrawSetId: componentDrawSet.componentDrawSetId,
    realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
    valueUnitId: componentDrawSet.content.valueUnitId,
    parties: buildParties(trade, transfers),
    laterAssessment,
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
  });
}
