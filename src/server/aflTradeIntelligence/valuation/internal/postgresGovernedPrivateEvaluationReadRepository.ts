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
  readonly status: 'active' | 'withdrawn';
  readonly generation_json: unknown | null;
}

interface GenerationRow {
  readonly generation_json: unknown;
  readonly head_status: 'active' | 'withdrawn' | null;
  readonly head_generation_id: string | null;
  readonly last_action: 'construct_and_activate' | 'withdraw' | 'rollback' | 'recover' | null;
  readonly last_from_generation_id: string | null;
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
      let lifecycle: {
        readonly status: 'active' | 'withdrawn' | 'superseded';
        readonly current: boolean;
      };
      if (request.selection.kind === 'current') {
        const result = await dependencies.client.query<CurrentRow>(
          `SELECT h.status,g.generation_json
             FROM outcome_local_private_trade_evaluation_head h
             LEFT JOIN outcome_local_private_trade_evaluation_generation g
               ON g.valuation_scope_key=h.valuation_scope_key AND g.trade_id=h.trade_id
              AND g.generation_id=h.generation_id
            WHERE h.valuation_scope_key=$1 AND h.trade_id=$2`,
          [request.selector.valuationScopeKey, request.selector.tradeId]
        );
        if (result.rows.length === 0) return unavailable(request, 'not_found');
        if (result.rows.length !== 1) return unavailable(request, 'authentication_failed');
        const row = result.rows[0]!;
        if (row.status === 'withdrawn') return unavailable(request, 'withdrawn');
        if (row.status !== 'active' || row.generation_json === null) {
          return unavailable(request, 'authentication_failed');
        }
        generationJson = row.generation_json;
        lifecycle = { status: 'active', current: true };
      } else {
        const result = await dependencies.client.query<GenerationRow>(
          `SELECT g.generation_json,h.status AS head_status,
                  h.generation_id AS head_generation_id,
                  last.action AS last_action,
                  last.from_generation_id AS last_from_generation_id
             FROM outcome_local_private_trade_evaluation_generation g
             LEFT JOIN outcome_local_private_trade_evaluation_head h
               ON h.valuation_scope_key=g.valuation_scope_key AND h.trade_id=g.trade_id
             LEFT JOIN outcome_private_evaluation_transition_receipt last
               ON last.transition_id=h.last_transition_id
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
        lifecycle =
          row.head_status === 'active' &&
          row.head_generation_id === request.selection.generationId
            ? { status: 'active', current: true }
            : row.head_status === 'withdrawn' &&
                row.last_action === 'withdraw' &&
                row.last_from_generation_id === request.selection.generationId
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
