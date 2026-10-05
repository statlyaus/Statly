import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  aflTradePrivateConfirmedValuationPlanV2Schema,
  aflTradePrivateConfirmedValuationResultV2Schema,
  createAflTradePrivateConfirmedValuationPlanV2,
  createAflTradePrivateConfirmedValuationResultV2,
  type AflTradePrivateConfirmedValuationPlanV2,
  type AflTradePrivateConfirmedValuationResultV2,
} from './privateConfirmedTradeValuationContracts';

type StagePlanInput = Parameters<typeof createAflTradePrivateConfirmedValuationPlanV2>[0];
type AssemblyResultInput = Omit<
  Parameters<typeof createAflTradePrivateConfirmedValuationResultV2>[0],
  'plan' | 'planArtifact'
>;

type ConstructionBlocker = Readonly<{
  state: 'blocked';
  reasons: readonly string[];
  evidenceRefs: readonly AflTradeArtifactRef[];
}>;

export interface AflTradePrivateConfirmedValuationConstructionSourceV2 {
  loadStage(input: {
    valuationScopeKey: string;
    tradeId: string;
  }): Promise<ConstructionBlocker | { state: 'ready'; input: StagePlanInput }>;
  loadAssembly(
    plan: AflTradePrivateConfirmedValuationPlanV2
  ): Promise<ConstructionBlocker | { state: 'ready'; input: AssemblyResultInput }>;
}

export interface AflTradePrivateConfirmedValuationLifecycleV2 {
  loadCurrentPlanForTrade(input: {
    valuationScopeKey: string;
    tradeId: string;
  }): Promise<{
    plan: AflTradePrivateConfirmedValuationPlanV2;
    artifact: AflTradeArtifactRef;
  } | null>;
  savePlan(input: {
    plan: AflTradePrivateConfirmedValuationPlanV2;
    artifact: AflTradeArtifactRef;
  }): Promise<void>;
  loadPlan(
    planId: string
  ): Promise<{ plan: AflTradePrivateConfirmedValuationPlanV2; artifact: AflTradeArtifactRef } | null>;
  saveResult(input: {
    result: AflTradePrivateConfirmedValuationResultV2;
    artifact: AflTradeArtifactRef;
  }): Promise<void>;
  loadResult(
    resultId: string
  ): Promise<{
    result: AflTradePrivateConfirmedValuationResultV2;
    artifact: AflTradeArtifactRef;
  } | null>;
  loadResultForPlan(planId: string): Promise<{
    result: AflTradePrivateConfirmedValuationResultV2;
    artifact: AflTradeArtifactRef;
  } | null>;
  loadLatestResultForTrade(input: {
    valuationScopeKey: string;
    tradeId: string;
    workbookSha256: string;
  }): Promise<{
    result: AflTradePrivateConfirmedValuationResultV2;
    artifact: AflTradeArtifactRef;
    workbookSha256: string;
  } | null>;
}

export interface AflTradePrivateConfirmedValuationConstructionV2 {
  stage(input: { valuationScopeKey: string; tradeId: string }): Promise<
    | {
        state: 'planned';
        plan: AflTradePrivateConfirmedValuationPlanV2;
        planArtifact: AflTradeArtifactRef;
      }
    | ConstructionBlocker
  >;
  assemble(planId: string): Promise<
    | {
        state: 'assembled';
        result: AflTradePrivateConfirmedValuationResultV2;
        resultArtifact: AflTradeArtifactRef;
      }
    | ConstructionBlocker
  >;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

async function retainExactArtifact(input: {
  repository: AflTradeImmutableArtifactRepository;
  value: unknown;
  createdAt: string;
  maximumBytes: number;
}): Promise<AflTradeArtifactRef> {
  const reference = createAflTradeCanonicalJsonArtifactRef(input.value, input.createdAt);
  const bytes = canonicalBytes(input.value);
  await input.repository.putIfAbsent(reference, bytes);
  const retained = await input.repository.loadExact(reference, input.maximumBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
    new TextDecoder().decode(retained.bytes) !== new TextDecoder().decode(bytes)
  ) {
    throw new TypeError('Private confirmed valuation artifact failed exact immutable read-back.');
  }
  return retained.reference;
}

export function createAflTradePrivateConfirmedValuationConstructionV2(dependencies: {
  source: AflTradePrivateConfirmedValuationConstructionSourceV2;
  lifecycle: AflTradePrivateConfirmedValuationLifecycleV2;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): AflTradePrivateConfirmedValuationConstructionV2 {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !['fixture_memory', 'local_non_production_filesystem'].includes(
      dependencies.artifactRepository.assurance
    ) ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError(
      'Private confirmed valuation construction requires bounded private local artifact custody.'
    );
  }

  return {
    async stage(request) {
      const prepared = await dependencies.source.loadStage(request);
      if (prepared.state === 'blocked') return prepared;
      if (
        prepared.input.valuationScopeKey !== request.valuationScopeKey ||
        prepared.input.tradeId !== request.tradeId
      ) {
        throw new TypeError('Private valuation source returned a different requested trade scope.');
      }
      const candidate = createAflTradePrivateConfirmedValuationPlanV2(prepared.input);
      const current = await dependencies.lifecycle.loadCurrentPlanForTrade(request);
      if (current !== null) {
        const retainedBytes = await dependencies.artifactRepository.loadExact(
          current.artifact,
          dependencies.maximumArtifactBytes
        );
        if (
          retainedBytes === null ||
          new TextDecoder().decode(retainedBytes.bytes) !== canonicalizeAflTradeJson(current.plan)
        ) {
          throw new TypeError('Private valuation plan custody drifted before replay.');
        }
        if (
          canonicalizeAflTradeJson({
            ...candidate.content,
            plannedAt: current.plan.content.plannedAt,
          }) === canonicalizeAflTradeJson(current.plan.content)
        ) {
          return { state: 'planned', plan: current.plan, planArtifact: current.artifact };
        }
      }
      const plan = candidate;
      const planArtifact = await retainExactArtifact({
        repository: dependencies.artifactRepository,
        value: plan,
        createdAt: plan.content.plannedAt,
        maximumBytes: dependencies.maximumArtifactBytes,
      });
      await dependencies.lifecycle.savePlan({ plan, artifact: planArtifact });
      return { state: 'planned', plan, planArtifact };
    },

    async assemble(planId) {
      const retained = await dependencies.lifecycle.loadPlan(planId);
      if (retained === null) {
        return { state: 'blocked', reasons: ['transaction_not_confirmed'], evidenceRefs: [] };
      }
      const plan = aflTradePrivateConfirmedValuationPlanV2Schema.parse(retained.plan);
      const planBytes = await dependencies.artifactRepository.loadExact(
        retained.artifact,
        dependencies.maximumArtifactBytes
      );
      if (
        planBytes === null ||
        new TextDecoder().decode(planBytes.bytes) !== canonicalizeAflTradeJson(plan)
      ) {
        throw new TypeError('Private valuation plan custody drifted before assembly.');
      }
      const existingResult = await dependencies.lifecycle.loadResultForPlan(plan.planId);
      if (existingResult !== null) {
        const resultBytes = await dependencies.artifactRepository.loadExact(
          existingResult.artifact,
          dependencies.maximumArtifactBytes
        );
        if (
          resultBytes === null ||
          existingResult.result.content.planId !== plan.planId ||
          new TextDecoder().decode(resultBytes.bytes) !==
            canonicalizeAflTradeJson(existingResult.result)
        ) {
          throw new TypeError('Private valuation result custody drifted before replay.');
        }
        return {
          state: 'assembled',
          result: existingResult.result,
          resultArtifact: existingResult.artifact,
        };
      }
      const prepared = await dependencies.source.loadAssembly(plan);
      if (prepared.state === 'blocked') return prepared;
      const result = createAflTradePrivateConfirmedValuationResultV2({
        plan,
        planArtifact: retained.artifact,
        ...prepared.input,
      });
      const resultArtifact = await retainExactArtifact({
        repository: dependencies.artifactRepository,
        value: result,
        createdAt: result.content.assembledAt,
        maximumBytes: dependencies.maximumArtifactBytes,
      });
      await dependencies.lifecycle.saveResult({ result, artifact: resultArtifact });
      return { state: 'assembled', result, resultArtifact };
    },
  };
}

/** Fixture-only lifecycle adapter for interface tests. */
export function createInMemoryAflTradePrivateConfirmedValuationLifecycle(): AflTradePrivateConfirmedValuationLifecycleV2 {
  const plans = new Map<
    string,
    { plan: AflTradePrivateConfirmedValuationPlanV2; artifact: AflTradeArtifactRef }
  >();
  const results = new Map<
    string,
    { result: AflTradePrivateConfirmedValuationResultV2; artifact: AflTradeArtifactRef }
  >();
  return {
    async loadCurrentPlanForTrade(input) {
      return (
        [...plans.values()]
          .filter(
            ({ plan }) =>
              plan.content.valuationScopeKey === input.valuationScopeKey &&
              plan.content.tradeId === input.tradeId
          )
          .sort(
            (left, right) =>
              right.plan.content.plannedAt.localeCompare(left.plan.content.plannedAt) ||
              right.plan.planId.localeCompare(left.plan.planId)
          )[0] ?? null
      );
    },
    async savePlan(input) {
      const parsed = aflTradePrivateConfirmedValuationPlanV2Schema.parse(input.plan);
      const existing = plans.get(parsed.planId);
      if (
        existing &&
        (!doAflTradeArtifactRefsExactlyMatch(existing.artifact, input.artifact) ||
          canonicalizeAflTradeJson(existing.plan) !== canonicalizeAflTradeJson(parsed))
      ) {
        throw new TypeError('Private valuation plan replay conflicts with retained lifecycle state.');
      }
      plans.set(parsed.planId, { plan: parsed, artifact: input.artifact });
    },
    async loadPlan(planId) {
      return plans.get(planId) ?? null;
    },
    async saveResult(input) {
      const parsed = aflTradePrivateConfirmedValuationResultV2Schema.parse(input.result);
      const existing = results.get(parsed.resultId);
      if (
        existing &&
        (!doAflTradeArtifactRefsExactlyMatch(existing.artifact, input.artifact) ||
          canonicalizeAflTradeJson(existing.result) !== canonicalizeAflTradeJson(parsed))
      ) {
        throw new TypeError('Private valuation result replay conflicts with retained lifecycle state.');
      }
      results.set(parsed.resultId, { result: parsed, artifact: input.artifact });
    },
    async loadResult(resultId) {
      return results.get(resultId) ?? null;
    },
    async loadResultForPlan(planId) {
      return (
        [...results.values()]
          .filter(({ result }) => result.content.planId === planId)
          .sort(
            (left, right) =>
              left.result.content.assembledAt.localeCompare(right.result.content.assembledAt) ||
              left.result.resultId.localeCompare(right.result.resultId)
          )[0] ?? null
      );
    },
    async loadLatestResultForTrade(input) {
      const retained =
        [...results.values()]
          .filter(
            ({ result }) =>
              result.content.valuationScopeKey === input.valuationScopeKey &&
              result.content.tradeId === input.tradeId
          )
          .sort(
            (left, right) =>
              right.result.content.assembledAt.localeCompare(
                left.result.content.assembledAt
              ) || right.result.resultId.localeCompare(left.result.resultId)
          )[0] ?? null;
      return retained === null ? null : { ...retained, workbookSha256: input.workbookSha256 };
    },
  };
}
