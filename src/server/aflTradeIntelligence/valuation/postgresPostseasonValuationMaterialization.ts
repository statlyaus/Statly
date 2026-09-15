import { z } from 'zod';
import {
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  AFL_TRADE_ASSET_TYPES,
  AFL_TRADE_LINEAGE_EDGE_KINDS,
  AFL_TRADE_ASSET_DISPOSITION_KINDS,
  AFL_TRADE_CORRECTION_RELATION_KINDS,
} from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';
import type { AflTradeHpnPavMethodAuthority } from '../modeling/hpnPavCalculationService';
import { materializeAflTradePostseasonObservation } from '../modeling/postgresPostseasonObservationMaterialization';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { loadAflTradePromotionBackedArchiveFromRelease } from '../outcomes/postgresPromotionBackedPublicArchiveRepository';
import { aflTradeComponentDrawSetSchema } from './componentDrawSet';
import { aflTradePackagePolicySchema } from './packagePolicy';
import { createAflTradePostseasonValuationCase } from './postseasonValuationCase';
import { aflTradeRealizedContributionLedgerSchema } from './realizedContributionLedger';
import { createAflTradeLineageGraphId } from './valuationCaseContracts';
import {
  buildParties,
  requireCommonModelBinding,
  requireCompleteAssetBinding,
  selectedTransaction,
  transfersFor,
} from './valuationCaseMaterialization';

const instant = z.iso.datetime({ offset: true });
const identifier = z.string().trim().min(1).max(1000);
const known = { knownFrom: instant, knownTo: instant.nullable(), evidenceId: identifier };
const graphSchema = z
  .object({
    assets: z
      .array(
        z
          .object({
            ...known,
            assetId: identifier,
            assetType: z.enum(AFL_TRADE_ASSET_TYPES),
            effectiveFrom: instant,
          })
          .strict()
      )
      .max(100000),
    custodySpells: z
      .array(
        z
          .object({
            ...known,
            custodySpellId: identifier,
            assetId: identifier,
            aflClubId: identifier,
            effectiveFrom: instant,
            effectiveTo: instant.nullable(),
          })
          .strict()
      )
      .max(100000),
    edges: z
      .array(
        z
          .object({
            ...known,
            edgeId: identifier,
            kind: z.enum(AFL_TRADE_LINEAGE_EDGE_KINDS),
            sourceAssetId: identifier,
            targetAssetId: identifier,
            effectiveAt: instant,
            ruleVersion: identifier,
          })
          .strict()
      )
      .max(100000),
    dispositions: z
      .array(
        z
          .object({
            ...known,
            dispositionId: identifier,
            kind: z.enum(AFL_TRADE_ASSET_DISPOSITION_KINDS),
            assetId: identifier,
            effectiveAt: instant,
            reasonCode: identifier,
          })
          .strict()
      )
      .max(100000),
    corrections: z
      .array(
        z
          .object({
            correctionId: identifier,
            kind: z.enum(AFL_TRADE_CORRECTION_RELATION_KINDS),
            supersededRecordId: identifier,
            replacementRecordId: identifier,
            knownAt: instant,
            evidenceId: identifier,
          })
          .strict()
      )
      .max(100000),
  })
  .strict();

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
  const componentDrawSet = aflTradeComponentDrawSetSchema.parse(
    await readJson(parents.componentDrawSetArtifact)
  );
  const realizedContributionLedger = aflTradeRealizedContributionLedgerSchema.parse(
    await readJson(parents.realizedContributionLedgerArtifact)
  );
  const packagePolicy = aflTradePackagePolicySchema.parse(
    await readJson(parents.packagePolicyArtifact)
  );
  // The existing graph validator validates all temporal, identity, edge and custody invariants.
  const graph = graphSchema.parse(await readJson(parents.lineageGraphArtifact));
  if (!validateAflTradeLineageGraph(graph).valid) throw new Error('Valuation lineage is invalid.');
  requireCommonModelBinding({
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    lineageGraph: graph,
  });
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
  return { ...materialized, valuationCase };
}
