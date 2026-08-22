import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  parseGovernedPrivateEvaluationGeneration,
  parseGovernedPrivateEvaluationProjectionManifest,
  UnsupportedGovernedPrivateEvaluationProjectionVersionError,
  verifyGovernedPrivateEvaluationGeneration,
  type GovernedPrivateEvaluationGenerationMaterialization,
  type GovernedPrivateEvaluationRetainedArtifact,
} from '../governedPrivateEvaluationGeneration';
import {
  governedPrivateEvaluationReadRequestSchema,
  governedPrivateEvaluationReadResultSchema,
  type GovernedPrivateEvaluationReadRequest,
  type GovernedPrivateEvaluationReadResult,
} from './governedPrivateEvaluationWorkspaceContracts';

interface CurrentRow {
  readonly batch_id: string;
  readonly state: 'ready' | 'unavailable';
  readonly generation_json: unknown | null;
  readonly withdrawal_id: string | null;
}

interface BatchRow extends CurrentRow {
  readonly batch_current: boolean;
}

interface GenerationRow {
  readonly generation_json: unknown;
  readonly selected_batch_id: string | null;
  readonly batch_current: boolean;
  readonly batch_withdrawn: boolean;
}

type DocumentKind = GovernedPrivateEvaluationReadRequest['document']['kind'];

class ProjectionUnavailableError extends Error {}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function loadExact(
  repository: AflTradeImmutableArtifactRepository,
  reference: AflTradeArtifactRef,
  maximumBytes: number
): Promise<Uint8Array> {
  const retained = await repository.loadExact(reference, maximumBytes);
  if (retained === null) throw new ProjectionUnavailableError();
  if (
    !doAflTradeArtifactRefsExactlyMatch(reference, retained.reference) ||
    !doesAflTradeArtifactRefMatchBytes(retained.reference, retained.bytes)
  ) {
    throw new TypeError('Retained private projection bytes failed exact authentication.');
  }
  return retained.bytes;
}

export async function loadAuthenticatedGovernedPrivateEvaluationMaterialization(input: {
  readonly generationJson: unknown;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<GovernedPrivateEvaluationGenerationMaterialization> {
  const generation = parseGovernedPrivateEvaluationGeneration(input.generationJson);
  const generationContent = generation?.content;
  if (
    typeof generation?.generationId !== 'string' ||
    typeof generationContent?.generatedAt !== 'string' ||
    generationContent.narrativeArtifact === undefined ||
    generationContent.projectionManifestArtifact === undefined
  ) {
    throw new TypeError('The retained private evaluation generation is malformed.');
  }
  const narrativeReference = aflTradeArtifactRefSchema.parse(
    generationContent.narrativeArtifact
  );
  const manifestReference = aflTradeArtifactRefSchema.parse(
    generationContent.projectionManifestArtifact
  );
  const generationReference = createAflTradeCanonicalJsonArtifactRef(
    generation,
    generationContent.generatedAt
  );
  const narrativeBytes = await loadExact(
    input.artifactRepository,
    narrativeReference,
    input.maximumArtifactBytes
  );
  const manifestBytes = await loadExact(
    input.artifactRepository,
    manifestReference,
    input.maximumArtifactBytes
  );
  const generationBytes = await loadExact(
    input.artifactRepository,
    generationReference,
    input.maximumArtifactBytes
  );
  const projectionManifest = parseGovernedPrivateEvaluationProjectionManifest(
    parseJson(manifestBytes)
  );
  if (
    projectionManifest?.content?.documents === undefined ||
    !Array.isArray(projectionManifest.content.documents)
  ) {
    throw new TypeError('The retained private evaluation projection manifest is malformed.');
  }
  const documentArtifacts: GovernedPrivateEvaluationRetainedArtifact[] = [];
  for (const document of projectionManifest.content.documents) {
    const reference = aflTradeArtifactRefSchema.parse(document.artifact);
    documentArtifacts.push({
      kind: document.kind,
      reference,
      bytes: await loadExact(
        input.artifactRepository,
        reference,
        input.maximumArtifactBytes
      ),
    });
  }
  const materialization: GovernedPrivateEvaluationGenerationMaterialization = {
    generation,
    projectionManifest,
    artifacts: [
      { kind: 'calculation_narrative', reference: narrativeReference, bytes: narrativeBytes },
      ...documentArtifacts,
      { kind: 'projection_manifest', reference: manifestReference, bytes: manifestBytes },
      { kind: 'generation', reference: generationReference, bytes: generationBytes },
    ],
  };
  if (!verifyGovernedPrivateEvaluationGeneration(materialization)) {
    throw new TypeError('The retained private evaluation generation failed reconstruction.');
  }
  return materialization;
}

function unavailable(
  request: GovernedPrivateEvaluationReadRequest,
  reason: Extract<GovernedPrivateEvaluationReadResult, { state: 'unavailable' }>['reason']
): GovernedPrivateEvaluationReadResult {
  return governedPrivateEvaluationReadResultSchema.parse({
    state: 'unavailable',
    selector: request.selector,
    selection: request.selection,
    document: request.document,
    reason,
  });
}

export function createPostgresGovernedPrivateEvaluationReadRepository(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly principalId: string;
  readonly authorizeReader: (input: {
    readonly principalId: string;
    readonly selector: GovernedPrivateEvaluationReadRequest['selector'];
  }) => Promise<boolean>;
}) {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0 ||
    dependencies.principalId.trim() === '' ||
    dependencies.principalId.length > 400
  ) {
    throw new TypeError(
      'Private evaluation reads require authenticated reader identity and bounded private artifact custody.'
    );
  }
  return {
    async read(unparsedRequest: GovernedPrivateEvaluationReadRequest) {
      const request = governedPrivateEvaluationReadRequestSchema.parse(unparsedRequest);
      const authorized = await dependencies.authorizeReader({
        principalId: dependencies.principalId,
        selector: request.selector,
      });
      if (!authorized) return unavailable(request, 'not_found');
      let generationJson: unknown;
      let batchId: string | null;
      let lifecycle: {
        readonly status: 'active' | 'withdrawn' | 'superseded';
        readonly current: boolean;
      };
      if (request.selection.kind === 'current') {
        const result = await dependencies.client.query<CurrentRow>(
          `SELECT h.batch_id,e.state,g.generation_json,w.withdrawal_id
             FROM outcome_current_private_evaluation_batch h
             JOIN outcome_private_evaluation_batch_entry e
               ON e.batch_id=h.batch_id AND e.trade_id=$2
             LEFT JOIN outcome_local_private_trade_evaluation_generation g
               ON g.valuation_scope_key=h.scope_key AND g.trade_id=e.trade_id
              AND g.generation_id=e.generation_id
             LEFT JOIN outcome_private_evaluation_batch_withdrawal w
               ON w.batch_id=e.batch_id AND w.trade_id=e.trade_id
            WHERE h.scope_key=$1`,
          [request.selector.valuationScopeKey, request.selector.tradeId]
        );
        if (result.rows.length === 0) return unavailable(request, 'not_found');
        if (result.rows.length !== 1) return unavailable(request, 'authentication_failed');
        const row = result.rows[0]!;
        if (row.withdrawal_id !== null) return unavailable(request, 'withdrawn');
        if (row.state === 'unavailable') return unavailable(request, 'projection_unavailable');
        if (row.state !== 'ready' || row.generation_json === null)
          return unavailable(request, 'authentication_failed');
        generationJson = row.generation_json;
        batchId = row.batch_id;
        lifecycle = { status: 'active', current: true };
      } else if (request.selection.kind === 'batch') {
        const result = await dependencies.client.query<BatchRow>(
          `SELECT target_batch.batch_id,entry.state,generation.generation_json,
                  withdrawal.withdrawal_id,
                  (current_batch.batch_id=target_batch.batch_id) AS batch_current
             FROM outcome_private_evaluation_batch target_batch
             JOIN outcome_private_evaluation_batch_entry entry
               ON entry.batch_id=target_batch.batch_id AND entry.trade_id=$2
             LEFT JOIN outcome_local_private_trade_evaluation_generation generation
               ON generation.valuation_scope_key=target_batch.scope_key
              AND generation.trade_id=entry.trade_id
              AND generation.generation_id=entry.generation_id
             LEFT JOIN outcome_private_evaluation_batch_withdrawal withdrawal
               ON withdrawal.batch_id=entry.batch_id AND withdrawal.trade_id=entry.trade_id
              AND withdrawal.generation_id=entry.generation_id
             LEFT JOIN outcome_current_private_evaluation_batch current_batch
               ON current_batch.scope_key=target_batch.scope_key
            WHERE target_batch.scope_key=$1 AND target_batch.batch_id=$3
              AND EXISTS (
                SELECT 1 FROM outcome_private_evaluation_batch_transition activated
                 WHERE activated.scope_key=target_batch.scope_key
                   AND activated.to_batch_id=target_batch.batch_id
                   AND activated.action IN ('activate','rollback')
              )`,
          [
            request.selector.valuationScopeKey,
            request.selector.tradeId,
            request.selection.batchId,
          ]
        );
        if (result.rows.length === 0) return unavailable(request, 'not_found');
        if (result.rows.length !== 1) return unavailable(request, 'authentication_failed');
        const row = result.rows[0]!;
        if (row.state === 'unavailable') return unavailable(request, 'projection_unavailable');
        if (row.state !== 'ready' || row.generation_json === null)
          return unavailable(request, 'authentication_failed');
        generationJson = row.generation_json;
        batchId = row.batch_id;
        lifecycle =
          row.withdrawal_id !== null
            ? { status: 'withdrawn', current: false }
            : row.batch_current
              ? { status: 'active', current: true }
              : { status: 'superseded', current: false };
      } else {
        const result = await dependencies.client.query<GenerationRow>(
          `SELECT g.generation_json,membership.batch_id AS selected_batch_id,
                  COALESCE(membership.batch_current,FALSE) AS batch_current,
                  COALESCE(membership.batch_withdrawn,FALSE) AS batch_withdrawn
             FROM outcome_local_private_trade_evaluation_generation g
             LEFT JOIN LATERAL (
               SELECT retained_batch.batch_id,
                      (current_batch.batch_id=retained_batch.batch_id) AS batch_current,
                      (withdrawal.withdrawal_id IS NOT NULL) AS batch_withdrawn
                 FROM outcome_private_evaluation_batch_entry retained_entry
                 JOIN outcome_private_evaluation_batch retained_batch
                   ON retained_batch.batch_id=retained_entry.batch_id
                 JOIN outcome_private_evaluation_batch_transition activated
                   ON activated.scope_key=retained_batch.scope_key
                  AND activated.to_batch_id=retained_batch.batch_id
                  AND activated.action IN ('activate','rollback')
                 LEFT JOIN outcome_current_private_evaluation_batch current_batch
                   ON current_batch.scope_key=retained_batch.scope_key
                 LEFT JOIN outcome_private_evaluation_batch_withdrawal withdrawal
                   ON withdrawal.batch_id=retained_entry.batch_id
                  AND withdrawal.trade_id=retained_entry.trade_id
                  AND withdrawal.generation_id=retained_entry.generation_id
                WHERE retained_batch.scope_key=g.valuation_scope_key
                  AND retained_entry.trade_id=g.trade_id
                  AND retained_entry.generation_id=g.generation_id
                ORDER BY (current_batch.batch_id=retained_batch.batch_id) DESC,
                         activated.to_revision DESC
                LIMIT 1
             ) membership ON TRUE
            WHERE g.valuation_scope_key=$1 AND g.trade_id=$2 AND g.generation_id=$3
              AND EXISTS (
                SELECT 1 FROM outcome_private_evaluation_transition_receipt activated
                 WHERE activated.valuation_scope_key=g.valuation_scope_key
                   AND activated.trade_id=g.trade_id
                   AND activated.to_generation_id=g.generation_id
                   AND activated.action IN ('construct_and_activate','rollback','recover')
              )`,
          [
            request.selector.valuationScopeKey,
            request.selector.tradeId,
            request.selection.generationId,
          ]
        );
        if (result.rows.length === 0) return unavailable(request, 'not_found');
        if (result.rows.length !== 1) return unavailable(request, 'authentication_failed');
        const row = result.rows[0]!;
        generationJson = row.generation_json;
        batchId = row.selected_batch_id;
        lifecycle =
          row.batch_current && !row.batch_withdrawn
            ? { status: 'active', current: true }
            : row.batch_withdrawn
              ? { status: 'withdrawn', current: false }
              : { status: 'superseded', current: false };
      }
      try {
        const materialization = await loadAuthenticatedGovernedPrivateEvaluationMaterialization({
          generationJson,
          artifactRepository: dependencies.artifactRepository,
          maximumArtifactBytes: dependencies.maximumArtifactBytes,
        });
        if (
          !same(materialization.generation.content.selector, request.selector) ||
          (request.selection.kind === 'generation' &&
            materialization.generation.generationId !== request.selection.generationId)
        ) {
          return unavailable(request, 'authentication_failed');
        }
        const document = materialization.artifacts.find(
          (artifact) => artifact.kind === (request.document.kind as DocumentKind)
        );
        if (document === undefined) return unavailable(request, 'projection_unavailable');
        return governedPrivateEvaluationReadResultSchema.parse({
          state: 'available',
          selector: request.selector,
          selection: request.selection,
          batchId,
          generationId: materialization.generation.generationId,
          projectionManifestId: materialization.projectionManifest.projectionManifestId,
          lifecycle,
          document: { kind: request.document.kind, artifact: document.reference },
          bytes: document.bytes,
        });
      } catch (error) {
        return unavailable(
          request,
          error instanceof ProjectionUnavailableError ||
            error instanceof UnsupportedGovernedPrivateEvaluationProjectionVersionError
            ? 'projection_unavailable'
            : 'authentication_failed'
        );
      }
    },
  };
}
