import {
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import {
  AflTradeGateLedgerRepositoryError,
  appendNewAflTradeGateDecisionsWithinTransaction,
} from '../../governance/postgresGateDecisionLedgerRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  governedValuationModelQualificationSchema,
  type GovernedValuationModelQualification,
  type GovernedValuationModelQualificationGateRecord,
} from './governedValuationModelQualification';
import {
  createGovernedValuationModelQualificationWork,
  governedValuationModelQualificationWorkSchema,
  type GovernedValuationModelQualificationWork,
} from './governedValuationModelQualificationWork';

interface JsonRow extends Record<string, unknown> {
  value: unknown;
}

interface QualificationRow extends Record<string, unknown> {
  qualification_json: unknown;
  artifact_id: string;
}

export interface GovernedCurrentValuationModelPair {
  readonly scopeKey: string;
  readonly revision: number;
  readonly qualificationId: string;
  readonly playerRunId: string;
  readonly pickRunId: string;
  readonly playerGate3DecisionId: string;
  readonly pickGate3DecisionId: string;
  readonly workId: string;
  readonly advancedAt: string;
}

interface CurrentPairRow extends Record<string, unknown> {
  scope_key: string;
  revision: number;
  qualification_id: string;
  player_run_id: string;
  pick_run_id: string;
  player_gate3_decision_id: string;
  pick_gate3_decision_id: string;
  work_id: string;
  advanced_at: Date | string;
}

export class GovernedValuationModelQualificationRepositoryError extends Error {
  constructor(
    readonly code:
      | 'INTEGRITY_MISMATCH'
      | 'CONFLICTING_REPLAY'
      | 'STALE_GATE_LEDGER'
      | 'STALE_CURRENT_PAIR',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'GovernedValuationModelQualificationRepositoryError';
  }
}

function currentPair(row: CurrentPairRow): GovernedCurrentValuationModelPair {
  return {
    scopeKey: row.scope_key,
    revision: Number(row.revision),
    qualificationId: row.qualification_id,
    playerRunId: row.player_run_id,
    pickRunId: row.pick_run_id,
    playerGate3DecisionId: row.player_gate3_decision_id,
    pickGate3DecisionId: row.pick_gate3_decision_id,
    workId: row.work_id,
    advancedAt: (row.advanced_at instanceof Date
      ? row.advanced_at
      : new Date(row.advanced_at)
    ).toISOString(),
  };
}

async function loadCurrentFrom(
  client: AflOutcomeSqlTransaction,
  scopeKey: string
): Promise<GovernedCurrentValuationModelPair | null> {
  const result = await client.query<CurrentPairRow>(
    `SELECT scope_key,revision,qualification_id,player_run_id,pick_run_id,
       player_gate3_decision_id,pick_gate3_decision_id,work_id,advanced_at
       FROM outcome_current_governed_valuation_model_pair WHERE scope_key=$1`,
    [scopeKey]
  );
  if (result.rows.length > 1) {
    throw new GovernedValuationModelQualificationRepositoryError(
      'INTEGRITY_MISMATCH',
      'Current governed model-pair identity is ambiguous.'
    );
  }
  return result.rows[0] ? currentPair(result.rows[0]) : null;
}

async function retainQualification(
  transaction: AflOutcomeSqlTransaction,
  qualification: GovernedValuationModelQualification,
  artifact: AflTradeArtifactRef
): Promise<'inserted' | 'replayed'> {
  const existing = await transaction.query<QualificationRow>(
    `SELECT qualification_json,artifact_id
       FROM outcome_governed_valuation_model_qualification WHERE qualification_id=$1`,
    [qualification.qualificationId]
  );
  if (existing.rows[0]) {
    if (
      existing.rows.length !== 1 ||
      existing.rows[0].artifact_id !== artifact.artifactId ||
      canonicalizeAflTradeJson(existing.rows[0].qualification_json) !==
        canonicalizeAflTradeJson(qualification)
    ) {
      throw new GovernedValuationModelQualificationRepositoryError(
        'CONFLICTING_REPLAY',
        'Qualification identity already names different retained evidence.'
      );
    }
    return 'replayed';
  }
  const content = qualification.content;
  await transaction.query(
    `INSERT INTO outcome_governed_valuation_model_qualification
      (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
       policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
       player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,content_sha256,
       content_canonical_json,qualification_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      qualification.qualificationId,
      content.scopeKey,
      content.outcome,
      artifact.artifactId,
      content.player.runId,
      content.pick.runId,
      content.policyArtifact.artifactId,
      content.player.criteriaArtifact.artifactId,
      content.pick.criteriaArtifact.artifactId,
      content.player.validationEvidenceArtifact.artifactId,
      content.pick.validationEvidenceArtifact.artifactId,
      content.evaluatedAt,
      qualification.qualificationId.slice('model-qualification:'.length),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(qualification),
    ]
  );
  return 'inserted';
}

async function retainWork(
  transaction: AflOutcomeSqlTransaction,
  work: GovernedValuationModelQualificationWork
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_governed_model_qualification_work
      (work_id,scope_key,qualification_id,player_gate3_decision_id,
       pick_gate3_decision_id,available_at,status,work_json)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb)`,
    [
      work.workId,
      work.content.scopeKey,
      work.content.qualificationId,
      work.content.playerGate3DecisionId,
      work.content.pickGate3DecisionId,
      work.content.availableAt,
      canonicalizeAflTradeJson(work),
    ]
  );
}

async function authenticateArtifacts(input: {
  repository: AflTradeImmutableArtifactRepository;
  maximumBytes: number;
  qualification: GovernedValuationModelQualification;
  qualificationArtifact: AflTradeArtifactRef;
}): Promise<void> {
  const content = input.qualification.content;
  const references = [
    input.qualificationArtifact,
    content.policyArtifact,
    content.player.runArtifact,
    content.player.protocolArtifact,
    content.player.criteriaArtifact,
    content.player.validationEvidenceArtifact,
    content.pick.runArtifact,
    content.pick.protocolArtifact,
    content.pick.criteriaArtifact,
    content.pick.validationEvidenceArtifact,
  ];
  for (const reference of references) {
    const loaded = await input.repository.loadExact(reference, input.maximumBytes);
    if (
      loaded === null ||
      canonicalizeAflTradeJson(loaded.reference) !== canonicalizeAflTradeJson(reference) ||
      !doesAflTradeArtifactRefMatchBytes(reference, loaded.bytes)
    ) {
      throw new GovernedValuationModelQualificationRepositoryError(
        'INTEGRITY_MISMATCH',
        `Qualification artifact custody failed for ${reference.artifactId}.`
      );
    }
  }
}

export type GovernedValuationModelQualificationRegistrationResult =
  | Readonly<{
      status: 'failed_retained';
      qualification: GovernedValuationModelQualification;
      current: GovernedCurrentValuationModelPair | null;
      idempotentReplay: boolean;
    }>
  | Readonly<{
      status: 'advanced';
      qualification: GovernedValuationModelQualification;
      current: GovernedCurrentValuationModelPair;
      work: GovernedValuationModelQualificationWork;
      idempotentReplay: boolean;
    }>;

export class PostgresGovernedValuationModelQualificationRepository {
  constructor(
    private readonly dependencies: {
      readonly client: AflOutcomeSqlClient;
      readonly artifactRepository: AflTradeImmutableArtifactRepository;
      readonly maximumArtifactBytes: number;
    }
  ) {
    if (
      dependencies.artifactRepository.artifactClass !== 'derived_private' ||
      !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
      dependencies.maximumArtifactBytes <= 0
    ) {
      throw new TypeError('Model qualification requires bounded private artifact custody.');
    }
  }

  async register(input: {
    readonly qualification: GovernedValuationModelQualification;
    readonly qualificationArtifact: AflTradeArtifactRef;
    readonly expectedGateLedgerRevision: number;
    readonly expectedCurrentRevision: number;
    readonly gateRecords?: readonly [
      GovernedValuationModelQualificationGateRecord,
      GovernedValuationModelQualificationGateRecord,
    ];
  }): Promise<GovernedValuationModelQualificationRegistrationResult> {
    const qualification = governedValuationModelQualificationSchema.parse(input.qualification);
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(input.qualificationArtifact, qualification) ||
      input.qualificationArtifact.createdAt !== qualification.content.evaluatedAt
    ) {
      throw new GovernedValuationModelQualificationRepositoryError(
        'INTEGRITY_MISMATCH',
        'Qualification artifact does not authenticate the exact evaluated record.'
      );
    }
    await authenticateArtifacts({
      repository: this.dependencies.artifactRepository,
      maximumBytes: this.dependencies.maximumArtifactBytes,
      qualification,
      qualificationArtifact: input.qualificationArtifact,
    });
    return this.dependencies.client.transaction(async (transaction) => {
      const replay =
        (await retainQualification(transaction, qualification, input.qualificationArtifact)) ===
        'replayed';
      const existingCurrent = await loadCurrentFrom(transaction, qualification.content.scopeKey);
      if (qualification.content.outcome === 'failed') {
        return {
          status: 'failed_retained',
          qualification,
          current: existingCurrent,
          idempotentReplay: replay,
        };
      }
      if (!input.gateRecords) {
        throw new GovernedValuationModelQualificationRepositoryError(
          'INTEGRITY_MISMATCH',
          'A passing qualification requires both linked Gate 3 records.'
        );
      }
      if (replay) {
        if (existingCurrent?.qualificationId !== qualification.qualificationId) {
          throw new GovernedValuationModelQualificationRepositoryError(
            'STALE_CURRENT_PAIR',
            'A retained qualification replay cannot replace a newer current pair.'
          );
        }
        const workResult = await transaction.query<JsonRow>(
          `SELECT work_json AS value FROM outcome_governed_model_qualification_work
           WHERE work_id=$1`,
          [existingCurrent.workId]
        );
        const work = governedValuationModelQualificationWorkSchema.parse(workResult.rows[0]?.value);
        return { status: 'advanced', qualification, current: existingCurrent, work, idempotentReplay: true };
      }
      const expectedRunIds = [
        qualification.content.player.runId,
        qualification.content.pick.runId,
      ] as const;
      for (const [index, record] of input.gateRecords.entries()) {
        const decision = record.decision.content;
        if (
          decision.authorityKind !== 'automated_validation_record' ||
          decision.scope.scopeKey !== qualification.content.scopeKey ||
          !decision.authorityEvidenceIds.includes(input.qualificationArtifact.artifactId) ||
          !decision.affectedArtifacts.some(
            ({ kind, artifactId }) =>
              kind === 'model_run' && artifactId === expectedRunIds[index]
          ) ||
          !decision.affectedArtifacts.some(
            ({ kind, artifactId }) =>
              kind === 'model_qualification' && artifactId === qualification.qualificationId
          )
        ) {
          throw new GovernedValuationModelQualificationRepositoryError(
            'INTEGRITY_MISMATCH',
            'Gate 3 records do not cite the exact role-specific run and shared qualification.'
          );
        }
      }
      const authorityEffectiveAt = new Date(
        Math.max(
          ...input.gateRecords.map(({ decision }) => {
            if (decision.content.effectiveAt === null) {
              throw new GovernedValuationModelQualificationRepositoryError(
                'INTEGRITY_MISMATCH',
                'Automated Gate 3 authority must have an effective time.'
              );
            }
            return Date.parse(decision.content.effectiveAt);
          })
        )
      ).toISOString();
      try {
        await appendNewAflTradeGateDecisionsWithinTransaction(transaction, {
          expectedRevision: input.expectedGateLedgerRevision,
          scopeKey: qualification.content.scopeKey,
          qualificationId: qualification.qualificationId,
          qualificationArtifactId: input.qualificationArtifact.artifactId,
          playerRunId: qualification.content.player.runId,
          pickRunId: qualification.content.pick.runId,
          records: input.gateRecords,
          updatedAt: authorityEffectiveAt,
        });
      } catch (cause) {
        if (
          cause instanceof AflTradeGateLedgerRepositoryError &&
          cause.code === 'STALE_REVISION'
        ) {
          throw new GovernedValuationModelQualificationRepositoryError(
            'STALE_GATE_LEDGER',
            'Gate ledger changed before the qualified pair could commit.',
            { cause }
          );
        }
        throw cause;
      }
      const work = createGovernedValuationModelQualificationWork({
        qualification,
        playerGate3DecisionId: input.gateRecords[0].decision.decisionId,
        pickGate3DecisionId: input.gateRecords[1].decision.decisionId,
        availableAt: authorityEffectiveAt,
      });
      await retainWork(transaction, work);
      let revisionResult;
      try {
        revisionResult = await transaction.query<{ revision: number }>(
          `SELECT advance_outcome_current_governed_valuation_model_pair(
             $1,$2,$3,$4,$5,$6,$7) AS revision`,
          [
            qualification.content.scopeKey,
            qualification.qualificationId,
            input.gateRecords[0].decision.decisionId,
            input.gateRecords[1].decision.decisionId,
            work.workId,
            input.expectedCurrentRevision,
            authorityEffectiveAt,
          ]
        );
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !cause.message.includes('Stale current model-pair revision')
        ) {
          throw cause;
        }
        throw new GovernedValuationModelQualificationRepositoryError(
          'STALE_CURRENT_PAIR',
          'Current model pair changed before the qualification could advance.',
          { cause }
        );
      }
      const current = await loadCurrentFrom(transaction, qualification.content.scopeKey);
      if (
        !current ||
        current.revision !== Number(revisionResult.rows[0]?.revision) ||
        current.qualificationId !== qualification.qualificationId
      ) {
        throw new GovernedValuationModelQualificationRepositoryError(
          'INTEGRITY_MISMATCH',
          'Advanced current model pair failed exact readback.'
        );
      }
      return { status: 'advanced', qualification, current, work, idempotentReplay: false };
    });
  }

  loadCurrent(scopeKey: string): Promise<GovernedCurrentValuationModelPair | null> {
    return loadCurrentFrom(this.dependencies.client, scopeKey);
  }
}
