import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeCustodiedProjectionManifestMaterialization } from '../publication/projectionManifestMaterialization';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '../publication/publicationReadContracts';
import type { AflTradeValuationPublicationCommandService } from '../publication/valuationPublicationCommandService';
import { createPostgresAflTradeValuationOutputCustodyOperationAuthority } from '../valuation/postgresValuationOutputCustodyOperationAuthority';
import { persistAflTradeValuationOutputInventory } from '../valuation/valuationOutputCustody';
import { createAflTradeValuationOutputCustodyIndex } from '../valuation/valuationOutputCustodyIndex';
import { createLocalAflTradeSyntheticValuationFixture } from './localAflTradeSyntheticValuationFixture';
import type { seedLocalAflTradeOutcomeArchive } from './postgresLocalOutcomeArchiveSeed';

import {
  createAflTradeCustodiedProjectionManifestFixtureFromValuation,
  createAflTradeProjectionManifestMaterializationInput,
  createAflTradeValuationBundleManifestFixture,
  createAflTradeValuationProjectionPipelineFixture,
  type AflTradeProjectionPipelineOverride,
} from './localAflTradeProjectionFixture';

type LocalFactualSeed = Awaited<ReturnType<typeof seedLocalAflTradeOutcomeArchive>>;

export function assertLocalAflTradeValuationPublicationFixtureAuthority(
  candidate: unknown
): asserts candidate is {
  fixtureAuthority: {
    kind: 'disposable_fixture_publication_rehearsal';
    environment: 'test_fixture';
    productionEligible: false;
  };
} {
  const fixtureAuthority =
    typeof candidate === 'object' && candidate !== null && 'fixtureAuthority' in candidate
      ? candidate.fixtureAuthority
      : null;
  if (
    typeof fixtureAuthority !== 'object' ||
    fixtureAuthority === null ||
    !('kind' in fixtureAuthority) ||
    fixtureAuthority.kind !== 'disposable_fixture_publication_rehearsal' ||
    !('environment' in fixtureAuthority) ||
    fixtureAuthority.environment !== 'test_fixture' ||
    !('productionEligible' in fixtureAuthority) ||
    fixtureAuthority.productionEligible !== false
  ) {
    throw new TypeError('Valuation publication rehearsal requires disposable fixture authority.');
  }
}

export async function prepareLocalAflTradeValuationCandidate(input: {
  client: AflOutcomeSqlClient;
  factual: LocalFactualSeed;
  scenario: 'baseline' | 'replacement';
  derivedRepository: AflTradeImmutableArtifactRepository;
  publicationCommand: AflTradeValuationPublicationCommandService;
}) {
  const inventoryMaterializedAt =
    input.scenario === 'baseline' ? '2026-08-12T10:00:10.000Z' : '2026-08-12T10:01:10.000Z';
  const assessedAt = new Date(Date.parse(inventoryMaterializedAt) - 10_000).toISOString();
  const bundleCreatedAt = new Date(Date.parse(inventoryMaterializedAt) - 1_000).toISOString();
  const provisional = createLocalAflTradeSyntheticValuationFixture({
    environment: 'test_fixture',
    archive: input.factual.publicArchive,
    tradeId: input.factual.tradeId,
    valuationBundleId: `valuation-bundle:${'a'.repeat(64)}`,
    scenario: input.scenario,
    assessedAt,
  });
  assertLocalAflTradeValuationPublicationFixtureAuthority(provisional);
  const bundle = createAflTradeValuationBundleManifestFixture({
    valuationCase: provisional.valuationCase,
    calculation: provisional.calculation,
    environment: 'test_fixture',
    scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
    components: provisional.componentDrawSet.content.components,
    createdAt: bundleCreatedAt,
  });
  const synthetic = createLocalAflTradeSyntheticValuationFixture({
    environment: 'test_fixture',
    archive: input.factual.publicArchive,
    tradeId: input.factual.tradeId,
    valuationBundleId: bundle.valuationBundleId,
    scenario: input.scenario,
    assessedAt,
  });
  assertLocalAflTradeValuationPublicationFixtureAuthority(synthetic);
  const finalBundle = createAflTradeValuationBundleManifestFixture({
    valuationCase: synthetic.valuationCase,
    calculation: synthetic.calculation,
    environment: 'test_fixture',
    scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
    components: synthetic.componentDrawSet.content.components,
    createdAt: bundleCreatedAt,
  });
  if (finalBundle.valuationBundleId !== bundle.valuationBundleId) {
    throw new Error('The synthetic valuation bundle did not converge to one identity.');
  }
  const initialOverride: AflTradeProjectionPipelineOverride = {
    fixture: {
      valuationCase: synthetic.valuationCase,
      calculation: synthetic.calculation,
      bundle: finalBundle,
    },
    assessmentVerification: synthetic.assessmentVerification,
    inventoryMaterializedAt,
    materializedAt: inventoryMaterializedAt,
    freshnessDurationSeconds: {
      current: 15_768_000,
      stale: 15_768_000,
    },
  };
  const initialPipeline = createAflTradeValuationProjectionPipelineFixture(initialOverride);
  const custody = await persistAflTradeValuationOutputInventory(
    {
      verification: initialPipeline.valuationOutputInventoryVerification,
      assessmentVerification: synthetic.assessmentVerification,
    },
    {
      repository: input.derivedRepository,
      operationAuthority: createPostgresAflTradeValuationOutputCustodyOperationAuthority(
        input.client
      ),
    }
  );
  const publicationMaterializedAt = custody.receipt.content.verifiedAt;
  const finalOverride = { ...initialOverride, materializedAt: publicationMaterializedAt };
  const finalPipeline = createAflTradeValuationProjectionPipelineFixture(finalOverride);
  const inventory = finalPipeline.valuationOutputInventoryVerification.output;
  const inventoryIndexVerification = {
    valuationBundleManifest: finalBundle,
    valuationBundleArtifactRef:
      finalPipeline.valuationOutputInventoryVerification.valuationBundle.artifactRef,
    valuationOutputInventories: [
      {
        valuationOutputInventory: inventory.valuationOutputInventory,
        artifactRef: inventory.valuationOutputInventoryArtifactRef,
      },
    ],
    output: finalPipeline.inventoryIndex,
  };
  const custodyIndexRequest = {
    inventoryIndexVerification,
    custodyReceipts: [custody],
    createdAt: publicationMaterializedAt,
  };
  const custodyIndexVerification = {
    ...custodyIndexRequest,
    output: createAflTradeValuationOutputCustodyIndex(custodyIndexRequest),
  };
  const registration = await input.publicationCommand.register({
    publicationCandidate: finalPipeline.publicationManifest,
    custodyIndexVerification,
    actor: 'local-synthetic-valuation-rehearsal',
  });
  const projectionFixture = createAflTradeCustodiedProjectionManifestFixtureFromValuation(
    finalOverride,
    custodyIndexVerification
  );
  const materializationInput = {
    ...createAflTradeProjectionManifestMaterializationInput(projectionFixture),
    custodyIndexVerification,
  };
  const projectionVerification = {
    ...materializationInput,
    output: createAflTradeCustodiedProjectionManifestMaterialization(materializationInput),
  };
  if (
    synthetic.assessmentVerification.output.content.source.archiveId !==
    input.factual.publicArchiveId
  ) {
    throw new Error('The synthetic candidate does not bind the active factual archive.');
  }
  return {
    scenario: input.scenario,
    registration,
    projectionVerification,
    synthetic,
  };
}
