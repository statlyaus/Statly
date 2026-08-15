import {
  aflTradePromotionBackedPublicArchiveSchema,
  type AflTradePromotionBackedPublicArchive,
} from '../outcomes/promotionBackedPublicArchiveContracts';
import {
  assessAuthenticatedCompleteAflTrade,
  type AflTradeCompleteAssessmentV2VerificationInput,
} from '../valuation/completeTradeAssessment';
import {
  createLocalArchiveValuationPublicationFixtureArtifacts,
  LOCAL_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION,
  type LocalSyntheticTradeDefinition,
  type LocalSyntheticValuationScenario,
} from './localSyntheticValuationScenario';

export const LOCAL_AFL_TRADE_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION =
  LOCAL_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION;

export type LocalAflTradeSyntheticValuationScenario = LocalSyntheticValuationScenario;

export interface LocalAflTradeSyntheticValuationFixtureInput {
  environment: 'test_fixture';
  archive: AflTradePromotionBackedPublicArchive;
  tradeId: string;
  valuationBundleId: string;
  scenario: LocalAflTradeSyntheticValuationScenario;
  assessedAt: string;
}

type ArchiveRecord = AflTradePromotionBackedPublicArchive['content']['records'][number]['record'];
type TransactionRecord = Extract<ArchiveRecord, { recordKind: 'transaction' }>;
type TransferRecord = Extract<ArchiveRecord, { recordKind: 'transfer' }>;

function exactTransaction(
  archive: AflTradePromotionBackedPublicArchive,
  tradeId: string
): { transaction: TransactionRecord; transfers: TransferRecord[] } {
  const records = archive.content.records.map(({ record }) => record);
  const transactions = records.filter(
    (record): record is TransactionRecord =>
      record.recordKind === 'transaction' && record.eventId === tradeId
  );
  if (transactions.length !== 1) {
    throw new RangeError('Synthetic valuation requires one exact factual transaction.');
  }
  const transaction = transactions[0]!;
  const transfers = records
    .filter(
      (record): record is TransferRecord =>
        record.recordKind === 'transfer' && record.eventVersionId === transaction.eventVersionId
    )
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  if (transfers.length === 0) {
    throw new RangeError('Synthetic valuation requires the complete factual transfer set.');
  }
  return { transaction, transfers };
}

function archiveScenarioDefinition(input: {
  archive: AflTradePromotionBackedPublicArchive;
  transaction: TransactionRecord;
  transfers: readonly TransferRecord[];
}): LocalSyntheticTradeDefinition {
  return {
    schemaVersion: 'local-synthetic-trade-definition/v1',
    basis: { kind: 'test_fixture_archive', basisId: input.archive.archiveId },
    tradeId: input.transaction.eventId,
    effectiveAt: `${input.transaction.occurredOn}T00:00:00.000Z`,
    effectiveThrough: input.archive.content.effectiveThrough,
    parties: input.transaction.parties.map(({ club }) => ({
      aflClubId: club.clubId,
      clubName: club.name,
    })),
    transfers: input.transfers.map((transfer) => {
      if (
        transfer.assetKind !== 'player' &&
        transfer.assetKind !== 'current_pick' &&
        transfer.assetKind !== 'future_pick'
      ) {
        throw new RangeError('Synthetic valuation cannot value unsupported consideration.');
      }
      return {
        transferId: transfer.recordId,
        fromClubId: transfer.fromClub.clubId,
        toClubId: transfer.toClub.clubId,
        assetId: transfer.assetVersionId,
        assetKind: transfer.assetKind,
        displayLabel: transfer.rawDescription,
        directionBasis: 'archive_recorded_transfer',
      };
    }),
  };
}

export function createLocalAflTradeSyntheticValuationFixture(
  input: LocalAflTradeSyntheticValuationFixtureInput
) {
  if (
    input.environment !== 'test_fixture' ||
    input.archive.content.environment !== 'test_fixture'
  ) {
    throw new TypeError('Synthetic valuation evidence is restricted to test_fixture archives.');
  }
  const archive = aflTradePromotionBackedPublicArchiveSchema.parse(input.archive);
  const { transaction, transfers } = exactTransaction(archive, input.tradeId);
  const synthetic = createLocalArchiveValuationPublicationFixtureArtifacts({
    environment: input.environment,
    definition: archiveScenarioDefinition({ archive, transaction, transfers }),
    valuationBundleId: input.valuationBundleId,
    scenario: input.scenario,
    assessedAt: input.assessedAt,
  });
  const assessmentInput = {
    archive,
    valuationCase: synthetic.valuationCase,
    lineageGraph: synthetic.lineageGraph,
    componentDrawSet: synthetic.componentDrawSet,
    realizedContributionLedger: synthetic.realizedContributionLedger,
    packagePolicy: synthetic.packagePolicy,
    valuationCalculation: synthetic.calculation,
    selectedLayer: 'scarcityAdjusted' as const,
    valueUnit: {
      valueUnitId: synthetic.valuationCase.content.valueUnitId,
      shortLabel: 'Synthetic PAV',
      explanation: 'Fabricated local rehearsal values; not real AFL valuation evidence.',
    },
    assessedAt: input.assessedAt,
  };
  const assessmentVerification: AflTradeCompleteAssessmentV2VerificationInput = {
    assessmentInput,
    output: assessAuthenticatedCompleteAflTrade(assessmentInput),
  };
  return {
    environment: input.environment,
    evidenceClassification: synthetic.evidenceClassification,
    productionEligible: false as const,
    liveSourceAccessed: false as const,
    providerRightsExpanded: false as const,
    scenario: input.scenario,
    scenarioId: synthetic.scenarioId,
    assumptionSet: synthetic.assumptionSet,
    fixtureAuthority: synthetic.fixtureAuthority,
    factualParent: {
      archiveId: archive.archiveId,
      releaseId: archive.content.releaseId,
      factualCandidateId: archive.content.factualCandidateId,
      tradeId: input.tradeId,
    },
    lineageGraph: synthetic.lineageGraph,
    componentDrawSet: synthetic.componentDrawSet,
    realizedContributionLedger: synthetic.realizedContributionLedger,
    packagePolicy: synthetic.packagePolicy,
    valuationCase: synthetic.valuationCase,
    calculation: synthetic.calculation,
    snapshotSet: synthetic.snapshotSet,
    explanation: synthetic.explanation,
    validation: synthetic.validation,
    assessmentVerification,
  };
}
