import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import { aflTradeGateDecisionRecordSchema } from '../../governance/gateDecisionTypes';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import { authenticateGovernedNativeComponentExecution } from './governedNativeComponentExecution';
import type { GovernedPrivateEvaluationInputTrace } from './governedPrivateEvaluationInputTrace';
import {
  authenticateGovernedReadyComponentAuthority,
  GovernedReadyComponentAuthorityError,
  type GovernedReadyComponentAuthority,
} from './governedReadyComponentAuthority';
import {
  GovernedValuationComponentRunRepositoryError,
  PostgresGovernedValuationComponentRunRepository,
} from './postgresGovernedValuationComponentRunRepository';
import {
  governedValuationModelQualificationSchema,
  type GovernedValuationModelQualification,
} from './governedValuationModelQualification';

interface GateHeadRow {
  readonly revision: number | string;
}

interface GateDecisionRow {
  readonly decision_id: string;
  readonly gate: string;
  readonly decision_key: string;
  readonly version: number | string;
  readonly environment: string;
  readonly decision_json: unknown;
  readonly is_current: boolean;
}

interface CurrentQualificationRow {
  readonly qualification_id: string;
  readonly player_run_id: string;
  readonly pick_run_id: string;
  readonly player_gate3_decision_id: string;
  readonly pick_gate3_decision_id: string;
  readonly artifact_id: string;
  readonly qualification_json: unknown;
}

type Unavailable = Readonly<{
  state: 'unavailable';
  blockers: readonly Readonly<{
    code: 'model_not_approved';
    message: string;
  }>[];
}>;

const unavailable = (): Unavailable => ({
  state: 'unavailable',
  blockers: [
    {
      code: 'model_not_approved',
      message:
        'The exact current automated qualification is unavailable for both governed model components.',
    },
  ],
});

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

async function loadGate3(input: {
  transaction: AflOutcomeSqlTransaction;
  decisionId: string;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
  artifact: GovernedPrivateEvaluationInputTrace['content']['components'][number]['evidence']['gate3Decision'];
}) {
  const result = await input.transaction.query<GateDecisionRow>(
    `SELECT decision.decision_id,decision.gate,decision.decision_key,decision.version,
       decision.environment::text AS environment,decision.decision_json,
       NOT EXISTS (
         SELECT 1 FROM outcome_gate_decision successor
          WHERE successor.gate=decision.gate
            AND successor.environment=decision.environment
            AND successor.decision_key=decision.decision_key
            AND successor.version>decision.version
       ) AS is_current
       FROM outcome_gate_decision decision WHERE decision.decision_id=$1`,
    [input.decisionId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) {
    throw new TypeError('Gate 3 decision identity is ambiguous.');
  }
  const parsed = aflTradeGateDecisionRecordSchema.safeParse(row.decision_json);
  if (
    !parsed.success ||
    parsed.data.decisionId !== row.decision_id ||
    parsed.data.content.gate !== row.gate ||
    parsed.data.content.decisionKey !== row.decision_key ||
    parsed.data.content.version !== Number(row.version) ||
    parsed.data.content.environment !== row.environment
  ) {
    throw new TypeError('Stored Gate 3 decision failed exact SQL authentication.');
  }
  const loaded = await input.artifactRepository.loadExact(
    input.artifact,
    input.maximumArtifactBytes
  );
  if (
    loaded === null ||
    !doAflTradeArtifactRefsExactlyMatch(loaded.reference, input.artifact) ||
    !doesAflTradeArtifactRefMatchBytes(loaded.reference, loaded.bytes)
  ) {
    throw new TypeError('Gate 3 retained decision bytes failed exact authentication.');
  }
  let physical: unknown;
  try {
    physical = JSON.parse(new TextDecoder().decode(loaded.bytes));
  } catch {
    throw new TypeError('Gate 3 retained decision bytes are not valid JSON.');
  }
  if (
    canonicalizeAflTradeJson(physical) !== canonicalizeAflTradeJson(parsed.data) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.artifact, parsed.data)
  ) {
    throw new TypeError('Gate 3 SQL and retained object evidence disagree.');
  }
  return { decision: parsed.data, artifact: input.artifact, isCurrent: row.is_current };
}

async function loadCurrentQualification(input: {
  transaction: AflOutcomeSqlTransaction;
  scopeKey: string;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): Promise<
  | null
  | Readonly<{
      qualification: GovernedValuationModelQualification;
      artifact: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;
      playerRunId: string;
      pickRunId: string;
      playerGate3DecisionId: string;
      pickGate3DecisionId: string;
    }>
> {
  const result = await input.transaction.query<CurrentQualificationRow>(
    `SELECT current_pair.qualification_id,current_pair.player_run_id,current_pair.pick_run_id,
       current_pair.player_gate3_decision_id,current_pair.pick_gate3_decision_id,
       qualification.artifact_id,qualification.qualification_json
       FROM outcome_current_governed_valuation_model_pair current_pair
       JOIN outcome_governed_valuation_model_qualification qualification
         ON qualification.qualification_id=current_pair.qualification_id
      WHERE current_pair.scope_key=$1`,
    [input.scopeKey]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) {
    throw new TypeError('Current governed model-pair identity is ambiguous.');
  }
  const qualification = governedValuationModelQualificationSchema.parse(row.qualification_json);
  const artifact = createAflTradeCanonicalJsonArtifactRef(
    qualification,
    qualification.content.evaluatedAt
  );
  if (
    qualification.qualificationId !== row.qualification_id ||
    qualification.content.scopeKey !== input.scopeKey ||
    qualification.content.player.runId !== row.player_run_id ||
    qualification.content.pick.runId !== row.pick_run_id ||
    artifact.artifactId !== row.artifact_id
  ) {
    throw new TypeError('Current governed model-pair SQL ancestry failed exact authentication.');
  }
  const retained = await input.artifactRepository.loadExact(artifact, input.maximumArtifactBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, artifact) ||
    !doesAflTradeArtifactRefMatchBytes(artifact, retained.bytes)
  ) {
    throw new TypeError('Current governed model-pair retained bytes failed exact authentication.');
  }
  let physical: unknown;
  try {
    physical = JSON.parse(new TextDecoder().decode(retained.bytes));
  } catch {
    throw new TypeError('Current governed model-pair retained bytes are not valid JSON.');
  }
  if (canonicalizeAflTradeJson(physical) !== canonicalizeAflTradeJson(qualification)) {
    throw new TypeError('Current governed model-pair SQL and retained bytes disagree.');
  }
  return {
    qualification,
    artifact,
    playerRunId: row.player_run_id,
    pickRunId: row.pick_run_id,
    playerGate3DecisionId: row.player_gate3_decision_id,
    pickGate3DecisionId: row.pick_gate3_decision_id,
  };
}

export async function loadCurrentGovernedComponentAuthority(input: {
  transaction: AflOutcomeSqlTransaction;
  trace: GovernedPrivateEvaluationInputTrace;
  capturedAt: string;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): Promise<
  | Unavailable
  | Readonly<{
      state: 'ready';
      gateLedgerRevision: number;
      components: readonly GovernedReadyComponentAuthority[];
    }>
> {
  const head = await input.transaction.query<GateHeadRow>(
    `SELECT revision FROM outcome_gate_ledger_head WHERE singleton_id=1`
  );
  const gateLedgerRevision = Number(head.rows[0]?.revision);
  if (
    head.rows.length !== 1 ||
    !Number.isSafeInteger(gateLedgerRevision) ||
    gateLedgerRevision < 0
  ) {
    throw new TypeError('Gate ledger head is unavailable or malformed.');
  }
  if (gateLedgerRevision === 0) return unavailable();
  const currentQualification = await loadCurrentQualification({
    transaction: input.transaction,
    scopeKey: input.trace.content.selector.valuationScopeKey,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  if (currentQualification === null) return unavailable();
  const repository = new PostgresGovernedValuationComponentRunRepository({
    client: transactionClient(input.transaction),
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  const components: GovernedReadyComponentAuthority[] = [];
  for (const traceComponent of input.trace.content.components) {
    const expected =
      traceComponent.role === 'player_contribution_and_availability'
        ? {
            runId: currentQualification.playerRunId,
            gate3DecisionId: currentQualification.playerGate3DecisionId,
          }
        : {
            runId: currentQualification.pickRunId,
            gate3DecisionId: currentQualification.pickGate3DecisionId,
          };
    if (
      traceComponent.runId !== expected.runId ||
      traceComponent.gate3DecisionId !== expected.gate3DecisionId
    ) {
      return unavailable();
    }
    let run;
    try {
      run = await repository.loadExact(traceComponent.runId);
      await authenticateGovernedNativeComponentExecution({
        manifest: run.manifest,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      });
    } catch (error) {
      if (
        error instanceof GovernedValuationComponentRunRepositoryError &&
        error.code === 'NOT_FOUND'
      ) {
        return unavailable();
      }
      throw error;
    }
    const gate3 = await loadGate3({
      transaction: input.transaction,
      decisionId: traceComponent.gate3DecisionId,
      artifactRepository: input.artifactRepository,
      maximumArtifactBytes: input.maximumArtifactBytes,
      artifact: traceComponent.evidence.gate3Decision,
    });
    if (gate3 === null) return unavailable();
    try {
      components.push(
        authenticateGovernedReadyComponentAuthority({
          traceComponent,
          run,
          gate3Decision: gate3.decision,
          gate3DecisionArtifact: gate3.artifact,
          gate3IsCurrent: gate3.isCurrent,
          gateLedgerRevision,
          capturedAt: input.capturedAt,
          qualification: currentQualification.qualification,
          qualificationArtifact: currentQualification.artifact,
          currentQualificationId: currentQualification.qualification.qualificationId,
        })
      );
    } catch (error) {
      if (error instanceof GovernedReadyComponentAuthorityError) return unavailable();
      throw error;
    }
  }
  return { state: 'ready', gateLedgerRevision, components };
}
