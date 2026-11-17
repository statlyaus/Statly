import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import type { AflTradeLineageGraph } from '../../domain/lineageTypes';
import { aflTradePickPavDistributionBenchmarkSchema } from '../../modeling/pickPavDistributionBenchmark';
import { aflTradePlayerPavObservationSchema } from '../../modeling/playerPavObservationContracts';
import { aflTradeValuationCalculationInputPackageSchema } from '../valuationCalculationInputPackage';
import { governedPrivateEvaluationExplanationPolicySchema } from './governedPrivateEvaluationExplanationPolicy';
import { governedPrivateEvaluationInputTraceSchema } from './governedPrivateEvaluationInputTrace';
import { replayGovernedPrivateEvaluationMaterialization } from './governedPrivateEvaluationMaterializer';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from './postgresGovernedPrivateEvaluationMaterializationManifestRepository';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';

async function loadJson(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly reference: AflTradeArtifactRef;
  readonly maximumBytes: number;
}): Promise<unknown> {
  const retained = await input.repository.loadExact(input.reference, input.maximumBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, input.reference) ||
    !doesAflTradeArtifactRefMatchBytes(retained.reference, retained.bytes, 'application/json')
  ) {
    throw new TypeError('Materialization replay parent failed exact retained-byte authentication.');
  }
  try {
    return JSON.parse(new TextDecoder().decode(retained.bytes));
  } catch {
    throw new TypeError('Materialization replay parent is not valid JSON.');
  }
}

export function createPostgresGovernedPrivateEvaluationMaterializationReplay(
  dependencies: {
    readonly client: AflOutcomeSqlClient;
    readonly artifactRepository: AflTradeImmutableArtifactRepository;
    readonly maximumArtifactBytes: number;
  }
) {
  const manifests = new PostgresGovernedPrivateEvaluationMaterializationManifestRepository(
    dependencies.client
  );
  const load = (reference: AflTradeArtifactRef) =>
    loadJson({
      repository: dependencies.artifactRepository,
      reference,
      maximumBytes: dependencies.maximumArtifactBytes,
    });
  return async function replay(input: { readonly materializationManifestId: string }) {
    const retained = await manifests.loadExact(input.materializationManifestId);
    const manifest = retained.manifest;
    const content = manifest.content;
    const [trace, calculationInputPackage, explanationPolicy, lineageGraph] =
      await Promise.all([
        load(content.inputTraceArtifact),
        load(content.calculationInputArtifact),
        load(content.explanationPolicyArtifact),
        load(content.lineageGraphArtifact),
      ]);
    const pickBenchmarks = await Promise.all(
      content.pickBenchmarks.map(async ({ artifact }) =>
        aflTradePickPavDistributionBenchmarkSchema.parse(await load(artifact))
      )
    );
    const playerObservations = await Promise.all(
      content.playerObservations.map(async ({ artifact }) =>
        aflTradePlayerPavObservationSchema.parse(await load(artifact))
      )
    );
    return replayGovernedPrivateEvaluationMaterialization({
      materializationManifest: manifest,
      trace: governedPrivateEvaluationInputTraceSchema.parse(trace),
      calculationInputPackage:
        aflTradeValuationCalculationInputPackageSchema.parse(calculationInputPackage),
      explanationPolicy:
        governedPrivateEvaluationExplanationPolicySchema.parse(explanationPolicy),
      lineageGraph: lineageGraph as AflTradeLineageGraph,
      pickBenchmarks,
      playerObservations,
    });
  };
}
