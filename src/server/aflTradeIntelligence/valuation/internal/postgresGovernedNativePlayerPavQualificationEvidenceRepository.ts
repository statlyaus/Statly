import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import { aflTradeNativePavPreFinalConfigurationSchema } from '../../modeling/admittedPlayerPavPreFinalEvaluation';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import { loadGovernedNativeComponentValidationReport } from './governedNativeComponentExecution';
import {
  deriveGovernedNativePlayerPavQualificationEvidence,
  governedNativePlayerPavQualificationCriteriaSchema,
  governedNativePlayerPavQualificationEvidenceSchema,
} from './governedNativePlayerPavQualification';
import { PostgresGovernedValuationComponentRunRepository } from './postgresGovernedValuationComponentRunRepository';

type QualificationEvidence = ReturnType<
  typeof governedNativePlayerPavQualificationEvidenceSchema.parse
>;

interface EvidenceRow extends Record<string, unknown> {
  evidence_id: string;
  run_id: string;
  final_evaluation_id: string;
  final_evidence_artifact_id: string;
  criteria_id: string;
  criteria_artifact_id: string;
  calibration_configuration_artifact_id: string;
  evidence_artifact_id: string;
  support_status: string;
  assessment_status: string;
  qualification_granted: boolean;
  content_sha256: string;
  content_canonical_json: string;
  evidence_json: unknown;
  recorded_at: Date | string;
  evidence_artifact_content_sha256: string;
  evidence_artifact_storage_uri: string;
  evidence_artifact_media_type: string;
  evidence_artifact_byte_length: number | string | bigint;
  evidence_artifact_created_at: Date | string;
}

export interface RetainedGovernedNativePlayerPavQualificationEvidence {
  readonly runId: string;
  readonly evidence: QualificationEvidence;
  readonly evidenceArtifact: AflTradeArtifactRef;
  readonly recordedAt: string;
  readonly idempotentReplay: boolean;
}

export class GovernedNativePlayerPavQualificationEvidenceRepositoryError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INTEGRITY_MISMATCH' | 'CONFLICTING_REPLAY',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'GovernedNativePlayerPavQualificationEvidenceRepositoryError';
  }
}

type SqlQueryClient = Pick<AflOutcomeSqlClient, 'query'>;

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
      'INTEGRITY_MISMATCH',
      'Native player-PAV qualification time is malformed.'
    );
  }
  return parsed.toISOString();
}

async function loadExactJson(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumBytes: number;
  readonly reference: AflTradeArtifactRef;
}): Promise<unknown> {
  const retained = await input.repository.loadExact(input.reference, input.maximumBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, input.reference) ||
    !doesAflTradeArtifactRefMatchBytes(retained.reference, retained.bytes)
  ) {
    throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
      'INTEGRITY_MISMATCH',
      `Native player-PAV qualification artifact custody failed for ${input.reference.artifactId}.`
    );
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(retained.bytes));
  } catch (cause) {
    throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
      'INTEGRITY_MISMATCH',
      'Native player-PAV qualification artifact is not canonical JSON.',
      { cause }
    );
  }
}

async function requireExactSqlCustody(
  client: SqlQueryClient,
  references: readonly AflTradeArtifactRef[]
): Promise<void> {
  const result = await client.query<{
    artifact_id: string;
    content_sha256: string;
    storage_uri: string;
    media_type: string;
    byte_length: number | string | bigint;
    artifact_class: string;
    environment: string;
    created_at: Date | string;
  }>(
    `SELECT artifact_id,content_sha256,storage_uri,media_type,byte_length,
            artifact_class::text,environment::text,created_at
       FROM outcome_artifact_custody WHERE artifact_id=ANY($1::text[])`,
    [references.map(({ artifactId }) => artifactId)]
  );
  const byId = new Map(result.rows.map((row) => [row.artifact_id, row]));
  for (const reference of references) {
    const row = byId.get(reference.artifactId);
    if (
      row === undefined ||
      row.content_sha256 !== reference.contentSha256 ||
      row.storage_uri !== reference.storageUri ||
      row.media_type !== reference.mediaType ||
      Number(row.byte_length) !== reference.byteLength ||
      row.artifact_class !== 'derived_private' ||
      row.environment !== 'non_production' ||
      instant(row.created_at) !== reference.createdAt
    ) {
      throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
        'INTEGRITY_MISMATCH',
        `Native player-PAV SQL custody differs for ${reference.artifactId}.`
      );
    }
  }
}

async function rederive(input: {
  readonly componentRunId: string;
  readonly criteriaArtifact: AflTradeArtifactRef;
  readonly componentRepository: PostgresGovernedValuationComponentRunRepository;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}) {
  const retainedComponent = await input.componentRepository.loadExact(input.componentRunId);
  const report = await loadGovernedNativeComponentValidationReport({
    manifest: retainedComponent.manifest,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  if (
    report.kind !== 'player_pav_final_evidence' ||
    report.execution.content.schemaVersion !== 'afl-trade-model-run/v5' ||
    report.finalEvidence.content.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2'
  ) {
    throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
      'INTEGRITY_MISMATCH',
      'Native player-PAV qualification requires an authenticated V5/V2 component run.'
    );
  }
  const criteria = governedNativePlayerPavQualificationCriteriaSchema.parse(
    await loadExactJson({
      repository: input.artifactRepository,
      maximumBytes: input.maximumArtifactBytes,
      reference: input.criteriaArtifact,
    })
  );
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.criteriaArtifact, criteria)) {
    throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
      'INTEGRITY_MISMATCH',
      'Native player-PAV qualification criteria bytes differ from their exact reference.'
    );
  }
  const calibrationConfigurationArtifact =
    report.finalEvidence.content.calibrationConfigurationArtifact;
  const calibrationConfiguration = aflTradeNativePavPreFinalConfigurationSchema.parse(
    await loadExactJson({
      repository: input.artifactRepository,
      maximumBytes: input.maximumArtifactBytes,
      reference: calibrationConfigurationArtifact,
    })
  );
  const evidence = deriveGovernedNativePlayerPavQualificationEvidence({
    finalEvidence: report.finalEvidence,
    finalEvidenceArtifact: report.finalEvidenceArtifact,
    calibrationConfiguration,
    calibrationConfigurationArtifact,
    criteria,
    criteriaArtifact: input.criteriaArtifact,
  });
  return { report, criteria, calibrationConfigurationArtifact, evidence };
}

async function loadRow(client: SqlQueryClient, evidenceId: string): Promise<EvidenceRow | null> {
  const result = await client.query<EvidenceRow>(
    `SELECT evidence.evidence_id,evidence.run_id,evidence.final_evaluation_id,
            evidence.final_evidence_artifact_id,evidence.criteria_id,
            evidence.criteria_artifact_id,evidence.calibration_configuration_artifact_id,
            evidence.evidence_artifact_id,evidence.support_status,evidence.assessment_status,
            evidence.qualification_granted,evidence.content_sha256,
            evidence.content_canonical_json,evidence.evidence_json,evidence.recorded_at,
            artifact.content_sha256 AS evidence_artifact_content_sha256,
            artifact.storage_uri AS evidence_artifact_storage_uri,
            artifact.media_type AS evidence_artifact_media_type,
            artifact.byte_length AS evidence_artifact_byte_length,
            artifact.created_at AS evidence_artifact_created_at
       FROM outcome_governed_native_player_pav_qualification_evidence evidence
       JOIN outcome_artifact_custody artifact
         ON artifact.artifact_id=evidence.evidence_artifact_id
      WHERE evidence.evidence_id=$1`,
    [evidenceId]
  );
  if (result.rows.length > 1) {
    throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
      'INTEGRITY_MISMATCH',
      'Native player-PAV qualification evidence identity is ambiguous.'
    );
  }
  return result.rows[0] ?? null;
}

export class PostgresGovernedNativePlayerPavQualificationEvidenceRepository {
  private readonly componentRepository: PostgresGovernedValuationComponentRunRepository;

  constructor(
    private readonly dependencies: {
      readonly client: AflOutcomeSqlClient;
      readonly artifactRepository: AflTradeImmutableArtifactRepository;
      readonly maximumArtifactBytes: number;
      readonly retainArtifact: (input: {
        readonly document: unknown;
        readonly createdAt: string;
      }) => Promise<AflTradeArtifactRef>;
    }
  ) {
    if (
      dependencies.artifactRepository.artifactClass !== 'derived_private' ||
      !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
      dependencies.maximumArtifactBytes <= 0
    ) {
      throw new TypeError('Native player-PAV qualification requires bounded private custody.');
    }
    this.componentRepository = new PostgresGovernedValuationComponentRunRepository(dependencies);
  }

  private async loadExactFrom(
    client: SqlQueryClient,
    evidenceId: string
  ): Promise<RetainedGovernedNativePlayerPavQualificationEvidence> {
    const row = await loadRow(client, evidenceId);
    if (row === null) {
      throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
        'NOT_FOUND',
        'Native player-PAV qualification evidence was not found.'
      );
    }
    const evidence = governedNativePlayerPavQualificationEvidenceSchema.parse(row.evidence_json);
    const evidenceArtifact = aflTradeArtifactRefSchema.parse({
      artifactId: row.evidence_artifact_id,
      contentSha256: row.evidence_artifact_content_sha256,
      storageUri: row.evidence_artifact_storage_uri,
      mediaType: row.evidence_artifact_media_type,
      byteLength: Number(row.evidence_artifact_byte_length),
      createdAt: instant(row.evidence_artifact_created_at),
    });
    const recordedAt = instant(row.recorded_at);
    const derived = await rederive({
      componentRunId: row.run_id,
      criteriaArtifact: evidence.content.criteriaArtifact,
      componentRepository: this.componentRepository,
      artifactRepository: this.dependencies.artifactRepository,
      maximumArtifactBytes: this.dependencies.maximumArtifactBytes,
    });
    if (
      row.evidence_id !== evidence.evidenceId ||
      row.final_evaluation_id !== evidence.content.finalEvaluationId ||
      row.final_evidence_artifact_id !== evidence.content.finalEvidenceArtifact.artifactId ||
      row.criteria_id !== evidence.content.criteriaId ||
      row.criteria_artifact_id !== evidence.content.criteriaArtifact.artifactId ||
      row.calibration_configuration_artifact_id !==
        evidence.content.calibrationConfigurationArtifact.artifactId ||
      row.support_status !== evidence.content.support.status ||
      row.assessment_status !== evidence.content.assessment.status ||
      row.qualification_granted !== false ||
      row.content_sha256 !==
        evidence.evidenceId.slice('native-player-pav-qualification-evidence:'.length) ||
      row.content_canonical_json !== canonicalizeAflTradeJson(evidence.content) ||
      !doesAflTradeArtifactRefMatchCanonicalJson(evidenceArtifact, evidence) ||
      evidenceArtifact.createdAt !== recordedAt ||
      canonicalizeAflTradeJson(derived.evidence) !== canonicalizeAflTradeJson(evidence) ||
      !doAflTradeArtifactRefsExactlyMatch(
        derived.report.finalEvidenceArtifact,
        evidence.content.finalEvidenceArtifact
      ) ||
      derived.criteria.criteriaId !== evidence.content.criteriaId
    ) {
      throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
        'INTEGRITY_MISMATCH',
        'Retained native player-PAV qualification evidence failed exact readback.'
      );
    }
    await requireExactSqlCustody(client, [
      evidence.content.finalEvidenceArtifact,
      evidence.content.criteriaArtifact,
      evidence.content.calibrationConfigurationArtifact,
      evidenceArtifact,
    ]);
    await loadExactJson({
      repository: this.dependencies.artifactRepository,
      maximumBytes: this.dependencies.maximumArtifactBytes,
      reference: evidenceArtifact,
    });
    return {
      runId: row.run_id,
      evidence,
      evidenceArtifact,
      recordedAt,
      idempotentReplay: true,
    };
  }

  loadExact(evidenceId: string): Promise<RetainedGovernedNativePlayerPavQualificationEvidence> {
    return this.loadExactFrom(this.dependencies.client, evidenceId);
  }

  async retain(input: {
    readonly componentRunId: string;
    readonly criteriaArtifact: AflTradeArtifactRef;
    readonly recordedAt: string;
  }): Promise<RetainedGovernedNativePlayerPavQualificationEvidence> {
    const criteriaArtifact = aflTradeArtifactRefSchema.parse(input.criteriaArtifact);
    const recordedAt = instant(input.recordedAt);
    const derived = await rederive({
      componentRunId: input.componentRunId,
      criteriaArtifact,
      componentRepository: this.componentRepository,
      artifactRepository: this.dependencies.artifactRepository,
      maximumArtifactBytes: this.dependencies.maximumArtifactBytes,
    });
    if (
      [
        derived.report.finalEvidenceArtifact.createdAt,
        criteriaArtifact.createdAt,
        derived.calibrationConfigurationArtifact.createdAt,
      ].some((createdAt) => Date.parse(createdAt) > Date.parse(recordedAt))
    ) {
      throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
        'INTEGRITY_MISMATCH',
        'Native player-PAV qualification cannot predate its exact parents.'
      );
    }
    const existing = await this.dependencies.client.query<{ evidence_id: string }>(
      `SELECT evidence_id
         FROM outcome_governed_native_player_pav_qualification_evidence
        WHERE run_id=$1 AND criteria_id=$2`,
      [input.componentRunId, derived.criteria.criteriaId]
    );
    if (existing.rows[0]) {
      if (
        existing.rows.length !== 1 ||
        existing.rows[0].evidence_id !== derived.evidence.evidenceId
      ) {
        throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
          'CONFLICTING_REPLAY',
          'Native player-PAV qualification run and criteria already name different evidence.'
        );
      }
      const replay = await this.loadExact(derived.evidence.evidenceId);
      return { ...replay, idempotentReplay: true };
    }
    const parentArtifacts = [
      derived.report.finalEvidenceArtifact,
      criteriaArtifact,
      derived.calibrationConfigurationArtifact,
    ];
    await requireExactSqlCustody(this.dependencies.client, parentArtifacts);
    const evidenceArtifact = await this.dependencies.retainArtifact({
      document: derived.evidence,
      createdAt: recordedAt,
    });
    if (
      Date.parse(evidenceArtifact.createdAt) > Date.parse(recordedAt) ||
      parentArtifacts.some(
        ({ createdAt }) => Date.parse(createdAt) > Date.parse(evidenceArtifact.createdAt)
      ) ||
      !doesAflTradeArtifactRefMatchCanonicalJson(evidenceArtifact, derived.evidence)
    ) {
      throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
        'INTEGRITY_MISMATCH',
        'Retained native player-PAV qualification artifact differs from derived evidence.'
      );
    }
    await requireExactSqlCustody(this.dependencies.client, [evidenceArtifact]);
    await loadExactJson({
      repository: this.dependencies.artifactRepository,
      maximumBytes: this.dependencies.maximumArtifactBytes,
      reference: evidenceArtifact,
    });
    const outcome = await this.dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `native-player-pav-qualification:${input.componentRunId}:${derived.criteria.criteriaId}`,
      ]);
      const byRunCriteria = await transaction.query<{ evidence_id: string }>(
        `SELECT evidence_id
           FROM outcome_governed_native_player_pav_qualification_evidence
          WHERE run_id=$1 AND criteria_id=$2`,
        [input.componentRunId, derived.criteria.criteriaId]
      );
      if (byRunCriteria.rows[0]) {
        if (
          byRunCriteria.rows.length !== 1 ||
          byRunCriteria.rows[0].evidence_id !== derived.evidence.evidenceId
        ) {
          throw new GovernedNativePlayerPavQualificationEvidenceRepositoryError(
            'CONFLICTING_REPLAY',
            'Native player-PAV qualification run and criteria already name different evidence.'
          );
        }
        return 'replayed' as const;
      }
      const content = derived.evidence.content;
      await transaction.query(
        `INSERT INTO outcome_governed_native_player_pav_qualification_evidence
          (evidence_id,run_id,final_evaluation_id,final_evidence_artifact_id,
           criteria_id,criteria_artifact_id,calibration_configuration_artifact_id,
           evidence_artifact_id,support_status,assessment_status,qualification_granted,
           content_sha256,content_canonical_json,evidence_json,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$13::jsonb,$14)`,
        [
          derived.evidence.evidenceId,
          input.componentRunId,
          content.finalEvaluationId,
          content.finalEvidenceArtifact.artifactId,
          content.criteriaId,
          content.criteriaArtifact.artifactId,
          content.calibrationConfigurationArtifact.artifactId,
          evidenceArtifact.artifactId,
          content.support.status,
          content.assessment.status,
          derived.evidence.evidenceId.slice('native-player-pav-qualification-evidence:'.length),
          canonicalizeAflTradeJson(derived.evidence.content),
          canonicalizeAflTradeJson(derived.evidence),
          evidenceArtifact.createdAt,
        ]
      );
      return 'inserted' as const;
    });
    const retained = await this.loadExact(derived.evidence.evidenceId);
    return { ...retained, idempotentReplay: outcome === 'replayed' };
  }
}
