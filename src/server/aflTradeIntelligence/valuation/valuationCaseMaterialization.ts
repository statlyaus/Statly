import { findAflTradeAssetCustodian } from '../domain/lineageAttribution';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import {
  aflTradePromotionBackedPublicArchiveSchema,
  type AflTradePromotionBackedPublicArchive,
} from '../outcomes/promotionBackedPublicArchiveContracts';
import { aflTradeComponentDrawSetSchema, type AflTradeComponentDrawSet } from './componentDrawSet';
import { aflTradePackagePolicySchema, type AflTradePackagePolicy } from './packagePolicy';
import {
  aflTradeRealizedContributionLedgerSchema,
  type AflTradeRealizedContributionLedger,
} from './realizedContributionLedger';
import {
  createAflTradeLineageGraphId,
  createAflTradeValuationCase,
  validateAflTradeValuationCaseLineage,
  type AflTradeValuationCase,
} from './valuationCaseContracts';

export const AFL_TRADE_VALUATION_CASE_MATERIALIZATION_ERROR_CODES = [
  'INVALID_INPUT',
  'TRADE_NOT_FOUND',
  'AMBIGUOUS_TRADE',
  'MODEL_BINDING_MISMATCH',
  'INCOMPLETE_EXCHANGE',
  'ASSET_BINDING_MISMATCH',
  'LINEAGE_MISMATCH',
] as const;

export type AflTradeValuationCaseMaterializationErrorCode =
  (typeof AFL_TRADE_VALUATION_CASE_MATERIALIZATION_ERROR_CODES)[number];

export class AflTradeValuationCaseMaterializationError extends Error {
  constructor(
    public readonly code: AflTradeValuationCaseMaterializationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeValuationCaseMaterializationError';
  }
}

export interface AflTradeValuationCaseMaterializationInput {
  archive: AflTradePromotionBackedPublicArchive;
  tradeId: string;
  lineageGraph: AflTradeLineageGraph;
  componentDrawSet: AflTradeComponentDrawSet;
  realizedContributionLedger: AflTradeRealizedContributionLedger;
  packagePolicy: AflTradePackagePolicy;
  viewContexts: AflTradeValuationCase['content']['viewContexts'];
}

type ArchiveRecord = AflTradePromotionBackedPublicArchive['content']['records'][number]['record'];
type TransactionRecord = Extract<ArchiveRecord, { recordKind: 'transaction' }>;
type TransferRecord = Extract<ArchiveRecord, { recordKind: 'transfer' }>;
type ComponentAsset = AflTradeComponentDrawSet['content']['assets'][number];

function fail(
  code: AflTradeValuationCaseMaterializationErrorCode,
  message: string,
  cause?: unknown
): never {
  throw new AflTradeValuationCaseMaterializationError(code, message, { cause });
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  const canonicalLeft = [...left].sort();
  const canonicalRight = [...right].sort();
  return (
    canonicalLeft.length === canonicalRight.length &&
    canonicalLeft.every((value, index) => value === canonicalRight[index])
  );
}

function expectedTransferKind(asset: ComponentAsset): TransferRecord['assetKind'] | null {
  if (asset.assetKind === 'player') return 'player';
  if (asset.assetKind === 'current_pick_entitlement') return 'current_pick';
  if (asset.assetKind === 'future_pick_entitlement') return 'future_pick';
  if (asset.assetKind === 'unsupported_consideration') return null;
  return null;
}

function transferMatchesComponentAsset(transfer: TransferRecord, asset: ComponentAsset): boolean {
  const expected = expectedTransferKind(asset);
  if (expected !== null) return transfer.assetKind === expected;
  return (
    asset.status === 'excluded' &&
    asset.assetKind === 'unsupported_consideration' &&
    ['cash', 'list_right', 'other'].includes(transfer.assetKind)
  );
}

function requireCommonModelBinding(input: {
  componentDrawSet: AflTradeComponentDrawSet;
  realizedContributionLedger: AflTradeRealizedContributionLedger;
  packagePolicy: AflTradePackagePolicy;
  lineageGraph: AflTradeLineageGraph;
}): void {
  const drawSet = input.componentDrawSet.content;
  const ledger = input.realizedContributionLedger.content;
  const policy = input.packagePolicy.content;
  if (
    ledger.valuationBundleId !== drawSet.valuationBundleId ||
    policy.valuationBundleId !== drawSet.valuationBundleId ||
    ledger.valuationInputBundleId !== drawSet.valuationInputBundleId ||
    policy.valuationInputBundleId !== drawSet.valuationInputBundleId ||
    ledger.valueUnitId !== drawSet.valueUnitId ||
    policy.valueUnitId !== drawSet.valueUnitId
  ) {
    fail(
      'MODEL_BINDING_MISMATCH',
      'Valuation-case materialization requires one exact bundle and value unit across both component outputs and package policy.'
    );
  }
  if (ledger.lineageGraphId !== createAflTradeLineageGraphId(input.lineageGraph)) {
    fail(
      'LINEAGE_MISMATCH',
      'The realized contribution ledger does not bind the supplied lineage graph.'
    );
  }
}

function selectedTransaction(
  archive: AflTradePromotionBackedPublicArchive,
  tradeId: string
): TransactionRecord {
  const matches = archive.content.records
    .map(({ record }) => record)
    .filter(
      (record): record is TransactionRecord =>
        record.recordKind === 'transaction' && record.eventId === tradeId
    );
  if (matches.length === 0) {
    fail('TRADE_NOT_FOUND', 'The selected factual archive does not contain the requested trade.');
  }
  if (matches.length !== 1) {
    fail(
      'AMBIGUOUS_TRADE',
      'The selected factual archive contains more than one current transaction version for the trade.'
    );
  }
  return matches[0]!;
}

function transfersFor(
  archive: AflTradePromotionBackedPublicArchive,
  transaction: TransactionRecord
): TransferRecord[] {
  return archive.content.records
    .map(({ record }) => record)
    .filter(
      (record): record is TransferRecord =>
        record.recordKind === 'transfer' && record.eventVersionId === transaction.eventVersionId
    );
}

function requireCompleteAssetBinding(
  transfers: readonly TransferRecord[],
  componentDrawSet: AflTradeComponentDrawSet
): void {
  const componentAssets = componentDrawSet.content.assets;
  if (
    !exactStrings(
      transfers.map(({ assetVersionId }) => assetVersionId),
      componentAssets.map(({ assetId }) => assetId)
    )
  ) {
    fail(
      'INCOMPLETE_EXCHANGE',
      'The component outputs must account for every factual transfer in the selected transaction exactly once.'
    );
  }
  const componentByAssetId = new Map(componentAssets.map((asset) => [asset.assetId, asset]));
  for (const transfer of transfers) {
    const asset = componentByAssetId.get(transfer.assetVersionId);
    if (!asset || !transferMatchesComponentAsset(transfer, asset)) {
      fail(
        'ASSET_BINDING_MISMATCH',
        'A factual transfer kind does not match its player or pick component output.'
      );
    }
  }
}

function requireDirectedLineage(
  transfers: readonly TransferRecord[],
  transaction: TransactionRecord,
  lineageGraph: AflTradeLineageGraph,
  atTradeContext: AflTradeValuationCase['content']['viewContexts'][number] | undefined
): void {
  if (!atTradeContext || atTradeContext.view !== 'at_trade') {
    fail('INVALID_INPUT', 'Valuation-case materialization requires the at-trade view first.');
  }
  const partyIds = transaction.parties.map(({ club }) => club.clubId);
  const partySet = new Set(partyIds);
  if (
    new Set(partyIds).size !== partyIds.length ||
    transfers.some(
      ({ fromClub, toClub }) => !partySet.has(fromClub.clubId) || !partySet.has(toClub.clubId)
    )
  ) {
    fail(
      'INCOMPLETE_EXCHANGE',
      'Every directed transfer endpoint must be one of the transaction parties.'
    );
  }
  for (const transfer of transfers) {
    const custodian = findAflTradeAssetCustodian(
      lineageGraph.custodySpells,
      transfer.assetVersionId,
      {
        effectiveAsOf: atTradeContext.effectiveAt,
        knowledgeCutoffAt: atTradeContext.knowledgeCutoffAt,
      }
    );
    if (custodian !== transfer.toClub.clubId) {
      fail(
        'LINEAGE_MISMATCH',
        'A factual transfer recipient does not match the exact at-trade lineage custodian.'
      );
    }
  }
}

function buildParties(
  transaction: TransactionRecord,
  transfers: readonly TransferRecord[]
): AflTradeValuationCase['content']['parties'] {
  return transaction.parties.map(({ club }) => {
    const receivedRootAssetIds = transfers
      .filter(({ toClub }) => toClub.clubId === club.clubId)
      .map(({ assetVersionId }) => assetVersionId);
    if (receivedRootAssetIds.length === 0) {
      fail(
        'INCOMPLETE_EXCHANGE',
        'Every factual transaction party must receive at least one accounted asset.'
      );
    }
    return {
      aflClubId: club.clubId,
      clubName: club.name,
      receivedRootAssetIds,
    };
  });
}

export function materializeAflTradeValuationCase(
  unparsedInput: AflTradeValuationCaseMaterializationInput
): AflTradeValuationCase {
  try {
    const archive = aflTradePromotionBackedPublicArchiveSchema.parse(unparsedInput.archive);
    const componentDrawSet = aflTradeComponentDrawSetSchema.parse(unparsedInput.componentDrawSet);
    const realizedContributionLedger = aflTradeRealizedContributionLedgerSchema.parse(
      unparsedInput.realizedContributionLedger
    );
    const packagePolicy = aflTradePackagePolicySchema.parse(unparsedInput.packagePolicy);
    requireCommonModelBinding({
      componentDrawSet,
      realizedContributionLedger,
      packagePolicy,
      lineageGraph: unparsedInput.lineageGraph,
    });
    const transaction = selectedTransaction(archive, unparsedInput.tradeId);
    const transfers = transfersFor(archive, transaction);
    requireCompleteAssetBinding(transfers, componentDrawSet);
    requireDirectedLineage(
      transfers,
      transaction,
      unparsedInput.lineageGraph,
      unparsedInput.viewContexts[0]
    );
    const valuationCase = createAflTradeValuationCase({
      schemaVersion: 'afl-trade-valuation-case/v1',
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
      calculationUnit: 'complete_multi_party_trade',
      tradeId: transaction.eventId,
      tradeEffectiveAt: `${transaction.occurredOn}T00:00:00.000Z`,
      valuationBundleId: componentDrawSet.content.valuationBundleId,
      ...(componentDrawSet.content.valuationInputBundleId
        ? { valuationInputBundleId: componentDrawSet.content.valuationInputBundleId }
        : {}),
      lineageGraphId: createAflTradeLineageGraphId(unparsedInput.lineageGraph),
      componentDrawSetId: componentDrawSet.componentDrawSetId,
      realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
      packagePolicyId: packagePolicy.packagePolicyId,
      valueUnitId: componentDrawSet.content.valueUnitId,
      parties: buildParties(transaction, transfers),
      viewContexts: [...unparsedInput.viewContexts],
      legacySourceMetricsTreatment:
        'excluded_from_calculation_retained_only_by_separate_legacy_projection',
    });
    const lineageValidation = validateAflTradeValuationCaseLineage(
      valuationCase,
      unparsedInput.lineageGraph
    );
    if (!lineageValidation.valid) {
      fail(
        'LINEAGE_MISMATCH',
        `The factual exchange does not match the supplied lineage graph: ${lineageValidation.issues
          .map(({ code }) => code)
          .join(', ')}.`
      );
    }
    return valuationCase;
  } catch (error) {
    if (error instanceof AflTradeValuationCaseMaterializationError) throw error;
    fail('INVALID_INPUT', 'Valuation-case materialization rejected invalid evidence.', error);
  }
}
