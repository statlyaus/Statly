import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import { aflTradePickPavDistributionBenchmarkSchema } from '../modeling/pickPavDistributionBenchmark';
import { aflTradePlayerPavObservationSchema } from '../modeling/playerPavObservationContracts';
import { aflTradeValuationCalculationInputPackageSchema } from './valuationCalculationInputPackage';
import {
  governedPrivateEvaluationMaterializationManifestSchema,
  type GovernedPrivateEvaluationMaterializationManifest,
} from './internal/governedPrivateEvaluationMaterializationManifest';
import { governedPrivateEvaluationExplanationPolicySchema } from './internal/governedPrivateEvaluationExplanationPolicy';
import { governedPrivateEvaluationInputTraceSchema } from './internal/governedPrivateEvaluationInputTrace';
import { replayGovernedPrivateEvaluationMaterialization } from './internal/governedPrivateEvaluationMaterializer';
import {
  aflTradeCurrentValuationCohortConstructionContextSchema,
  type AflTradeCurrentValuationCohortConstructionContext,
} from './currentValuationCohortPreparation';
import type { AflTradeValuationInputBlocker } from './preparedValuationInputSet';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);

const preparationInputSchema = z
  .object({
    context: aflTradeCurrentValuationCohortConstructionContextSchema,
    tradeId: publicIdSchema,
  })
  .strict()
  .superRefine((input, refinement) => {
    if (!input.context.releaseTradeIds.includes(input.tradeId)) {
      refinement.addIssue({
        code: 'custom',
        path: ['tradeId'],
        message: 'Current trade preparation requires one factual-release member.',
      });
    }
  });

export type AflTradeCurrentValuationTradePreparationInput = Readonly<{
  context: AflTradeCurrentValuationCohortConstructionContext;
  tradeId: string;
}>;
type PreparationInput = z.input<typeof preparationInputSchema>;
type RetainedArtifact = Readonly<{
  reference: AflTradeArtifactRef;
  bytes: Uint8Array;
}>;
export type AflTradeConstructedCurrentValuationTrade =
  | Readonly<{
      state: 'blocked';
      blockers: readonly AflTradeValuationInputBlocker[];
    }>
  | Readonly<{
      state: 'ready';
      manifest: GovernedPrivateEvaluationMaterializationManifest;
      manifestArtifact: AflTradeArtifactRef;
      retainedParents: readonly RetainedArtifact[];
    }>;

export interface AflTradeCurrentValuationTradePreparationDependencies {
  readonly construct: (
    input: AflTradeCurrentValuationTradePreparationInput
  ) => Promise<AflTradeConstructedCurrentValuationTrade>;
  readonly retainArtifact: (input: RetainedArtifact) => Promise<AflTradeArtifactRef>;
  readonly registerManifest: (input: {
    readonly manifest: GovernedPrivateEvaluationMaterializationManifest;
    readonly artifact: AflTradeArtifactRef;
  }) => Promise<{
    readonly manifest: GovernedPrivateEvaluationMaterializationManifest;
    readonly artifact: AflTradeArtifactRef;
  }>;
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function expectedParentArtifacts(
  manifest: GovernedPrivateEvaluationMaterializationManifest
): readonly AflTradeArtifactRef[] {
  return [
    manifest.content.calculationInputArtifact,
    manifest.content.inputTraceArtifact,
    manifest.content.explanationPolicyArtifact,
    manifest.content.lineageGraphArtifact,
    ...manifest.content.pickBenchmarks.map(({ artifact }) => artifact),
    ...manifest.content.playerObservations.map(({ artifact }) => artifact),
  ].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TypeError('Current trade construction parent is not valid JSON.');
  }
}

function parentValue(
  parents: readonly RetainedArtifact[],
  reference: AflTradeArtifactRef
): unknown {
  const parent = parents.find(
    ({ reference: candidate }) => candidate.artifactId === reference.artifactId
  );
  if (parent === undefined) {
    throw new TypeError('Current trade construction omitted a required retained parent.');
  }
  return parseJson(parent.bytes);
}

function authenticateConstructionAncestry(input: {
  readonly context: AflTradeCurrentValuationCohortConstructionContext;
  readonly tradeId: string;
  readonly manifest: GovernedPrivateEvaluationMaterializationManifest;
  readonly parents: readonly RetainedArtifact[];
}) {
  const content = input.manifest.content;
  const trace = governedPrivateEvaluationInputTraceSchema.parse(
    parentValue(input.parents, content.inputTraceArtifact)
  );
  const calculationInputPackage = aflTradeValuationCalculationInputPackageSchema.parse(
    parentValue(input.parents, content.calculationInputArtifact)
  );
  const explanationPolicy = governedPrivateEvaluationExplanationPolicySchema.parse(
    parentValue(input.parents, content.explanationPolicyArtifact)
  );
  const lineageGraph = parentValue(
    input.parents,
    content.lineageGraphArtifact
  ) as AflTradeLineageGraph;
  const pickBenchmarks = content.pickBenchmarks.map(({ artifact }) =>
    aflTradePickPavDistributionBenchmarkSchema.parse(parentValue(input.parents, artifact))
  );
  const playerObservations = content.playerObservations.map(({ artifact }) =>
    aflTradePlayerPavObservationSchema.parse(parentValue(input.parents, artifact))
  );
  const player = trace.content.components.find(
    ({ role }) => role === 'player_contribution_and_availability'
  );
  const pick = trace.content.components.find(
    ({ role }) => role === 'draft_pick_and_future_pick_distribution'
  );
  const playerRunId =
    'modelEvidence' in input.context
      ? input.context.modelEvidence.playerRunId
      : input.context.playerRunId;
  const pickRunId =
    'modelEvidence' in input.context
      ? input.context.modelEvidence.pickRunId
      : input.context.pickRunId;
  if (
    trace.content.selector.valuationScopeKey !== input.context.scopeKey ||
    trace.content.selector.tradeId !== input.tradeId ||
    trace.content.factualReleaseId !== input.context.factualReleaseId ||
    trace.content.valuationInputBundleId !== input.context.valuationInputBundleId ||
    calculationInputPackage.content.tradeId !== input.tradeId ||
    calculationInputPackage.content.valuationInputBundleId !==
      input.context.valuationInputBundleId ||
    player?.runId !== playerRunId ||
    pick?.runId !== pickRunId
  ) {
    throw new TypeError(
      'Current trade construction does not match the captured release, model, or bundle authority.'
    );
  }
  const replay = replayGovernedPrivateEvaluationMaterialization({
    materializationManifest: input.manifest,
    trace,
    calculationInputPackage,
    explanationPolicy,
    lineageGraph,
    pickBenchmarks,
    playerObservations,
  });
  if (replay.state !== 'ready') {
    throw new TypeError(
      'Current trade construction did not replay to one complete private evaluation.'
    );
  }
}

export function createAflTradeCurrentValuationTradePreparer(
  dependencies: AflTradeCurrentValuationTradePreparationDependencies
) {
  return {
    async prepare(unparsedInput: PreparationInput) {
      const input = preparationInputSchema.parse(unparsedInput);
      const constructed = await dependencies.construct(input);
      if (constructed.state === 'blocked') {
        return {
          tradeId: input.tradeId,
          state: 'blocked' as const,
          blockers: constructed.blockers.map(({ code, subject, evidenceRefs }) => ({
            code,
            subject: { ...subject },
            evidenceRefs: [...evidenceRefs],
          })),
        };
      }
      const manifest = governedPrivateEvaluationMaterializationManifestSchema.parse(
        constructed.manifest
      );
      const manifestArtifact = aflTradeArtifactRefSchema.parse(constructed.manifestArtifact);
      const parents = constructed.retainedParents
        .map(({ reference, bytes }) => ({
          reference: aflTradeArtifactRefSchema.parse(reference),
          bytes,
        }))
        .sort((left, right) => left.reference.artifactId.localeCompare(right.reference.artifactId));
      if (
        manifest.content.selector.valuationScopeKey !== input.context.scopeKey ||
        manifest.content.selector.tradeId !== input.tradeId ||
        Date.parse(manifest.content.createdAt) > Date.parse(input.context.capturedAt) ||
        !doesAflTradeArtifactRefMatchCanonicalJson(manifestArtifact, manifest) ||
        !exactJson(
          parents.map(({ reference }) => reference),
          expectedParentArtifacts(manifest)
        ) ||
        parents.some(
          ({ reference, bytes }) =>
            !doesAflTradeArtifactRefMatchBytes(reference, bytes, 'application/json')
        )
      ) {
        throw new TypeError(
          'Current trade construction must retain one exact, complete materialization ancestry.'
        );
      }
      authenticateConstructionAncestry({
        context: input.context,
        tradeId: input.tradeId,
        manifest,
        parents,
      });
      for (const parent of parents) {
        const retained = await dependencies.retainArtifact(parent);
        if (!exactJson(retained, parent.reference)) {
          throw new TypeError('Current trade construction parent retention changed its identity.');
        }
      }
      const retainedManifestArtifact = await dependencies.retainArtifact({
        reference: manifestArtifact,
        bytes: new TextEncoder().encode(canonicalizeAflTradeJson(manifest)),
      });
      if (!exactJson(retainedManifestArtifact, manifestArtifact)) {
        throw new TypeError('Current trade construction manifest retention changed its identity.');
      }
      const registered = await dependencies.registerManifest({
        manifest,
        artifact: manifestArtifact,
      });
      if (!exactJson(registered, { manifest, artifact: manifestArtifact })) {
        throw new TypeError('Current trade construction manifest registration conflicted.');
      }
      return {
        tradeId: input.tradeId,
        state: 'ready' as const,
        materializationManifestId: manifest.manifestId,
        materializationManifestArtifact: manifestArtifact,
      };
    },
  };
}
