import { postseasonValuationParentsSchema } from '../postseasonValuationParents';
import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '../../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import type { AflTradeHpnPavMethodAuthority } from '../../modeling/hpnPavCalculationService';
import { materializeAflTradePostseasonObservation } from '../../modeling/postgresPostseasonObservationMaterialization';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import { aflTradePostseasonValuationCaseSchema } from '../postseasonValuationCase';
import { materializeAflTradePostseasonValuation } from '../postgresPostseasonValuationMaterialization';
import {
  createPostseasonMaterializationManifest,
  postseasonMaterializationManifestSchema,
  postseasonMaterializationRequestSchema,
  type PostseasonMaterializationManifest,
} from './postseasonMaterializationManifest';

/** Immutable v2 records in the existing materialization owner; legacy numerical readers stay v1-only. */
export class PostgresPostseasonMaterializationRepository {
  constructor(
    private readonly dependencies: {
      client: AflOutcomeSqlClient;
      artifacts: AflTradeImmutableArtifactRepository;
      evidence: AflTradeAcquisitionRegistrationEvidenceReader;
      methodAuthority: AflTradeHpnPavMethodAuthority;
      maximumArtifactBytes: number;
    }
  ) {
    if (
      dependencies.artifacts.artifactClass !== 'derived_private' ||
      dependencies.artifacts.assurance === 'durable_object_storage' ||
      !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
      dependencies.maximumArtifactBytes <= 0
    )
      throw new Error('Postseason persistence requires bounded private local artifact custody.');
  }

  private async derive(tx: AflOutcomeSqlTransaction, input: unknown, createdAt: string) {
    const request = postseasonMaterializationRequestSchema.parse(input);
    const { methodAuthority, evidence, artifacts } = this.dependencies;
    if (
      request.selection.environment === 'non_production' &&
      artifacts.assurance !== 'local_non_production_filesystem'
    )
      throw new Error(
        'Non-production materialization requires retained local non-production custody.'
      );
    const result =
      request.kind === 'complete_trade'
        ? await materializeAflTradePostseasonValuation(
            tx,
            request.selection,
            methodAuthority,
            evidence
          )
        : await materializeAflTradePostseasonObservation(
            tx,
            request.selection,
            methodAuthority,
            evidence
          );
    return createPostseasonMaterializationManifest({
      schemaVersion: 'private-evaluation-materialization-manifest/v2',
      environment: request.selection.environment,
      selector: {
        valuationScopeKey: result.selection.review.content.scopeKey,
        tradeId: result.selection.context.content.tradeId,
      },
      requestKey: createAflTradeContentAddress('postseason-materialization-request', request),
      request,
      policyApprovalDecisionId: result.policyApprovalDecisionId,
      coverageBindings: result.coverageBindings,
      observation: result.observation,
      valuationCase:
        'valuationCase' in result
          ? aflTradePostseasonValuationCaseSchema.parse(result.valuationCase)
          : null,
      valuationParents:
        'valuationParents' in result
          ? postseasonValuationParentsSchema.parse(result.valuationParents)
          : null,
      createdAt,
      publicationEligible: false,
      authorityBoundary: 'private_factual_materialization_no_numerical_admission',
    });
  }

  private async loadRetained(tx: AflOutcomeSqlTransaction, manifestId: string) {
    const result = await tx.query<{ manifest_json: unknown; valid: boolean }>(
      `SELECT manifest_json, content_canonical_json=outcome_afl_trade_canonical_json(manifest_json->'content')
        AND manifest_canonical_json=outcome_afl_trade_canonical_json(manifest_json)
        AND content_sha256=encode(sha256(convert_to(content_canonical_json,'UTF8')),'hex')
        AND materialization_manifest_id=manifest_json->>'manifestId'
        AND valuation_scope_key=manifest_json#>>'{content,selector,valuationScopeKey}'
        AND trade_id=manifest_json#>>'{content,selector,tradeId}'
        AND created_at=(manifest_json#>>'{content,createdAt}')::timestamptz AS valid
       FROM outcome_private_evaluation_materialization_manifest WHERE materialization_manifest_id=$1 FOR SHARE`,
      [manifestId]
    );
    if (result.rows.length !== 1 || !result.rows[0]?.valid)
      throw new Error('Postseason retained manifest is unavailable or inconsistent.');
    const manifest = postseasonMaterializationManifestSchema.parse(result.rows[0].manifest_json);
    const reference = createAflTradeCanonicalJsonArtifactRef(manifest, manifest.content.createdAt);
    const custody = await tx.query<{ valid: boolean }>(
      `SELECT outcome_acquisition_registration_evidence_exact($2::jsonb,$3,$4::timestamptz,clock_timestamp())
         AND EXISTS (SELECT 1 FROM outcome_private_evaluation_materialization_manifest m
           JOIN outcome_artifact_custody a ON a.artifact_id=m.artifact_id
           WHERE m.materialization_manifest_id=$1 AND a.artifact_id=$5 AND a.artifact_class='derived_private') AS valid`,
      [
        manifestId,
        canonicalizeAflTradeJson([reference]),
        manifest.content.environment,
        manifest.content.createdAt,
        reference.artifactId,
      ]
    );
    const loaded = await this.dependencies.artifacts.loadExact(
      reference,
      this.dependencies.maximumArtifactBytes
    );
    if (
      !custody.rows[0]?.valid ||
      !loaded ||
      canonicalizeAflTradeJson(loaded.reference) !== canonicalizeAflTradeJson(reference) ||
      !doesAflTradeArtifactRefMatchBytes(reference, loaded.bytes)
    )
      throw new Error('Postseason retained artifact custody differs.');
    return manifest;
  }

  private async requireCurrent(
    tx: AflOutcomeSqlTransaction,
    manifest: PostseasonMaterializationManifest
  ) {
    const current = await this.derive(tx, manifest.content.request, manifest.content.createdAt);
    if (canonicalizeAflTradeJson(current) !== canonicalizeAflTradeJson(manifest))
      throw new Error('Postseason materialization authority or derived content changed.');
    return manifest;
  }

  materialize(input: unknown) {
    const request = postseasonMaterializationRequestSchema.parse(input);
    const requestKey = createAflTradeContentAddress('postseason-materialization-request', request);
    return this.dependencies.client.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [requestKey]);
      const existing = await tx.query<{ materialization_manifest_id: string }>(
        `SELECT materialization_manifest_id FROM outcome_private_evaluation_materialization_manifest
         WHERE manifest_json#>>'{content,schemaVersion}'='private-evaluation-materialization-manifest/v2'
           AND manifest_json#>>'{content,requestKey}'=$1`,
        [requestKey]
      );
      if (existing.rows.length > 1)
        throw new Error('Postseason request has ambiguous persisted results.');
      if (existing.rows.length === 1)
        return {
          manifest: await this.requireCurrent(
            tx,
            await this.loadRetained(tx, existing.rows[0]!.materialization_manifest_id)
          ),
          idempotentReplay: true,
        };
      const clock = await tx.query<{ at: Date }>(
        "SELECT date_trunc('milliseconds',transaction_timestamp()) AS at"
      );
      const createdAt = clock.rows[0]!.at.toISOString();
      const manifest = await this.derive(tx, request, createdAt);
      const reference = createAflTradeCanonicalJsonArtifactRef(manifest, createdAt);
      if (reference.byteLength > this.dependencies.maximumArtifactBytes)
        throw new Error('Postseason manifest exceeds retained artifact bound.');
      const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(manifest));
      await this.dependencies.artifacts.putIfAbsent(reference, bytes);
      const readback = await this.dependencies.artifacts.loadExact(
        reference,
        this.dependencies.maximumArtifactBytes
      );
      if (
        !readback ||
        canonicalizeAflTradeJson(readback.reference) !== canonicalizeAflTradeJson(reference) ||
        !doesAflTradeArtifactRefMatchBytes(reference, readback.bytes)
      )
        throw new Error('Postseason artifact readback failed.');
      await tx.query(
        `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
        VALUES($1,$2,$3,$4,$5,'derived_private',$6,$7,clock_timestamp(),$8::jsonb) ON CONFLICT (artifact_id) DO NOTHING`,
        [
          reference.artifactId,
          reference.contentSha256,
          reference.storageUri,
          reference.mediaType,
          reference.byteLength,
          manifest.content.environment,
          createdAt,
          canonicalizeAflTradeJson({
            authorityBoundary: manifest.content.authorityBoundary,
            reference,
          }),
        ]
      );
      await tx.query(
        `INSERT INTO outcome_private_evaluation_materialization_manifest
        (materialization_manifest_id,content_sha256,valuation_scope_key,trade_id,artifact_id,created_at,content_canonical_json,manifest_canonical_json,manifest_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::text,$8::text::jsonb)`,
        [
          manifest.manifestId,
          manifest.manifestId.split(':')[1],
          manifest.content.selector.valuationScopeKey,
          manifest.content.selector.tradeId,
          reference.artifactId,
          createdAt,
          canonicalizeAflTradeJson(manifest.content),
          canonicalizeAflTradeJson(manifest),
        ]
      );
      return {
        manifest: await this.loadRetained(tx, manifest.manifestId),
        idempotentReplay: false,
      };
    });
  }

  loadCurrentExact(manifestId: string) {
    return this.dependencies.client.transaction(async (tx) =>
      this.requireCurrent(tx, await this.loadRetained(tx, manifestId))
    );
  }

  /** Historical evidence only. This deliberately makes no current-authority claim. */
  loadRetainedExact(manifestId: string) {
    return this.dependencies.client.transaction((tx) => this.loadRetained(tx, manifestId));
  }
}
