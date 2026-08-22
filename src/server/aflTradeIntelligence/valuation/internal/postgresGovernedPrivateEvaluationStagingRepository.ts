import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  verifyGovernedPrivateEvaluationGeneration,
  type GovernedPrivateEvaluationGenerationMaterialization,
  type GovernedPrivateEvaluationRetainedArtifact,
} from '../governedPrivateEvaluationGeneration';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../automatedPrivateEvaluationPolicy';
import {
  parseAnyGovernedPrivateEvaluationTransitionIntent,
  type AnyGovernedPrivateEvaluationTransitionIntent,
} from './governedPrivateEvaluationLifecycle';

interface CustodyRow {
  readonly artifact_id: string;
  readonly content_sha256: string;
  readonly storage_uri: string;
  readonly media_type: string;
  readonly byte_length: number | string | bigint;
}

interface IntentRow {
  readonly intent_json: unknown;
  readonly artifact_id: string;
}

interface GenerationRow {
  readonly generation_json: unknown;
  readonly generation_artifact_id: string;
}

interface TrustedTimeRow {
  readonly trusted_at: Date | string;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

async function loadTrustedTime(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<TrustedTimeRow>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  const parsed = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (result.rows.length !== 1 || !Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation staging requires trusted PostgreSQL time.');
  }
  return parsed.toISOString();
}

async function retainExact(
  repository: AflTradeImmutableArtifactRepository,
  maximumBytes: number,
  artifact: { readonly reference: AflTradeArtifactRef; readonly bytes: Uint8Array }
): Promise<void> {
  await repository.putIfAbsent(artifact.reference, artifact.bytes);
  const retained = await repository.loadExact(artifact.reference, maximumBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, artifact.reference) ||
    !doesAflTradeArtifactRefMatchBytes(retained.reference, retained.bytes) ||
    retained.bytes.byteLength !== artifact.bytes.byteLength ||
    retained.bytes.some((byte, index) => byte !== artifact.bytes[index])
  ) {
    throw new TypeError('Private evaluation staging failed exact artifact readback.');
  }
}

async function registerCustody(
  transaction: AflOutcomeSqlTransaction,
  reference: AflTradeArtifactRef,
  verifiedAt: string,
  custody: {
    readonly environment: 'test_fixture' | 'non_production';
    readonly repositoryAssurance:
      | 'fixture_memory'
      | 'fixture_filesystem'
      | 'local_non_production_filesystem';
  }
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private',$6,$7,$8,$9::jsonb)
     ON CONFLICT (artifact_id) DO NOTHING`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      custody.environment,
      reference.createdAt,
      verifiedAt,
      canonicalizeAflTradeJson({
        schemaVersion: 'governed-private-evaluation-artifact-custody/v1',
        environment: custody.environment,
        repositoryAssurance: custody.repositoryAssurance,
        publicationProhibited: true,
        reference,
      }),
    ]
  );
  const retained = await transaction.query<CustodyRow>(
    `SELECT artifact_id,content_sha256,storage_uri,media_type,byte_length
       FROM outcome_artifact_custody
      WHERE artifact_id=$1 FOR KEY SHARE`,
    [reference.artifactId]
  );
  const row = retained.rows[0];
  if (
    retained.rows.length !== 1 ||
    row === undefined ||
    row.artifact_id !== reference.artifactId ||
    row.content_sha256 !== reference.contentSha256 ||
    row.storage_uri !== reference.storageUri ||
    row.media_type !== reference.mediaType ||
    String(row.byte_length) !== String(reference.byteLength)
  ) {
    throw new TypeError('Private evaluation artifact custody replay conflicts.');
  }
}

async function insertIntent(
  transaction: AflOutcomeSqlTransaction,
  intent: AnyGovernedPrivateEvaluationTransitionIntent,
  artifact: AflTradeArtifactRef
): Promise<void> {
  const content = intent.content;
  const existing = await transaction.query<IntentRow>(
    `SELECT intent_json,artifact_id
       FROM outcome_private_evaluation_transition_intent
      WHERE transition_intent_id=$1 FOR KEY SHARE`,
    [intent.transitionIntentId]
  );
  if (existing.rows[0] !== undefined) {
    if (
      existing.rows.length !== 1 ||
      !same(existing.rows[0].intent_json, intent) ||
      existing.rows[0].artifact_id !== artifact.artifactId
    ) {
      throw new TypeError('Private evaluation transition intent replay conflicts.');
    }
    return;
  }
  await transaction.query(
    `INSERT INTO outcome_private_evaluation_transition_intent
      (transition_intent_id,inspection_id,authority_snapshot_id,operation_id,valuation_scope_key,trade_id,
       artifact_id,action,expected_head_status,expected_head_revision,
       expected_head_generation_id,target_generation_id,requested_at,expires_at,
       content_sha256,content_canonical_json,intent_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
    `,
    [
      intent.transitionIntentId,
      content.inspectionId,
      content.authoritySnapshotId,
      content.operationId,
      content.selector.valuationScopeKey,
      content.selector.tradeId,
      artifact.artifactId,
      content.action.kind,
      content.expectedHead.status,
      content.expectedHead.revision,
      content.expectedHead.generationId,
      content.action.kind === 'rollback' ? content.action.targetGenerationId : null,
      content.requestedAt,
      content.expiresAt,
      intent.transitionIntentId.slice('private-evaluation-transition-intent:'.length),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(intent),
    ]
  );
  const retained = await transaction.query<IntentRow>(
    `SELECT intent_json,artifact_id
       FROM outcome_private_evaluation_transition_intent
      WHERE transition_intent_id=$1 FOR KEY SHARE`,
    [intent.transitionIntentId]
  );
  if (
    retained.rows.length !== 1 ||
    !same(retained.rows[0]?.intent_json, intent) ||
    retained.rows[0]?.artifact_id !== artifact.artifactId
  ) {
    throw new TypeError('Private evaluation transition intent replay conflicts.');
  }
}

async function insertGeneration(
  transaction: AflOutcomeSqlTransaction,
  materialization: GovernedPrivateEvaluationGenerationMaterialization
): Promise<void> {
  const generation = materialization.generation;
  const byKind = new Map(materialization.artifacts.map((artifact) => [artifact.kind, artifact]));
  const generationArtifact = byKind.get('generation')!;
  const narrativeArtifact = byKind.get('calculation_narrative')!;
  const manifestArtifact = byKind.get('projection_manifest')!;
  const existing = await transaction.query<GenerationRow>(
    `SELECT generation_json,generation_artifact_id
       FROM outcome_local_private_trade_evaluation_generation
      WHERE generation_id=$1 FOR KEY SHARE`,
    [generation.generationId]
  );
  if (existing.rows[0] !== undefined) {
    if (
      existing.rows.length !== 1 ||
      !same(existing.rows[0].generation_json, generation) ||
      existing.rows[0].generation_artifact_id !== generationArtifact.reference.artifactId
    ) {
      throw new TypeError('Private evaluation dormant generation replay conflicts.');
    }
    return;
  }
  await transaction.query(
    `INSERT INTO outcome_local_private_trade_evaluation_generation
      (generation_id,valuation_scope_key,trade_id,transition_intent_id,
       generation_artifact_id,narrative_artifact_id,projection_manifest_artifact_id,
       generated_at,content_sha256,content_canonical_json,generation_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    `,
    [
      generation.generationId,
      generation.content.selector.valuationScopeKey,
      generation.content.selector.tradeId,
      generation.content.transitionIntentId,
      generationArtifact.reference.artifactId,
      narrativeArtifact.reference.artifactId,
      manifestArtifact.reference.artifactId,
      generation.content.generatedAt,
      generation.generationId.slice('local-private-trade-evaluation-generation:'.length),
      canonicalizeAflTradeJson(generation.content),
      canonicalizeAflTradeJson(generation),
    ]
  );
  const retained = await transaction.query<GenerationRow>(
    `SELECT generation_json,generation_artifact_id
       FROM outcome_local_private_trade_evaluation_generation
      WHERE generation_id=$1 FOR KEY SHARE`,
    [generation.generationId]
  );
  if (
    retained.rows.length !== 1 ||
    !same(retained.rows[0]?.generation_json, generation) ||
    retained.rows[0]?.generation_artifact_id !== generationArtifact.reference.artifactId
  ) {
    throw new TypeError('Private evaluation dormant generation replay conflicts.');
  }
}

export function createPostgresGovernedPrivateEvaluationStagingRepository(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly enableAutomatedPrivateCalculation?: true;
}) {
  if ('automatedPrincipalId' in dependencies) {
    throw new TypeError(
      'Private evaluation staging does not accept a caller-supplied automated principal.'
    );
  }
  const repositoryAssurance = dependencies.artifactRepository.assurance;
  if (repositoryAssurance === 'durable_object_storage') {
    throw new TypeError('Private evaluation staging requires private local custody.');
  }
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Private evaluation staging requires bounded private fixture custody.');
  }
  const automatedCalculationEnabled =
    dependencies.enableAutomatedPrivateCalculation === true;
  const custody = {
    environment:
      dependencies.artifactRepository.assurance === 'local_non_production_filesystem'
        ? ('non_production' as const)
        : ('test_fixture' as const),
    repositoryAssurance,
  };
  return {
    async retainArtifact(input: {
      readonly reference: AflTradeArtifactRef;
      readonly bytes: Uint8Array;
    }): Promise<AflTradeArtifactRef> {
      const reference = aflTradeArtifactRefSchema.parse(input.reference);
      await retainExact(dependencies.artifactRepository, dependencies.maximumArtifactBytes, {
        reference,
        bytes: input.bytes,
      });
      await dependencies.client.transaction(async (transaction) => {
        const verifiedAt = await loadTrustedTime(transaction);
        await registerCustody(transaction, reference, verifiedAt, custody);
      });
      return reference;
    },

    async stage(input: {
      readonly intent: AnyGovernedPrivateEvaluationTransitionIntent;
      readonly intentArtifact: AflTradeArtifactRef;
      readonly materialization?: GovernedPrivateEvaluationGenerationMaterialization;
    }) {
      const intent = parseAnyGovernedPrivateEvaluationTransitionIntent(input.intent);
      const intentArtifact = aflTradeArtifactRefSchema.parse(input.intentArtifact);
      const constructing = intent.content.action.kind === 'construct_and_activate';
      const automated = intent.content.schemaVersion === 'private-evaluation-transition-intent/v2';
      const automatedAuthority = intent.content.schemaVersion ===
        'private-evaluation-transition-intent/v2'
        ? intent.content.constructionAuthority
        : null;
      if (
        automated &&
        (!automatedCalculationEnabled ||
          automatedAuthority?.principalId !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID)
      ) {
        throw new TypeError(
          'Automated private staging requires the exact configured system principal.'
        );
      }
      const materialization = input.materialization;
      if (
        constructing !== (materialization !== undefined) ||
        (materialization !== undefined &&
          (!verifyGovernedPrivateEvaluationGeneration(materialization) ||
            materialization.generation.content.transitionIntentId !==
              intent.transitionIntentId ||
            !same(materialization.generation.content.selector, intent.content.selector))) ||
        (automated &&
          (materialization?.generation.content.schemaVersion !==
            'local-private-trade-evaluation-generation/v2' ||
            materialization.projectionManifest.content.schemaVersion !==
              'governed-private-evaluation-projection-manifest/v2' ||
            !('constructionAuthority' in materialization.generation.content) ||
            !same(
              materialization.generation.content.constructionAuthority,
              automatedAuthority
            )))
      ) {
        throw new TypeError('Construction staging requires one complete verified generation.');
      }
      if (!doesAflTradeArtifactRefMatchCanonicalJson(intentArtifact, intent)) {
        throw new TypeError('The transition intent artifact does not authenticate its exact JSON.');
      }
      const intentRetained = {
        reference: intentArtifact,
        bytes: canonicalBytes(intent),
      };
      const retained: readonly (
        | typeof intentRetained
        | GovernedPrivateEvaluationRetainedArtifact
      )[] = [intentRetained, ...(input.materialization?.artifacts ?? [])];
      for (const artifact of retained) {
        await retainExact(
          dependencies.artifactRepository,
          dependencies.maximumArtifactBytes,
          artifact
        );
      }
      return dependencies.client.transaction(async (transaction) => {
        await transaction.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
          [intent.transitionIntentId]
        );
        const verifiedAt = await loadTrustedTime(transaction);
        for (const artifact of retained) {
          await registerCustody(transaction, artifact.reference, verifiedAt, custody);
        }
        await insertIntent(transaction, intent, intentArtifact);
        if (input.materialization !== undefined) {
          await insertGeneration(transaction, input.materialization);
        }
        return {
          transitionIntentId: intent.transitionIntentId,
          generationId: input.materialization?.generation.generationId ?? null,
        };
      });
    },
  };
}
