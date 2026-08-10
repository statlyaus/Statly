import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeArtifactReadbackReceiptSchema } from '../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type {
  AflTradeExternalCaptureRegistry,
  PersistAflTradeExternalCaptureInput,
  PersistedAflTradeExternalCapture,
} from './externalDraftTradeIngestion';
import { parseAflTradeExternalCaptureExecutionReceipt } from './externalDraftTradeIngestion';

const primitiveInputSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: z.enum([
      'draftguru',
      'footywire',
      'official_afl',
      'fitzroy_official_afl_player_details',
    ]),
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    draftPathway: z.enum(['national', 'rookie', 'pre_season', 'mid_season']).nullable(),
    dataset: z.string().trim().min(1).max(160),
    datasetVersion: z.string().trim().min(1).max(160),
    accessMechanism: z.string().trim().min(1).max(160),
    capabilityId: z.string().trim().min(1).max(240),
    sourceUrl: z.string().url().startsWith('https://').max(2_048),
    capturedAt: z.iso.datetime({ offset: true }),
    effectiveAt: z.iso.datetime({ offset: true }),
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    eTag: z.string().max(1_000).nullable(),
    lastModified: z.string().max(1_000).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (Date.parse(input.effectiveAt) > Date.parse(input.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveAt'],
        message: 'Source effective time cannot follow capture time.',
      });
    }
  });

export class AflTradeExternalCaptureRegistryError extends Error {
  constructor(
    readonly code: 'INVALID_CAPTURE' | 'CUSTODY_MISMATCH' | 'IMMUTABLE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalCaptureRegistryError';
  }
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function sameArtifactContent(
  left: z.infer<typeof aflTradeArtifactRefSchema>,
  right: z.infer<typeof aflTradeArtifactRefSchema>
): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.contentSha256 === right.contentSha256 &&
    left.storageUri === right.storageUri &&
    left.mediaType === right.mediaType &&
    left.byteLength === right.byteLength
  );
}

function executionScope(receipt: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt>) {
  return receipt.content.schemaVersion === 'afl-trade-external-capture-execution/v2'
    ? {
        provider: receipt.content.request.provider,
        capabilityId: receipt.content.request.capabilityId,
        parserVersion: receipt.content.request.parserVersion,
        fieldManifestSha256: receipt.content.request.fieldManifestSha256,
        evaluatedAt: receipt.content.gate0aReceipt.content.request.evaluatedAt,
      }
    : {
        provider: receipt.content.provider,
        capabilityId: receipt.content.capabilityId,
        parserVersion: receipt.content.parserVersion,
        fieldManifestSha256: receipt.content.fieldManifestSha256,
        evaluatedAt: receipt.content.evaluatedAt,
      };
}

function requireProductionExecutionReceipt(
  environment: PersistAflTradeExternalCaptureInput['environment'],
  receipt: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt>
): void {
  if (
    environment !== 'test_fixture' &&
    receipt.content.schemaVersion !== 'afl-trade-external-capture-execution/v2'
  ) {
    throw new AflTradeExternalCaptureRegistryError(
      'INVALID_CAPTURE',
      'Non-fixture capture persistence requires an authenticated execution receipt v2.'
    );
  }
}

async function authenticateExecutionAuthority(
  client: AflOutcomeSqlTransaction,
  receipt: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt>
): Promise<void> {
  if (receipt.content.schemaVersion !== 'afl-trade-external-capture-execution/v2') return;
  const evaluatedAt = receipt.content.gate0aReceipt.content.request.evaluatedAt;
  const decisionId = receipt.content.gate0aReceipt.content.result.decisionId;
  const stored = await client.query<{
    revision: number | string;
    content_json: unknown;
  }>(
    `SELECT head.revision,rights.content_json
       FROM outcome_gate_ledger_head head
       JOIN outcome_source_rights_proposal rights ON rights.rights_artifact_id=$1
       JOIN outcome_gate_decision decision ON decision.decision_id=$2
       JOIN outcome_gate_proposal proposal ON proposal.proposal_id=decision.proposal_id
      WHERE head.singleton_id=1 AND head.revision=$3
        AND decision.gate='gate_0a_permission_to_evaluate'
        AND decision.environment=$4::"OutcomeEnvironment"
        AND decision.decision_key=$5 AND decision.state='approved'
        AND proposal.proposal_json->'content'->'affectedArtifacts' @> $7::jsonb
        AND $8::timestamptz > clock_timestamp()
        AND decision.effective_at <= $6::timestamptz
        AND decision.revalidate_at > $6::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM outcome_gate_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id
        )`,
    [
      receipt.content.sourceRights.rightsArtifactId,
      decisionId,
      receipt.content.ledgerRevision,
      receipt.content.request.environment,
      receipt.content.gate0aReceipt.content.request.decisionKey,
      evaluatedAt,
      canonicalizeAflTradeJson([
        {
          kind: 'source_rights',
          artifactId: receipt.content.sourceRights.rightsArtifactId,
        },
      ]),
      receipt.content.admission.leaseExpiresAt,
    ]
  );
  if (
    stored.rows.length !== 1 ||
    Number(stored.rows[0]?.revision) !== receipt.content.ledgerRevision ||
    !exactJson(stored.rows[0]?.content_json, receipt.content.sourceRights)
  ) {
    throw new AflTradeExternalCaptureRegistryError(
      'INVALID_CAPTURE',
      'Execution receipt is not backed by the exact current durable Gate 0A authority.'
    );
  }
}

function parseInput(input: PersistAflTradeExternalCaptureInput) {
  const primitive = primitiveInputSchema.parse({
    environment: input.environment,
    provider: input.provider,
    competition: input.competition,
    anchorSeasonYear: input.anchorSeasonYear,
    draftPathway: input.draftPathway,
    dataset: input.dataset,
    datasetVersion: input.datasetVersion,
    accessMechanism: input.accessMechanism,
    capabilityId: input.capabilityId,
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
    effectiveAt: input.effectiveAt,
    parserVersion: input.parserVersion,
    fieldManifestSha256: input.fieldManifestSha256,
    eTag: input.eTag,
    lastModified: input.lastModified,
  });
  const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
  const readback = aflTradeArtifactReadbackReceiptSchema.parse(input.artifactReadback);
  const executionReceipt = parseAflTradeExternalCaptureExecutionReceipt(input.executionReceipt);
  requireProductionExecutionReceipt(primitive.environment, executionReceipt);
  const receiptScope = executionScope(executionReceipt);
  if (
    !doAflTradeArtifactRefsExactlyMatch(artifact, readback.content.artifact) ||
    readback.content.artifactClass !== 'raw_source' ||
    readback.content.custodyEnvironment !== primitive.environment ||
    receiptScope.provider !== primitive.provider ||
    receiptScope.capabilityId !== primitive.capabilityId ||
    receiptScope.parserVersion !== primitive.parserVersion ||
    receiptScope.fieldManifestSha256 !== primitive.fieldManifestSha256 ||
    Date.parse(receiptScope.evaluatedAt) < Date.parse(primitive.capturedAt) ||
    (executionReceipt.content.schemaVersion === 'afl-trade-external-capture-execution/v2' &&
      (executionReceipt.content.request.environment !== primitive.environment ||
        executionReceipt.content.request.competition !== primitive.competition ||
        executionReceipt.content.request.anchorSeasonYear !== primitive.anchorSeasonYear ||
        executionReceipt.content.request.draftPathway !== primitive.draftPathway ||
        executionReceipt.content.request.dataset !== primitive.dataset ||
        executionReceipt.content.request.datasetVersion !== primitive.datasetVersion ||
        executionReceipt.content.request.sourceUrl !== primitive.sourceUrl ||
        executionReceipt.content.outcome.observedArtifactId !== artifact.artifactId))
  ) {
    throw new AflTradeExternalCaptureRegistryError(
      'CUSTODY_MISMATCH',
      'Raw artifact readback does not match the capture or custody environment.'
    );
  }
  return { ...primitive, artifact, artifactReadback: readback, executionReceipt };
}

export class PostgresAflTradeExternalCaptureRegistry implements AflTradeExternalCaptureRegistry {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistNotModified(input: {
    environment: PersistAflTradeExternalCaptureInput['environment'];
    provider: PersistAflTradeExternalCaptureInput['provider'];
    dataset: string;
    capabilityId: string;
    sourceUrl: string;
    capturedAt: string;
    eTag: string | null;
    lastModified: string | null;
    priorCaptureId: string;
    priorArtifactId: string;
    executionReceipt: PersistAflTradeExternalCaptureInput['executionReceipt'];
  }) {
    const parsed = z
      .object({
        environment: primitiveInputSchema.shape.environment,
        provider: primitiveInputSchema.shape.provider,
        dataset: primitiveInputSchema.shape.dataset,
        capabilityId: primitiveInputSchema.shape.capabilityId,
        sourceUrl: primitiveInputSchema.shape.sourceUrl,
        capturedAt: primitiveInputSchema.shape.capturedAt,
        eTag: primitiveInputSchema.shape.eTag,
        lastModified: primitiveInputSchema.shape.lastModified,
        priorCaptureId: z.string().regex(/^source-capture:[a-f0-9]{64}$/),
        priorArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/),
        executionReceipt: z.unknown(),
      })
      .strict()
      .parse(input);
    const executionReceipt = parseAflTradeExternalCaptureExecutionReceipt(parsed.executionReceipt);
    requireProductionExecutionReceipt(parsed.environment, executionReceipt);
    const receiptScope = executionScope(executionReceipt);
    if (
      receiptScope.provider !== parsed.provider ||
      receiptScope.capabilityId !== parsed.capabilityId ||
      Date.parse(receiptScope.evaluatedAt) < Date.parse(parsed.capturedAt) ||
      (executionReceipt.content.schemaVersion === 'afl-trade-external-capture-execution/v2' &&
        (executionReceipt.content.request.environment !== parsed.environment ||
          executionReceipt.content.request.dataset !== parsed.dataset ||
          executionReceipt.content.request.sourceUrl !== parsed.sourceUrl ||
          executionReceipt.content.outcome.status !== 'not_modified' ||
          executionReceipt.content.outcome.priorCaptureId !== parsed.priorCaptureId ||
          executionReceipt.content.outcome.observedArtifactId !== parsed.priorArtifactId))
    ) {
      throw new AflTradeExternalCaptureRegistryError(
        'INVALID_CAPTURE',
        'Not-modified execution receipt does not match the capture observation.'
      );
    }
    const content = {
      schemaVersion: 'afl-trade-external-not-modified-attempt/v1',
      ...parsed,
      executionReceipt,
      status: 'not_modified',
    } as const;
    const attemptId = createAflTradeContentAddress('source-capture-attempt', content);
    const attemptJson = canonicalizeAflTradeJson(content);
    const parameters = [
      attemptId,
      parsed.environment,
      parsed.provider,
      parsed.dataset,
      parsed.capabilityId,
      parsed.priorArtifactId,
      parsed.capturedAt,
      attemptJson,
    ] as const;
    return this.client.transaction(async (transaction) => {
      await authenticateExecutionAuthority(transaction, executionReceipt);
      const inserted = await transaction.query(
        `INSERT INTO outcome_source_capture_attempt
          (attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
           started_at,completed_at,attempt_json)
         VALUES ($1,$2::"OutcomeEnvironment",$3,$4,$5,$6,'not_modified',$7,$7,$8::jsonb)
         ON CONFLICT (attempt_id) DO NOTHING`,
        parameters
      );
      const stored = await transaction.query(
        `SELECT attempt_id FROM outcome_source_capture_attempt
          WHERE attempt_id=$1 AND environment=$2::"OutcomeEnvironment" AND provider=$3
            AND dataset=$4 AND capability_id=$5 AND evidence_artifact_id=$6
            AND status='not_modified' AND started_at=$7 AND completed_at=$7
            AND attempt_json=$8::jsonb`,
        parameters
      );
      if (stored.rows.length !== 1) {
        throw new AflTradeExternalCaptureRegistryError(
          'IMMUTABLE_CONFLICT',
          'Not-modified attempt identity already binds different evidence.'
        );
      }
      return { attemptId, idempotentReplay: inserted.rowCount === 0 };
    });
  }

  async loadValidators(input: {
    environment: PersistAflTradeExternalCaptureInput['environment'];
    provider: PersistAflTradeExternalCaptureInput['provider'];
    competition: string;
    anchorSeasonYear: number;
    draftPathway: PersistAflTradeExternalCaptureInput['draftPathway'];
    dataset: string;
    datasetVersion: string;
    capabilityId: string;
    sourceUrl: string;
    parserVersion: string;
    fieldManifestSha256: string;
  }) {
    const request = z
      .object({
        environment: primitiveInputSchema.shape.environment,
        provider: primitiveInputSchema.shape.provider,
        competition: primitiveInputSchema.shape.competition,
        anchorSeasonYear: primitiveInputSchema.shape.anchorSeasonYear,
        draftPathway: primitiveInputSchema.shape.draftPathway,
        dataset: primitiveInputSchema.shape.dataset,
        datasetVersion: primitiveInputSchema.shape.datasetVersion,
        capabilityId: primitiveInputSchema.shape.capabilityId,
        sourceUrl: primitiveInputSchema.shape.sourceUrl,
        parserVersion: primitiveInputSchema.shape.parserVersion,
        fieldManifestSha256: primitiveInputSchema.shape.fieldManifestSha256,
      })
      .strict()
      .parse(input);
    const stored = await this.client.query<{
      capture_id: string;
      source_artifact_id: string;
      manifest_json: unknown;
    }>(
      `SELECT capture.capture_id,capture.source_artifact_id,capture.manifest_json
         FROM outcome_source_capture capture
         JOIN outcome_external_evidence_batch batch ON batch.capture_id=capture.capture_id
        WHERE capture.environment=$1::"OutcomeEnvironment" AND capture.provider=$2
          AND capture.competition=$3 AND capture.anchor_season_year=$4
          AND capture.dataset=$5 AND capture.dataset_version=$6 AND capture.capability_id=$7
          AND capture.manifest_json->>'sourceUrl'=$8
          AND capture.manifest_json->>'parserVersion'=$9
          AND capture.manifest_json->>'fieldManifestSha256'=$10
          AND capture.manifest_json->>'draftPathway' IS NOT DISTINCT FROM $11::text
          AND capture.status='approved'::"OutcomeRecordStatus"
          AND batch.status='finalized' AND batch.finalized_at IS NOT NULL
        ORDER BY capture.captured_at DESC, capture.capture_id DESC
        LIMIT 1`,
      [
        request.environment,
        request.provider,
        request.competition,
        request.anchorSeasonYear,
        request.dataset,
        request.datasetVersion,
        request.capabilityId,
        request.sourceUrl,
        request.parserVersion,
        request.fieldManifestSha256,
        request.draftPathway,
      ]
    );
    if (stored.rows.length === 0) return null;
    const parsed = z
      .object({
        httpValidators: z
          .object({ eTag: z.string().nullable(), lastModified: z.string().nullable() })
          .strict(),
      })
      .passthrough()
      .safeParse(stored.rows[0]?.manifest_json);
    if (!parsed.success) {
      throw new AflTradeExternalCaptureRegistryError(
        'IMMUTABLE_CONFLICT',
        'Latest external capture has malformed conditional-request validators.'
      );
    }
    return {
      ...parsed.data.httpValidators,
      priorCaptureId: stored.rows[0]!.capture_id,
      priorArtifactId: stored.rows[0]!.source_artifact_id,
    };
  }

  async persistCapture(
    unparsedInput: PersistAflTradeExternalCaptureInput
  ): Promise<PersistedAflTradeExternalCapture> {
    const input = parseInput(unparsedInput);
    const attemptContent = {
      schemaVersion: 'afl-trade-external-capture-attempt/v1',
      environment: input.environment,
      provider: input.provider,
      dataset: input.dataset,
      capabilityId: input.capabilityId,
      sourceUrl: input.sourceUrl,
      artifactId: input.artifact.artifactId,
      startedAt: input.capturedAt,
      completedAt: input.capturedAt,
      status: 'captured',
    } as const;
    const attemptId = createAflTradeContentAddress('source-capture-attempt', attemptContent);
    const snapshotContent = {
      schemaVersion: 'afl-trade-external-source-snapshot/v1',
      provider: input.provider,
      dataset: input.dataset,
      datasetVersion: input.datasetVersion,
      capabilityId: input.capabilityId,
      competition: input.competition,
      anchorSeasonYear: input.anchorSeasonYear,
      draftPathway: input.draftPathway,
      sourceUrl: input.sourceUrl,
      sourceArtifactId: input.artifact.artifactId,
      sourceSha256: input.artifact.contentSha256,
      parserVersion: input.parserVersion,
      fieldManifestSha256: input.fieldManifestSha256,
      effectiveAt: input.effectiveAt,
      capturedAt: input.capturedAt,
    } as const;
    const sourceSnapshotId = createAflTradeContentAddress('source-snapshot', snapshotContent);
    const captureId = createAflTradeContentAddress('source-capture', {
      sourceSnapshotId,
      attemptId,
      sourceArtifactId: input.artifact.artifactId,
    });
    const manifest = {
      ...snapshotContent,
      sourceSnapshotId,
      captureId,
      attemptId,
      accessMechanism: input.accessMechanism,
      artifact: input.artifact,
      artifactReadback: input.artifactReadback,
      executionReceipt: input.executionReceipt,
      httpValidators: { eTag: input.eTag, lastModified: input.lastModified },
      publicationEligible: false,
    } as const;
    const custodyJson = canonicalizeAflTradeJson(input.artifactReadback);
    const attemptJson = canonicalizeAflTradeJson(attemptContent);
    const manifestJson = canonicalizeAflTradeJson(manifest);

    return this.client.transaction(async (transaction) => {
      await authenticateExecutionAuthority(transaction, input.executionReceipt);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-source:${sourceSnapshotId}`,
      ]);
      const readback = input.artifactReadback.content;
      const custodyParameters = [
        input.artifact.artifactId,
        input.artifact.contentSha256,
        input.artifact.storageUri,
        input.artifact.mediaType,
        input.artifact.byteLength,
        'raw_source',
        input.environment,
        readback.custodyProfileId,
        input.artifact.createdAt,
        readback.verifiedAt,
        custodyJson,
      ] as const;
      await transaction.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,custody_profile_id,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,$6::"OutcomeArtifactClass",$7::"OutcomeEnvironment",$8,$9,$10,$11::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        custodyParameters
      );
      const custody = await transaction.query<{
        content_sha256: string;
        storage_uri: string;
        media_type: string;
        byte_length: number | string;
        artifact_class: string;
        environment: string;
        custody_profile_id: string | null;
        custody_json: unknown;
      }>(
        `SELECT content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,
                custody_profile_id,custody_json
           FROM outcome_artifact_custody
          WHERE artifact_id=$1 AND content_sha256=$2 AND storage_uri=$3 AND media_type=$4
            AND byte_length=$5 AND artifact_class=$6::"OutcomeArtifactClass"
            AND environment=$7::"OutcomeEnvironment" AND custody_profile_id IS NOT DISTINCT FROM $8
          FOR SHARE`,
        custodyParameters
      );
      const custodyRow = custody.rows[0];
      const storedReadback = aflTradeArtifactReadbackReceiptSchema.safeParse(
        custodyRow?.custody_json
      );
      if (
        custody.rows.length !== 1 ||
        custodyRow?.environment !== input.environment ||
        custodyRow.artifact_class !== 'raw_source' ||
        !storedReadback.success ||
        !sameArtifactContent(storedReadback.data.content.artifact, input.artifact) ||
        storedReadback.data.content.artifactClass !== 'raw_source' ||
        storedReadback.data.content.custodyEnvironment !== input.environment ||
        storedReadback.data.content.custodyProfileId !== readback.custodyProfileId
      ) {
        throw new AflTradeExternalCaptureRegistryError(
          'CUSTODY_MISMATCH',
          'Stored raw custody environment or immutable evidence does not match the capture.'
        );
      }

      const attemptParameters = [
        attemptId,
        input.environment,
        input.provider,
        input.dataset,
        input.capabilityId,
        input.artifact.artifactId,
        input.capturedAt,
        input.capturedAt,
        attemptJson,
      ] as const;
      await transaction.query(
        `INSERT INTO outcome_source_capture_attempt
          (attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
           started_at,completed_at,attempt_json)
         VALUES ($1,$2::"OutcomeEnvironment",$3,$4,$5,$6,'captured',$7,$8,$9::jsonb)
         ON CONFLICT (attempt_id) DO NOTHING`,
        attemptParameters
      );
      const attempt = await transaction.query(
        `SELECT attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
                started_at,completed_at,attempt_json
           FROM outcome_source_capture_attempt
          WHERE attempt_id=$1 AND environment=$2::"OutcomeEnvironment" AND provider=$3
            AND dataset=$4 AND capability_id=$5 AND evidence_artifact_id=$6
            AND status='captured' AND started_at=$7 AND completed_at=$8 AND attempt_json=$9::jsonb
          FOR SHARE`,
        attemptParameters
      );
      if (attempt.rows.length !== 1) {
        throw new AflTradeExternalCaptureRegistryError(
          'IMMUTABLE_CONFLICT',
          'Capture attempt identity already binds different evidence.'
        );
      }

      const captureParameters = [
        captureId,
        attemptId,
        sourceSnapshotId,
        input.artifact.artifactId,
        input.environment,
        input.provider,
        input.dataset,
        input.datasetVersion,
        input.accessMechanism,
        input.capabilityId,
        input.competition,
        input.anchorSeasonYear,
        input.effectiveAt,
        input.capturedAt,
        'approved',
        manifestJson,
      ] as const;
      const inserted = await transaction.query(
        `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
           dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
           captured_at,status,manifest_json)
         VALUES ($1,$2,$3,$4,$5::"OutcomeEnvironment",$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15::"OutcomeRecordStatus",$16::jsonb)
         ON CONFLICT (source_snapshot_id) DO NOTHING`,
        captureParameters
      );
      const capture = await transaction.query<{
        capture_id: string;
        source_artifact_id: string;
        manifest_json: unknown;
      }>(
        `SELECT capture_id,source_artifact_id,manifest_json
           FROM outcome_source_capture
          WHERE capture_id=$1 AND attempt_id=$2 AND source_snapshot_id=$3 AND source_artifact_id=$4
            AND environment=$5::"OutcomeEnvironment" AND provider=$6 AND dataset=$7
            AND dataset_version=$8 AND access_mechanism=$9 AND capability_id=$10
            AND competition=$11 AND anchor_season_year=$12 AND effective_at=$13 AND captured_at=$14
            AND status=$15::"OutcomeRecordStatus" AND manifest_json=$16::jsonb
          FOR SHARE`,
        captureParameters
      );
      if (
        capture.rows.length !== 1 ||
        capture.rows[0]?.capture_id !== captureId ||
        capture.rows[0].source_artifact_id !== input.artifact.artifactId ||
        !exactJson(capture.rows[0].manifest_json, manifest)
      ) {
        throw new AflTradeExternalCaptureRegistryError(
          'IMMUTABLE_CONFLICT',
          'Source snapshot identity already binds a different capture.'
        );
      }
      return {
        captureId,
        artifactId: input.artifact.artifactId,
        idempotentReplay: inserted.rowCount === 0,
      };
    });
  }
}
