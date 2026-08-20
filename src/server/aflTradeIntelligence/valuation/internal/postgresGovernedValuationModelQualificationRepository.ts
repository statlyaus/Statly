import {
  doAflTradeArtifactRefsExactlyMatch,
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
  deriveGovernedPickModelQualificationEvidence,
  deriveGovernedPlayerModelQualificationEvidence,
  governedValuationModelQualificationSchema,
  type GovernedValuationModelQualification,
  type GovernedValuationModelQualificationGateRecord,
} from './governedValuationModelQualification';
import { governedValuationComponentRunManifestSchema } from './governedValuationComponentRunManifest';
import {
  loadGovernedNativeComponentValidationReport,
  type GovernedNativeComponentValidationReport,
} from './governedNativeComponentExecution';
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
      'INTEGRITY_MISMATCH' | 'CONFLICTING_REPLAY' | 'STALE_GATE_LEDGER' | 'STALE_CURRENT_PAIR',
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

interface NativeEvidenceRow extends Record<string, unknown> {
  run_id: string;
  role: string;
  native_execution_artifact_id: string;
  validation_report_id: string;
  validation_report_artifact_id: string | null;
  native_execution_json: unknown;
  validation_report_json: unknown;
  recorded_at: Date | string;
}

async function retainNativeValidationEvidence(
  transaction: AflOutcomeSqlTransaction,
  qualification: GovernedValuationModelQualification,
  evidence: AuthenticatedQualificationArtifacts
): Promise<void> {
  const entries = [
    {
      runId: qualification.content.player.runId,
      role: evidence.player.kind,
      validationReportId: evidence.player.validationReport.validationReportId,
      validationReportArtifactId: evidence.player.validationReportArtifact.artifactId,
      nativeExecution: evidence.player.execution,
      validationReport: evidence.player.validationReport,
    },
    {
      runId: qualification.content.pick.runId,
      role: evidence.pick.kind,
      validationReportId: evidence.pick.validationReport.validationReportId,
      validationReportArtifactId: null,
      nativeExecution: evidence.pick.execution,
      validationReport: evidence.pick.validationReport,
    },
  ] as const;
  for (const entry of entries) {
    await transaction.query(
      `INSERT INTO outcome_governed_component_validation_evidence
        (run_id,role,native_execution_artifact_id,validation_report_id,
         validation_report_artifact_id,native_execution_json,validation_report_json,recorded_at)
       SELECT run_id,$2,native_execution_artifact_id,$3,$4,$5::jsonb,$6::jsonb,$7
         FROM outcome_governed_valuation_component_run WHERE run_id=$1
       ON CONFLICT (run_id) DO NOTHING`,
      [
        entry.runId,
        entry.role,
        entry.validationReportId,
        entry.validationReportArtifactId,
        canonicalizeAflTradeJson(entry.nativeExecution),
        canonicalizeAflTradeJson(entry.validationReport),
        qualification.content.evaluatedAt,
      ]
    );
    const retained = await transaction.query<NativeEvidenceRow>(
      `SELECT run_id,role,native_execution_artifact_id,validation_report_id,
          validation_report_artifact_id,native_execution_json,validation_report_json,recorded_at
         FROM outcome_governed_component_validation_evidence WHERE run_id=$1`,
      [entry.runId]
    );
    const row = retained.rows[0];
    if (
      retained.rows.length !== 1 ||
      row === undefined ||
      row.role !== entry.role ||
      row.validation_report_id !== entry.validationReportId ||
      row.validation_report_artifact_id !== entry.validationReportArtifactId ||
      canonicalizeAflTradeJson(row.native_execution_json) !==
        canonicalizeAflTradeJson(entry.nativeExecution) ||
      canonicalizeAflTradeJson(row.validation_report_json) !==
        canonicalizeAflTradeJson(entry.validationReport) ||
      Date.parse(new Date(row.recorded_at).toISOString()) >
        Date.parse(qualification.content.evaluatedAt)
    ) {
      throw new GovernedValuationModelQualificationRepositoryError(
        'CONFLICTING_REPLAY',
        'Component validation evidence conflicts with retained native authority.'
      );
    }
  }
}

type PlayerNativeEvidence = Extract<
  GovernedNativeComponentValidationReport,
  { kind: 'player_contribution_and_availability' }
>;
type PickNativeEvidence = Extract<
  GovernedNativeComponentValidationReport,
  { kind: 'draft_pick_and_future_pick_distribution' }
>;

interface AuthenticatedQualificationArtifacts {
  readonly player: PlayerNativeEvidence;
  readonly pick: PickNativeEvidence;
}

async function authenticateArtifacts(input: {
  repository: AflTradeImmutableArtifactRepository;
  maximumBytes: number;
  qualification: GovernedValuationModelQualification;
  qualificationArtifact: AflTradeArtifactRef;
}): Promise<AuthenticatedQualificationArtifacts> {
  const content = input.qualification.content;
  const documents = new Map<string, unknown>();
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
    if (
      reference.artifactId === content.player.runArtifact.artifactId ||
      reference.artifactId === content.pick.runArtifact.artifactId
    ) {
      try {
        documents.set(reference.artifactId, JSON.parse(new TextDecoder().decode(loaded.bytes)));
      } catch {
        throw new GovernedValuationModelQualificationRepositoryError(
          'INTEGRITY_MISMATCH',
          `Qualification component run is not canonical JSON: ${reference.artifactId}.`
        );
      }
    }
  }
  const playerRun = governedValuationComponentRunManifestSchema.safeParse(
    documents.get(content.player.runArtifact.artifactId)
  );
  const pickRun = governedValuationComponentRunManifestSchema.safeParse(
    documents.get(content.pick.runArtifact.artifactId)
  );
  if (
    !playerRun.success ||
    !pickRun.success ||
    playerRun.data.runId !== content.player.runId ||
    playerRun.data.content.role !== content.player.role ||
    playerRun.data.content.protocolId !== content.player.protocolId ||
    !doAflTradeArtifactRefsExactlyMatch(
      playerRun.data.content.protocolArtifact,
      content.player.protocolArtifact
    ) ||
    pickRun.data.runId !== content.pick.runId ||
    pickRun.data.content.role !== content.pick.role ||
    pickRun.data.content.protocolId !== content.pick.protocolId ||
    !doAflTradeArtifactRefsExactlyMatch(
      pickRun.data.content.protocolArtifact,
      content.pick.protocolArtifact
    )
  ) {
    throw new GovernedValuationModelQualificationRepositoryError(
      'INTEGRITY_MISMATCH',
      'Qualification component-run evidence does not match the selected role and protocol.'
    );
  }
  try {
    const [playerNative, pickNative] = await Promise.all([
      loadGovernedNativeComponentValidationReport({
        manifest: playerRun.data,
        artifactRepository: input.repository,
        maximumArtifactBytes: input.maximumBytes,
      }),
      loadGovernedNativeComponentValidationReport({
        manifest: pickRun.data,
        artifactRepository: input.repository,
        maximumArtifactBytes: input.maximumBytes,
      }),
    ]);
    if (
      playerNative.kind !== 'player_contribution_and_availability' ||
      pickNative.kind !== 'draft_pick_and_future_pick_distribution' ||
      canonicalizeAflTradeJson(
        deriveGovernedPlayerModelQualificationEvidence(playerNative.validationReport)
      ) !== canonicalizeAflTradeJson(content.player.validationEvidence) ||
      canonicalizeAflTradeJson(
        deriveGovernedPickModelQualificationEvidence(pickNative.validationReport)
      ) !== canonicalizeAflTradeJson(content.pick.validationEvidence)
    ) {
      throw new GovernedValuationModelQualificationRepositoryError(
        'INTEGRITY_MISMATCH',
        'Qualification evidence does not equal the selected native validation reports.'
      );
    }
    return { player: playerNative, pick: pickNative };
  } catch (cause) {
    if (cause instanceof GovernedValuationModelQualificationRepositoryError) throw cause;
    throw new GovernedValuationModelQualificationRepositoryError(
      'INTEGRITY_MISMATCH',
      'Qualification native validation evidence failed authentication.',
      { cause }
    );
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

interface QualificationRegistrationInput {
  readonly qualification: GovernedValuationModelQualification;
  readonly qualificationArtifact: AflTradeArtifactRef;
  readonly expectedGateLedgerRevision: number;
  readonly expectedCurrentRevision: number;
  readonly gateRecords?: readonly [
    GovernedValuationModelQualificationGateRecord,
    GovernedValuationModelQualificationGateRecord,
  ];
}

function validateQualificationGateRecords(
  qualification: GovernedValuationModelQualification,
  qualificationArtifact: AflTradeArtifactRef,
  gateRecords: readonly [
    GovernedValuationModelQualificationGateRecord,
    GovernedValuationModelQualificationGateRecord,
  ]
): string {
  const expectedRunIds = [qualification.content.player.runId, qualification.content.pick.runId];
  const qualificationRetainedAt = Date.parse(qualificationArtifact.createdAt);
  const qualificationEvaluatedAt = Date.parse(qualification.content.evaluatedAt);
  for (const [index, record] of gateRecords.entries()) {
    const decision = record.decision.content;
    const proposedAt = Date.parse(record.proposal.content.proposedAt);
    const decidedAt = decision.decidedAt === null ? Number.NaN : Date.parse(decision.decidedAt);
    const effectiveAt =
      decision.effectiveAt === null ? Number.NaN : Date.parse(decision.effectiveAt);
    if (
      decision.authorityKind !== 'automated_validation_record' ||
      decision.scope.scopeKey !== qualification.content.scopeKey ||
      [proposedAt, decidedAt, effectiveAt].some(
        (instant) =>
          !Number.isFinite(instant) ||
          instant < qualificationEvaluatedAt ||
          instant < qualificationRetainedAt
      ) ||
      !decision.authorityEvidenceIds.includes(qualificationArtifact.artifactId) ||
      !decision.affectedArtifacts.some(
        ({ kind, artifactId }) => kind === 'model_run' && artifactId === expectedRunIds[index]
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
  return new Date(
    Math.max(...gateRecords.map(({ decision }) => Date.parse(decision.content.effectiveAt!)))
  ).toISOString();
}

async function appendQualificationGateRecords(
  transaction: AflOutcomeSqlTransaction,
  input: QualificationRegistrationInput & {
    readonly gateRecords: readonly [
      GovernedValuationModelQualificationGateRecord,
      GovernedValuationModelQualificationGateRecord,
    ];
  },
  authorityEffectiveAt: string
): Promise<void> {
  try {
    await appendNewAflTradeGateDecisionsWithinTransaction(transaction, {
      expectedRevision: input.expectedGateLedgerRevision,
      scopeKey: input.qualification.content.scopeKey,
      qualificationId: input.qualification.qualificationId,
      qualificationArtifactId: input.qualificationArtifact.artifactId,
      playerRunId: input.qualification.content.player.runId,
      pickRunId: input.qualification.content.pick.runId,
      records: input.gateRecords,
      updatedAt: authorityEffectiveAt,
    });
  } catch (cause) {
    if (cause instanceof AflTradeGateLedgerRepositoryError && cause.code === 'STALE_REVISION') {
      throw new GovernedValuationModelQualificationRepositoryError(
        'STALE_GATE_LEDGER',
        'Gate ledger changed before the qualified pair could commit.',
        { cause }
      );
    }
    throw cause;
  }
}

async function advanceQualifiedPair(
  transaction: AflOutcomeSqlTransaction,
  input: QualificationRegistrationInput & {
    readonly gateRecords: readonly [
      GovernedValuationModelQualificationGateRecord,
      GovernedValuationModelQualificationGateRecord,
    ];
  },
  work: GovernedValuationModelQualificationWork,
  authorityEffectiveAt: string
): Promise<GovernedCurrentValuationModelPair> {
  let revisionResult;
  try {
    revisionResult = await transaction.query<{ revision: number }>(
      `SELECT advance_outcome_current_governed_valuation_model_pair(
         $1,$2,$3,$4,$5,$6,$7) AS revision`,
      [
        input.qualification.content.scopeKey,
        input.qualification.qualificationId,
        input.gateRecords[0].decision.decisionId,
        input.gateRecords[1].decision.decisionId,
        work.workId,
        input.expectedCurrentRevision,
        authorityEffectiveAt,
      ]
    );
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.includes('Stale current model-pair revision')) {
      throw cause;
    }
    throw new GovernedValuationModelQualificationRepositoryError(
      'STALE_CURRENT_PAIR',
      'Current model pair changed before the qualification could advance.',
      { cause }
    );
  }
  const current = await loadCurrentFrom(transaction, input.qualification.content.scopeKey);
  if (
    !current ||
    current.revision !== Number(revisionResult.rows[0]?.revision) ||
    current.qualificationId !== input.qualification.qualificationId
  ) {
    throw new GovernedValuationModelQualificationRepositoryError(
      'INTEGRITY_MISMATCH',
      'Advanced current model pair failed exact readback.'
    );
  }
  return current;
}

async function registerQualificationWithinTransaction(
  transaction: AflOutcomeSqlTransaction,
  input: QualificationRegistrationInput,
  nativeEvidence: AuthenticatedQualificationArtifacts
): Promise<GovernedValuationModelQualificationRegistrationResult> {
  const { qualification } = input;
  await retainNativeValidationEvidence(transaction, qualification, nativeEvidence);
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
      `SELECT work_json AS value FROM outcome_governed_model_qualification_work WHERE work_id=$1`,
      [existingCurrent.workId]
    );
    const work = governedValuationModelQualificationWorkSchema.parse(workResult.rows[0]?.value);
    return {
      status: 'advanced',
      qualification,
      current: existingCurrent,
      work,
      idempotentReplay: true,
    };
  }
  const qualifiedInput = { ...input, gateRecords: input.gateRecords };
  const authorityEffectiveAt = validateQualificationGateRecords(
    qualification,
    input.qualificationArtifact,
    qualifiedInput.gateRecords
  );
  await appendQualificationGateRecords(transaction, qualifiedInput, authorityEffectiveAt);
  const work = createGovernedValuationModelQualificationWork({
    qualification,
    playerGate3DecisionId: qualifiedInput.gateRecords[0].decision.decisionId,
    pickGate3DecisionId: qualifiedInput.gateRecords[1].decision.decisionId,
    availableAt: authorityEffectiveAt,
  });
  await retainWork(transaction, work);
  const current = await advanceQualifiedPair(
    transaction,
    qualifiedInput,
    work,
    authorityEffectiveAt
  );
  return { status: 'advanced', qualification, current, work, idempotentReplay: false };
}

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

  async register(
    input: QualificationRegistrationInput
  ): Promise<GovernedValuationModelQualificationRegistrationResult> {
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
    const nativeEvidence = await authenticateArtifacts({
      repository: this.dependencies.artifactRepository,
      maximumBytes: this.dependencies.maximumArtifactBytes,
      qualification,
      qualificationArtifact: input.qualificationArtifact,
    });
    return this.dependencies.client.transaction((transaction) =>
      registerQualificationWithinTransaction(
        transaction,
        { ...input, qualification },
        nativeEvidence
      )
    );
  }

  loadCurrent(scopeKey: string): Promise<GovernedCurrentValuationModelPair | null> {
    return loadCurrentFrom(this.dependencies.client, scopeKey);
  }
}
