import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { parseLocalWorkbookPickSelectionConfirmation } from '../development/localWorkbookPickSelectionConfirmation';
import {
  createLocalPrivateTradeEvaluationGeneration,
  parseAnyLocalPrivateTradeEvaluationGeneration,
  parseLocalPrivateTradeEvaluationGeneration,
  type AnyLocalPrivateTradeEvaluationGeneration,
  type LocalPrivateTradeEvaluationGeneration,
  type LocalPrivateTradeEvaluationGenerationInput,
} from './localPrivateTradeEvaluationContracts';
import {
  parseLocalPrivateTradeEvaluationGenerationV2,
  type LocalPrivateTradeEvaluationGenerationV2,
} from './localPrivateTradeEvaluationGenerationV2';
import {
  aflTradePrivateConfirmedValuationResultV2Schema,
  type AflTradePrivateConfirmedValuationResultV2,
} from './privateConfirmedTradeValuationContracts';

export type LocalPrivateTradeEvaluationPreparation = LocalPrivateTradeEvaluationGenerationInput;

type PreparationResult =
  | { readonly state: 'ready'; readonly preparation: LocalPrivateTradeEvaluationPreparation }
  | {
      readonly state: 'blocked';
      readonly reasons: readonly string[];
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    };

interface RetainedGeneration {
  readonly generation: AnyLocalPrivateTradeEvaluationGeneration;
  readonly artifact: AflTradeArtifactRef;
}

interface EvaluationHead {
  readonly tradeId: string;
  readonly generationId: string | null;
  readonly revision: number;
  readonly withdrawalReason: string | null;
}

export interface LocalPrivateTradeEvaluationLifecycle {
  loadHead(tradeId: string): Promise<EvaluationHead | null>;
  loadGeneration(generationId: string): Promise<RetainedGeneration | null>;
  saveGeneration(input: RetainedGeneration): Promise<void>;
  compareAndSetHead(input: {
    tradeId: string;
    expectedGenerationId: string | null;
    expectedRevision: number | null;
    generationId: string | null;
    withdrawalReason: string | null;
    action: 'activate' | 'rollback' | 'withdraw';
  }): Promise<
    | { state: 'updated' }
    | {
        state: 'invalid_rollback';
        reason: 'target_is_current' | 'target_was_not_previously_active';
      }
    | {
        state: 'conflict';
        currentGenerationId: string | null;
        currentRevision: number | null;
      }
  >;
}

export interface LocalPrivateTradeEvaluationReader {
  read(
    selector: { kind: 'current'; tradeId: string } | { kind: 'generation'; generationId: string }
  ): Promise<AnyLocalPrivateTradeEvaluationGeneration | null>;
}

export interface LocalPrivateTradeEvaluationModule extends LocalPrivateTradeEvaluationReader {
  refresh(tradeId: string): Promise<
    | { state: 'refreshed' | 'unchanged'; generation: AnyLocalPrivateTradeEvaluationGeneration }
    | {
        state: 'blocked';
        reasons: readonly string[];
        evidenceRefs: readonly AflTradeArtifactRef[];
      }
    | { state: 'conflict'; currentGenerationId: string | null; currentRevision: number | null }
  >;
  transition(input: {
    tradeId: string;
    expectedGenerationId: string | null;
    expectedRevision: number | null;
    action: { kind: 'rollback'; generationId: string } | { kind: 'withdraw'; reason: string };
  }): Promise<
    | { state: 'transitioned'; generationId: string }
    | { state: 'withdrawn'; generationId: null }
    | { state: 'not_found' }
    | {
        state: 'invalid_rollback';
        reason: 'target_is_current' | 'target_was_not_previously_active';
      }
    | { state: 'conflict'; currentGenerationId: string | null; currentRevision: number | null }
  >;
}

function assertArtifactRepository(input: {
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): void {
  if (
    input.artifactRepository.artifactClass !== 'derived_private' ||
    !['fixture_memory', 'local_non_production_filesystem'].includes(
      input.artifactRepository.assurance
    ) ||
    !Number.isSafeInteger(input.maximumArtifactBytes) ||
    input.maximumArtifactBytes <= 0
  ) {
    throw new TypeError(
      'Local private trade evaluation requires bounded private non-production artifact custody.'
    );
  }
}

function exactReferences(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  const byId = new Map(references.map((reference) => [reference.artifactId, reference] as const));
  return [...byId.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function assertExactJson(left: unknown, right: unknown, message: string): void {
  if (canonicalizeAflTradeJson(left) !== canonicalizeAflTradeJson(right)) {
    throw new TypeError(message);
  }
}

async function authenticatePickConfirmation(input: {
  generation: LocalPrivateTradeEvaluationGeneration;
  asset: LocalPrivateTradeEvaluationGeneration['content']['assets'][number];
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): Promise<void> {
  if (input.asset.assetKind === 'player') return;
  const realized = input.asset.views.realized;
  if (input.asset.canonicalPlayerId === null) {
    assertExactJson(
      realized,
      { state: 'unavailable', reasons: ['pick_selection_not_confirmed'], evidenceRefs: [] },
      'Unconfirmed pick generation evidence drifted.'
    );
    return;
  }
  if (
    realized.state !== 'unavailable' ||
    realized.reasons.length !== 1 ||
    realized.reasons[0] !== 'canonical_pick_realization_unavailable'
  ) {
    throw new TypeError('Confirmed pick generation exceeded its numerical authority.');
  }
  let matchingConfirmationCount = 0;
  for (const reference of realized.evidenceRefs) {
    const retained = await input.artifactRepository.loadExact(
      reference,
      input.maximumArtifactBytes
    );
    if (retained === null || !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference)) {
      throw new TypeError('Local pick-selection confirmation custody drifted.');
    }
    try {
      const confirmation = parseLocalWorkbookPickSelectionConfirmation(
        JSON.parse(new TextDecoder().decode(retained.bytes))
      );
      if (
        confirmation.content.workbookSha256 === input.generation.content.workbookSha256 &&
        confirmation.content.valuationScopeKey === input.generation.content.valuationScopeKey &&
        confirmation.content.tradeId === input.generation.content.tradeId &&
        confirmation.content.assetId === input.asset.assetId &&
        confirmation.content.assetKind === input.asset.assetKind &&
        confirmation.content.canonicalPlayerId === input.asset.canonicalPlayerId
      ) {
        matchingConfirmationCount += 1;
      }
    } catch {
      // A non-confirmation dependency cannot establish pick identity.
    }
  }
  if (matchingConfirmationCount !== 1) {
    throw new TypeError('Pick identity is not backed by one exact selection confirmation.');
  }
}

async function authenticateConfirmedResult(input: {
  generation: LocalPrivateTradeEvaluationGeneration;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): Promise<void> {
  const confirmedResultBytes = await input.artifactRepository.loadExact(
    input.generation.content.confirmedResultArtifact,
    input.maximumArtifactBytes
  );
  if (
    confirmedResultBytes === null ||
    !doAflTradeArtifactRefsExactlyMatch(
      confirmedResultBytes.reference,
      input.generation.content.confirmedResultArtifact
    )
  ) {
    throw new TypeError('Local private trade evaluation confirmed-result custody drifted.');
  }
  let confirmedResult: AflTradePrivateConfirmedValuationResultV2;
  try {
    confirmedResult = aflTradePrivateConfirmedValuationResultV2Schema.parse(
      JSON.parse(new TextDecoder().decode(confirmedResultBytes.bytes))
    );
  } catch {
    throw new TypeError('Local private trade evaluation confirmed result is invalid.');
  }
  const confirmedAssets = new Map(
    confirmedResult.content.assets.map((asset) => [asset.assetId, asset] as const)
  );
  if (
    confirmedResult.content.tradeId !== input.generation.content.tradeId ||
    confirmedResult.content.valuationScopeKey !== input.generation.content.valuationScopeKey ||
    confirmedAssets.size !== input.generation.content.assets.length ||
    input.generation.content.assets.some((asset) => {
      const confirmed = confirmedAssets.get(asset.assetId);
      return (
        confirmed === undefined ||
        confirmed.assetKind !== asset.assetKind ||
        confirmed.sendingClubId !== asset.sendingClubId ||
        confirmed.receivingClubId !== asset.receivingClubId
      );
    })
  ) {
    throw new TypeError('Local private trade evaluation transaction membership drifted.');
  }
  const generationAssets = new Map(
    input.generation.content.assets.map((asset) => [asset.assetId, asset] as const)
  );
  for (const confirmed of confirmedResult.content.assets) {
    const generated = generationAssets.get(confirmed.assetId)!;
    const expectedAppearances =
      confirmed.appearances.state === 'observed'
        ? {
            state: 'observed',
            gamesPlayed: confirmed.appearances.gamesPlayed,
            coverage: confirmed.appearances.coverage,
            effectiveThroughSeason: confirmed.appearances.effectiveThroughSeason,
            evidenceRefs: exactReferences(confirmed.appearances.evidenceRefs),
          }
        : {
            state: 'unavailable',
            reasons: ['calculation_evidence_incomplete'],
            evidenceRefs: exactReferences(confirmed.appearances.evidenceRefs),
          };
    assertExactJson(
      generated.appearances,
      expectedAppearances,
      'Local private trade evaluation appearance derivation drifted.'
    );
    assertExactJson(
      generated.views.atTrade,
      { state: 'unavailable', reasons: ['source_rights_not_approved'], evidenceRefs: [] },
      'At-trade view exceeded its source authority.'
    );
    for (const view of [generated.views.remaining, generated.views.current]) {
      assertExactJson(
        view,
        { state: 'unavailable', reasons: ['predictive_model_not_authorized'], evidenceRefs: [] },
        'Predictive view exceeded its model authority.'
      );
    }
    if (confirmed.assetKind === 'player') {
      if (generated.canonicalPlayerId !== confirmed.canonicalPlayerId) {
        throw new TypeError('Local private player identity drifted from its confirmed result.');
      }
      const expectedRealized =
        confirmed.realizedPav.state === 'calculated'
          ? {
              state: 'calculated',
              score: confirmed.realizedPav.score,
              gamesPlayed:
                confirmed.appearances.state === 'observed'
                  ? confirmed.appearances.gamesPlayed
                  : undefined,
              components: confirmed.realizedPav.components,
              evidenceRefs: exactReferences([
                ...confirmed.realizedPav.evidenceRefs,
                ...confirmed.realizedPav.calculationArtifacts,
              ]),
            }
          : {
              state: 'unavailable',
              reasons: ['calculation_evidence_incomplete'],
              evidenceRefs: exactReferences(confirmed.realizedPav.evidenceRefs),
            };
      assertExactJson(
        generated.views.realized,
        expectedRealized,
        'Local private player calculation drifted from its confirmed result.'
      );
    } else {
      await authenticatePickConfirmation({
        generation: input.generation,
        asset: generated,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      });
    }
  }
  const realizedComplete = input.generation.content.assets.every(
    ({ views }) => views.realized.state === 'calculated'
  );
  const expectedClubTotals = realizedComplete
    ? [
        ...new Set(
          input.generation.content.assets.flatMap(({ sendingClubId, receivingClubId }) => [
            sendingClubId,
            receivingClubId,
          ])
        ),
      ]
        .sort()
        .map((clubId) => {
          const received = input.generation.content.assets.reduce(
            (sum, asset) =>
              sum +
              (asset.receivingClubId === clubId && asset.views.realized.state === 'calculated'
                ? asset.views.realized.score
                : 0),
            0
          );
          const givenUp = input.generation.content.assets.reduce(
            (sum, asset) =>
              sum +
              (asset.sendingClubId === clubId && asset.views.realized.state === 'calculated'
                ? asset.views.realized.score
                : 0),
            0
          );
          return {
            clubId,
            views: {
              atTrade: {
                state: 'unavailable',
                reasons: ['source_rights_not_approved'],
                evidenceRefs: [],
              },
              realized: {
                state: 'calculated',
                score: Number((received - givenUp).toFixed(12)),
                evidenceRefs: [input.generation.content.confirmedResultArtifact],
              },
              remaining: {
                state: 'unavailable',
                reasons: ['predictive_model_not_authorized'],
                evidenceRefs: [],
              },
              current: {
                state: 'unavailable',
                reasons: ['predictive_model_not_authorized'],
                evidenceRefs: [],
              },
            },
          };
        })
    : null;
  assertExactJson(
    input.generation.content.clubTotals,
    expectedClubTotals,
    'Local private club totals drifted from their exact asset calculations.'
  );
  assertExactJson(
    input.generation.content.overallGrade,
    {
      state: 'unavailable',
      reasons: ['asset_values_incomplete'],
      evidenceRefs: [input.generation.content.confirmedResultArtifact],
    },
    'Local private overall grade exceeded its confirmed authority.'
  );
}

async function authenticateV2Generation(input: {
  generation: LocalPrivateTradeEvaluationGenerationV2;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): Promise<void> {
  for (const reference of input.generation.content.dependencyRefs) {
    const retained = await input.artifactRepository.loadExact(
      reference,
      input.maximumArtifactBytes
    );
    if (
      retained === null ||
      !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference)
    ) {
      throw new TypeError('Local private v2 generation dependency custody drifted.');
    }
  }
  const retainedConfirmedResult = await input.artifactRepository.loadExact(
    input.generation.content.confirmedResultArtifact,
    input.maximumArtifactBytes
  );
  if (retainedConfirmedResult === null) {
    throw new TypeError('Local private v2 confirmed-result custody drifted.');
  }
  let confirmedResult: AflTradePrivateConfirmedValuationResultV2;
  try {
    confirmedResult = aflTradePrivateConfirmedValuationResultV2Schema.parse(
      JSON.parse(new TextDecoder().decode(retainedConfirmedResult.bytes))
    );
  } catch {
    throw new TypeError('Local private v2 confirmed result is invalid.');
  }
  const confirmedAssets = new Map(
    confirmedResult.content.assets.map((asset) => [asset.assetId, asset] as const)
  );
  if (
    confirmedResult.content.tradeId !== input.generation.content.tradeId ||
    confirmedResult.content.valuationScopeKey !== input.generation.content.valuationScopeKey ||
    confirmedAssets.size !== input.generation.content.assets.length ||
    input.generation.content.assets.some((asset) => {
      const confirmed = confirmedAssets.get(asset.assetId);
      return (
        confirmed === undefined ||
        confirmed.assetKind !== asset.assetKind ||
        confirmed.sendingClubId !== asset.sendingClubId ||
        confirmed.receivingClubId !== asset.receivingClubId
      );
    })
  ) {
    throw new TypeError('Local private v2 transaction membership drifted.');
  }
}

export function createLocalPrivateTradeEvaluationReader(dependencies: {
  lifecycle: LocalPrivateTradeEvaluationLifecycle;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): LocalPrivateTradeEvaluationReader {
  assertArtifactRepository(dependencies);

  async function loadExact(
    generationId: string
  ): Promise<AnyLocalPrivateTradeEvaluationGeneration | null> {
    const retained = await dependencies.lifecycle.loadGeneration(generationId);
    if (retained === null) return null;
    const generation = parseAnyLocalPrivateTradeEvaluationGeneration(retained.generation);
    const bytes = await dependencies.artifactRepository.loadExact(
      retained.artifact,
      dependencies.maximumArtifactBytes
    );
    if (
      bytes === null ||
      !doAflTradeArtifactRefsExactlyMatch(bytes.reference, retained.artifact) ||
      new TextDecoder().decode(bytes.bytes) !== canonicalizeAflTradeJson(generation)
    ) {
      throw new TypeError('Local private trade evaluation generation custody drifted.');
    }
    if (generation.content.schemaVersion === 'local-private-trade-evaluation-generation/v1') {
      await authenticateConfirmedResult({
        generation: parseLocalPrivateTradeEvaluationGeneration(generation),
        artifactRepository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
      });
    } else {
      await authenticateV2Generation({
        generation: parseLocalPrivateTradeEvaluationGenerationV2(generation),
        artifactRepository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
      });
    }
    return generation;
  }

  return {
    async read(selector) {
      if (selector.kind === 'generation') return loadExact(selector.generationId);
      const head = await dependencies.lifecycle.loadHead(selector.tradeId);
      if (head?.generationId === null || head?.generationId === undefined) return null;
      const generation = await loadExact(head.generationId);
      if (generation !== null && generation.content.tradeId !== selector.tradeId) {
        throw new TypeError('Local private evaluation head escaped the requested trade.');
      }
      return generation;
    },
  };
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

async function retainGeneration(input: {
  repository: AflTradeImmutableArtifactRepository;
  generation: LocalPrivateTradeEvaluationGeneration;
  maximumBytes: number;
}): Promise<AflTradeArtifactRef> {
  const reference = createAflTradeCanonicalJsonArtifactRef(
    input.generation,
    input.generation.content.generatedAt
  );
  const bytes = canonicalBytes(input.generation);
  await input.repository.putIfAbsent(reference, bytes);
  const retained = await input.repository.loadExact(reference, input.maximumBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
    new TextDecoder().decode(retained.bytes) !== canonicalizeAflTradeJson(input.generation)
  ) {
    throw new TypeError('Local private trade evaluation failed immutable artifact read-back.');
  }
  return retained.reference;
}

export function createLocalPrivateTradeEvaluationModule(dependencies: {
  prepare(tradeId: string): Promise<PreparationResult>;
  lifecycle: LocalPrivateTradeEvaluationLifecycle;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): LocalPrivateTradeEvaluationModule {
  const reader = createLocalPrivateTradeEvaluationReader(dependencies);

  return {
    async refresh(tradeId) {
      const head = await dependencies.lifecycle.loadHead(tradeId);
      const prepared = await dependencies.prepare(tradeId);
      if (prepared.state === 'blocked') return prepared;
      if (prepared.preparation.tradeId !== tradeId) {
        throw new TypeError('Local private evaluation preparation escaped the requested trade.');
      }
      const generation = createLocalPrivateTradeEvaluationGeneration(prepared.preparation);
      await authenticateConfirmedResult({
        generation,
        artifactRepository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
      });
      if (head?.generationId !== null && head?.generationId !== undefined) {
        const current = await reader.read({ kind: 'generation', generationId: head.generationId });
        if (current === null || current.content.tradeId !== tradeId) {
          throw new TypeError('Local private evaluation head points outside retained custody.');
        }
        if (
          current.content.schemaVersion === 'local-private-trade-evaluation-generation/v2'
        ) {
          return {
            state: 'blocked',
            reasons: ['governed_generation_requires_governed_refresh'],
            evidenceRefs: current.content.dependencyRefs,
          };
        }
        if (
          current.content.dependencyFingerprint === generation.content.dependencyFingerprint &&
          canonicalizeAflTradeJson({
            ...current.content,
            generatedAt: generation.content.generatedAt,
          }) === canonicalizeAflTradeJson(generation.content)
        ) {
          return { state: 'unchanged', generation: current };
        }
      }
      const artifact = await retainGeneration({
        repository: dependencies.artifactRepository,
        generation,
        maximumBytes: dependencies.maximumArtifactBytes,
      });
      await dependencies.lifecycle.saveGeneration({ generation, artifact });
      const updated = await dependencies.lifecycle.compareAndSetHead({
        tradeId,
        expectedGenerationId: head?.generationId ?? null,
        expectedRevision: head?.revision ?? null,
        generationId: generation.generationId,
        withdrawalReason: null,
        action: 'activate',
      });
      if (updated.state === 'invalid_rollback') {
        throw new TypeError('Activation was incorrectly classified as a rollback.');
      }
      return updated.state === 'conflict' ? updated : { state: 'refreshed', generation };
    },

    read: reader.read,

    async transition(input) {
      let generationId: string | null;
      let withdrawalReason: string | null;
      if (input.action.kind === 'rollback') {
        const target = await reader.read({
          kind: 'generation',
          generationId: input.action.generationId,
        });
        if (target === null || target.content.tradeId !== input.tradeId) {
          return { state: 'not_found' };
        }
        generationId = target.generationId;
        withdrawalReason = null;
      } else {
        const reason = input.action.reason.trim();
        if (!reason || reason.length > 2_000) {
          throw new TypeError('Withdrawal requires a bounded operator reason.');
        }
        generationId = null;
        withdrawalReason = reason;
      }
      const updated = await dependencies.lifecycle.compareAndSetHead({
        tradeId: input.tradeId,
        expectedGenerationId: input.expectedGenerationId,
        expectedRevision: input.expectedRevision,
        generationId,
        withdrawalReason,
        action: input.action.kind,
      });
      if (updated.state === 'conflict' || updated.state === 'invalid_rollback') return updated;
      return generationId === null
        ? { state: 'withdrawn', generationId: null }
        : { state: 'transitioned', generationId };
    },
  };
}

export function createInMemoryLocalPrivateTradeEvaluationLifecycle(): LocalPrivateTradeEvaluationLifecycle {
  const generations = new Map<string, RetainedGeneration>();
  const heads = new Map<string, EvaluationHead>();
  const activeGenerationIdsByTrade = new Map<string, Set<string>>();
  return {
    async loadHead(tradeId) {
      return heads.get(tradeId) ?? null;
    },
    async loadGeneration(generationId) {
      return generations.get(generationId) ?? null;
    },
    async saveGeneration(input) {
      const generation = parseAnyLocalPrivateTradeEvaluationGeneration(input.generation);
      const current = generations.get(generation.generationId);
      if (
        current !== undefined &&
        (!doAflTradeArtifactRefsExactlyMatch(current.artifact, input.artifact) ||
          canonicalizeAflTradeJson(current.generation) !== canonicalizeAflTradeJson(generation))
      ) {
        throw new TypeError('Local private evaluation generation conflicts with retained state.');
      }
      generations.set(generation.generationId, { generation, artifact: input.artifact });
    },
    async compareAndSetHead(input) {
      const current = heads.get(input.tradeId);
      const currentGenerationId = current?.generationId ?? null;
      const currentRevision = current?.revision ?? null;
      if (
        currentGenerationId !== input.expectedGenerationId ||
        currentRevision !== input.expectedRevision
      ) {
        return { state: 'conflict', currentGenerationId, currentRevision };
      }
      if (input.action === 'rollback') {
        if (input.generationId === currentGenerationId) {
          return { state: 'invalid_rollback', reason: 'target_is_current' };
        }
        if (
          input.generationId === null ||
          !activeGenerationIdsByTrade.get(input.tradeId)?.has(input.generationId)
        ) {
          return {
            state: 'invalid_rollback',
            reason: 'target_was_not_previously_active',
          };
        }
      }
      heads.set(input.tradeId, {
        tradeId: input.tradeId,
        generationId: input.generationId,
        revision: (currentRevision ?? 0) + 1,
        withdrawalReason: input.withdrawalReason,
      });
      if (input.generationId !== null) {
        const active = activeGenerationIdsByTrade.get(input.tradeId) ?? new Set<string>();
        active.add(input.generationId);
        activeGenerationIdsByTrade.set(input.tradeId, active);
      }
      return { state: 'updated' };
    },
  };
}
