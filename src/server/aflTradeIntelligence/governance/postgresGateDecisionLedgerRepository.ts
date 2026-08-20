import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceContracts';
import {
  appendAflTradeGateDecision,
  validateAflTradeGateDecisionLedger,
  type AflTradeGateDecisionLedger,
} from './gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from './gateDecisionTypes';

export type AflTradeGateLedgerRepositoryErrorCode =
  'INVALID_APPEND' | 'INVALID_STORED_STATE' | 'STALE_REVISION' | 'CONFLICTING_REPLAY';

export class AflTradeGateLedgerRepositoryError extends Error {
  constructor(
    public readonly code: AflTradeGateLedgerRepositoryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeGateLedgerRepositoryError';
  }
}

export interface AflTradeStoredGateLedger {
  revision: number;
  ledger: AflTradeGateDecisionLedger;
}

export interface AflTradeGateLedgerAppendInput {
  expectedRevision: number;
  sourceRights: AflTradeSourceRightsProposal;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
}

export interface AflTradeGateLedgerAppendResult extends AflTradeStoredGateLedger {
  idempotentReplay: boolean;
}

export interface AflTradeGateLedgerDecisionAppendInput {
  expectedRevision: number;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
}

export type AflTradeGateLedgerBatchRecord = Omit<AflTradeGateLedgerAppendInput, 'expectedRevision'>;

export interface AflTradeGateLedgerBatchAppendInput {
  expectedRevision: number;
  records: readonly AflTradeGateLedgerBatchRecord[];
}

export interface AflTradeGateLedgerBatchAppendResult extends AflTradeStoredGateLedger {
  idempotentReplays: readonly boolean[];
}

export interface AflTradeResolvedGateAuthorization extends AflTradeStoredGateLedger {
  sourceRights: AflTradeSourceRightsProposal;
}

export interface AflTradeGateDecisionLedgerRepository {
  load(): Promise<AflTradeStoredGateLedger>;
  append(input: AflTradeGateLedgerAppendInput): Promise<AflTradeGateLedgerAppendResult>;
  appendDecision(
    input: AflTradeGateLedgerDecisionAppendInput
  ): Promise<AflTradeGateLedgerAppendResult>;
  appendBatch(
    input: AflTradeGateLedgerBatchAppendInput
  ): Promise<AflTradeGateLedgerBatchAppendResult>;
  resolveAuthorization(rightsArtifactId: string): Promise<AflTradeResolvedGateAuthorization>;
}

interface GateHeadRow extends Record<string, unknown> {
  revision: number;
}

interface ProposalRow extends Record<string, unknown> {
  proposal_json: unknown;
}

interface DecisionRow extends Record<string, unknown> {
  decision_json: unknown;
}

interface RightsRow extends Record<string, unknown> {
  content_json: unknown;
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function invalidStored(message: string, cause?: unknown): AflTradeGateLedgerRepositoryError {
  return new AflTradeGateLedgerRepositoryError('INVALID_STORED_STATE', message, {
    cause,
  });
}

function parseProposal(value: unknown): AflTradeGateDecisionProposal {
  const parsed = aflTradeGateDecisionProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidStored('A stored Gate proposal failed authentication.', parsed.error);
  }
  return parsed.data;
}

function parseDecision(value: unknown): AflTradeGateDecisionRecord {
  const parsed = aflTradeGateDecisionRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidStored('A stored Gate decision failed authentication.', parsed.error);
  }
  return parsed.data;
}

function parseSourceRights(value: unknown): AflTradeSourceRightsProposal {
  const parsed = aflTradeSourceRightsProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidStored('A stored source-rights proposal failed authentication.', parsed.error);
  }
  return parsed.data;
}

function parseAppendInput(input: AflTradeGateLedgerAppendInput): AflTradeGateLedgerAppendInput {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Expected Gate ledger revision must be a non-negative safe integer.'
    );
  }
  const sourceRights = aflTradeSourceRightsProposalSchema.safeParse(input.sourceRights);
  const proposal = aflTradeGateDecisionProposalSchema.safeParse(input.proposal);
  const decision = aflTradeGateDecisionRecordSchema.safeParse(input.decision);
  if (!sourceRights.success || !proposal.success || !decision.success) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Gate ledger append records failed their content-addressed contracts.'
    );
  }
  if (
    !proposal.data.content.affectedArtifacts.some(
      (artifact) =>
        artifact.kind === 'source_rights' &&
        artifact.artifactId === sourceRights.data.rightsArtifactId
    ) ||
    !decision.data.content.affectedArtifacts.some(
      (artifact) =>
        artifact.kind === 'source_rights' &&
        artifact.artifactId === sourceRights.data.rightsArtifactId
    )
  ) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Gate 0A append must bind the exact persisted source-rights artifact.'
    );
  }
  return {
    expectedRevision: input.expectedRevision,
    sourceRights: sourceRights.data,
    proposal: proposal.data,
    decision: decision.data,
  };
}

function parseDecisionAppendInput(
  input: AflTradeGateLedgerDecisionAppendInput
): AflTradeGateLedgerDecisionAppendInput {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Expected Gate ledger revision must be a non-negative safe integer.'
    );
  }
  const proposal = aflTradeGateDecisionProposalSchema.safeParse(input.proposal);
  const decision = aflTradeGateDecisionRecordSchema.safeParse(input.decision);
  if (!proposal.success || !decision.success) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Gate ledger append records failed their content-addressed contracts.'
    );
  }
  if (
    proposal.data.content.gate === 'gate_0a_permission_to_evaluate' ||
    decision.data.content.gate === 'gate_0a_permission_to_evaluate'
  ) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Gate 0A decisions must use the source-rights append boundary.'
    );
  }
  return {
    expectedRevision: input.expectedRevision,
    proposal: proposal.data,
    decision: decision.data,
  };
}

function parseBatchInput(input: AflTradeGateLedgerBatchAppendInput): {
  expectedRevision: number;
  records: AflTradeGateLedgerAppendInput[];
} {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'Expected Gate ledger batch revision must be a non-negative safe integer.'
    );
  }
  if (input.records.length === 0) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'A Gate ledger batch must contain at least one record.'
    );
  }
  return {
    expectedRevision: input.expectedRevision,
    records: input.records.map((record) =>
      parseAppendInput({ ...record, expectedRevision: input.expectedRevision })
    ),
  };
}

async function loadLedger(
  transaction: AflOutcomeSqlTransaction,
  lockHead: boolean
): Promise<AflTradeStoredGateLedger> {
  const head = await transaction.query<GateHeadRow>(
    `SELECT revision
     FROM outcome_gate_ledger_head
     WHERE singleton_id = 1${lockHead ? ' FOR UPDATE' : ''}`
  );
  if (head.rows.length !== 1) throw invalidStored('The Gate ledger head is unavailable.');

  const proposalRows = await transaction.query<ProposalRow>(
    `SELECT proposal_json
     FROM outcome_gate_proposal
     ORDER BY proposed_at, gate, decision_key, version, proposal_id`
  );
  const decisionRows = await transaction.query<DecisionRow>(
    `SELECT decision_json
     FROM outcome_gate_decision
     ORDER BY version, gate, decision_key, decision_id`
  );
  const ledger = {
    proposals: proposalRows.rows.map((row) => parseProposal(row.proposal_json)),
    decisions: decisionRows.rows.map((row) => parseDecision(row.decision_json)),
  };
  const validation = validateAflTradeGateDecisionLedger(ledger);
  if (!validation.valid || head.rows[0].revision !== ledger.decisions.length) {
    throw invalidStored('The Gate ledger head and immutable decision chain do not agree.');
  }
  return { revision: head.rows[0].revision, ledger };
}

async function requireExactSourceRights(
  transaction: AflOutcomeSqlTransaction,
  sourceRights: AflTradeSourceRightsProposal
): Promise<boolean> {
  const existing = await transaction.query<RightsRow>(
    `SELECT content_json
     FROM outcome_source_rights_proposal
     WHERE rights_artifact_id = $1`,
    [sourceRights.rightsArtifactId]
  );
  if (existing.rows.length > 1) throw invalidStored('Source-rights identity is not unique.');
  if (existing.rows.length === 0) return false;
  if (!exactJson(existing.rows[0].content_json, sourceRights)) {
    throw new AflTradeGateLedgerRepositoryError(
      'CONFLICTING_REPLAY',
      'The source-rights identity already names different persisted content.'
    );
  }
  return true;
}

function findReplay(
  stored: AflTradeStoredGateLedger,
  input: Pick<AflTradeGateLedgerAppendInput, 'proposal' | 'decision'>
): 'none' | 'exact' | 'conflict' {
  const storedProposal = stored.ledger.proposals.find(
    (proposal) => proposal.proposalId === input.proposal.proposalId
  );
  const storedDecision = stored.ledger.decisions.find(
    (decision) => decision.decisionId === input.decision.decisionId
  );
  if (storedProposal === undefined && storedDecision === undefined) return 'none';
  if (
    storedProposal !== undefined &&
    storedDecision !== undefined &&
    exactJson(storedProposal, input.proposal) &&
    exactJson(storedDecision, input.decision)
  ) {
    return 'exact';
  }
  return 'conflict';
}

async function insertSourceRights(
  transaction: AflOutcomeSqlTransaction,
  sourceRights: AflTradeSourceRightsProposal
): Promise<void> {
  const capabilityId =
    sourceRights.content.acquisition.kind === 'fitzroy'
      ? (sourceRights.content.acquisition.capabilities[0]?.capabilityId ?? null)
      : null;
  await transaction.query(
    `INSERT INTO outcome_source_rights_proposal (
       rights_artifact_id, provider, dataset, dataset_version, capability_id,
       proposed_at, content_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      sourceRights.rightsArtifactId,
      sourceRights.content.provider,
      sourceRights.content.dataset,
      sourceRights.content.datasetVersion,
      capabilityId,
      sourceRights.content.proposedAt,
      sourceRights,
    ]
  );
}

async function insertProposal(
  transaction: AflOutcomeSqlTransaction,
  proposal: AflTradeGateDecisionProposal
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_gate_proposal (
       proposal_id, gate, decision_key, version, environment, scope_key,
       proposed_at, proposal_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      proposal.proposalId,
      proposal.content.gate,
      proposal.content.decisionKey,
      proposal.content.version,
      proposal.content.environment,
      proposal.content.scope.scopeKey,
      proposal.content.proposedAt,
      proposal,
    ]
  );
}

async function insertDecision(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeGateDecisionRecord
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_gate_decision (
       decision_id, proposal_id, gate, decision_key, version, environment, state,
       decided_at, effective_at, revalidate_at, supersedes_decision_id, decision_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      decision.decisionId,
      decision.content.proposalId,
      decision.content.gate,
      decision.content.decisionKey,
      decision.content.version,
      decision.content.environment,
      decision.content.state,
      decision.content.decidedAt,
      decision.content.effectiveAt,
      decision.content.revalidateAt,
      decision.content.supersedesDecisionId,
      decision,
    ]
  );
}

export async function appendNewAflTradeGateDecisionsWithinTransaction(
  transaction: AflOutcomeSqlTransaction,
  input: Readonly<{
    expectedRevision: number;
    records: readonly Readonly<{
      proposal: AflTradeGateDecisionProposal;
      decision: AflTradeGateDecisionRecord;
    }>[];
    updatedAt: string;
  }>
): Promise<AflTradeStoredGateLedger> {
  if (input.records.length === 0) {
    throw new AflTradeGateLedgerRepositoryError(
      'INVALID_APPEND',
      'A transaction-scoped Gate append requires at least one decision.'
    );
  }
  const records = input.records.map((record) =>
    parseDecisionAppendInput({ ...record, expectedRevision: input.expectedRevision })
  );
  const stored = await loadLedger(transaction, true);
  if (stored.revision !== input.expectedRevision) {
    throw new AflTradeGateLedgerRepositoryError(
      'STALE_REVISION',
      'The Gate ledger revision changed before the transaction-scoped append.'
    );
  }
  let ledger = stored.ledger;
  for (const record of records) {
    if (findReplay(stored, record) !== 'none') {
      throw new AflTradeGateLedgerRepositoryError(
        'CONFLICTING_REPLAY',
        'A transaction-scoped Gate append requires new proposal and decision identities.'
      );
    }
    try {
      ledger = appendAflTradeGateDecision(ledger, record.proposal, record.decision);
    } catch (cause) {
      throw new AflTradeGateLedgerRepositoryError(
        'INVALID_APPEND',
        'A Gate decision does not validly extend the transaction-scoped batch.',
        { cause }
      );
    }
    await insertProposal(transaction, record.proposal);
    await insertDecision(transaction, record.decision);
  }
  const revision = stored.revision + records.length;
  const updated = await transaction.query(
    `UPDATE outcome_gate_ledger_head
     SET revision=$1,updated_at=$2
     WHERE singleton_id=1 AND revision=$3`,
    [revision, input.updatedAt, stored.revision]
  );
  if (updated.rowCount !== 1) {
    throw new AflTradeGateLedgerRepositoryError(
      'STALE_REVISION',
      'The locked Gate ledger head could not be advanced for the transaction-scoped batch.'
    );
  }
  return { revision, ledger };
}

class PostgresAflTradeGateDecisionLedgerRepository implements AflTradeGateDecisionLedgerRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  load(): Promise<AflTradeStoredGateLedger> {
    return loadLedger(this.client, false);
  }

  resolveAuthorization(rightsArtifactId: string): Promise<AflTradeResolvedGateAuthorization> {
    return this.client.transaction(async (transaction) => {
      const stored = await loadLedger(transaction, false);
      const rights = await transaction.query<RightsRow>(
        `SELECT content_json
         FROM outcome_source_rights_proposal
         WHERE rights_artifact_id = $1`,
        [rightsArtifactId]
      );
      if (rights.rows.length !== 1) {
        throw invalidStored('The exact durable source-rights proposal is unavailable.');
      }
      const sourceRights = parseSourceRights(rights.rows[0].content_json);
      if (sourceRights.rightsArtifactId !== rightsArtifactId) {
        throw invalidStored('The durable source-rights identity does not match its lookup key.');
      }
      return { ...stored, sourceRights };
    });
  }

  async appendBatch(
    unparsedInput: AflTradeGateLedgerBatchAppendInput
  ): Promise<AflTradeGateLedgerBatchAppendResult> {
    const input = parseBatchInput(unparsedInput);
    return this.client.transaction(async (transaction) => {
      const stored = await loadLedger(transaction, true);
      const replayStates = input.records.map((record) => findReplay(stored, record));
      if (replayStates.some((state) => state === 'conflict')) {
        throw new AflTradeGateLedgerRepositoryError(
          'CONFLICTING_REPLAY',
          'A Gate batch proposal or decision identity already names different content.'
        );
      }
      const rightsExist: boolean[] = [];
      for (const record of input.records) {
        rightsExist.push(await requireExactSourceRights(transaction, record.sourceRights));
      }
      if (replayStates.every((state) => state === 'exact')) {
        if (rightsExist.some((exists) => !exists)) {
          throw invalidStored('An exact Gate batch replay is missing source-rights records.');
        }
        return {
          ...stored,
          idempotentReplays: input.records.map(() => true),
        };
      }
      if (stored.revision !== input.expectedRevision) {
        throw new AflTradeGateLedgerRepositoryError(
          'STALE_REVISION',
          'The Gate ledger revision changed before the batch could commit.'
        );
      }

      let nextLedger = stored.ledger;
      let appendedCount = 0;
      const idempotentReplays: boolean[] = [];
      for (const [index, record] of input.records.entries()) {
        const replay = replayStates[index];
        if (replay === 'exact') {
          if (!rightsExist[index]) {
            throw invalidStored('An exact Gate record replay is missing source-rights state.');
          }
          idempotentReplays.push(true);
          continue;
        }
        try {
          nextLedger = appendAflTradeGateDecision(nextLedger, record.proposal, record.decision);
        } catch (cause) {
          throw new AflTradeGateLedgerRepositoryError(
            'INVALID_APPEND',
            'A Gate decision does not validly extend the stored ledger batch.',
            { cause }
          );
        }
        if (!rightsExist[index]) await insertSourceRights(transaction, record.sourceRights);
        await insertProposal(transaction, record.proposal);
        await insertDecision(transaction, record.decision);
        appendedCount += 1;
        idempotentReplays.push(false);
      }

      const revision = stored.revision + appendedCount;
      const updated = await transaction.query(
        `UPDATE outcome_gate_ledger_head
         SET revision = $1, updated_at = $2
         WHERE singleton_id = 1 AND revision = $3`,
        [revision, input.records.at(-1)!.decision.content.decidedAt, stored.revision]
      );
      if (updated.rowCount !== 1) {
        throw new AflTradeGateLedgerRepositoryError(
          'STALE_REVISION',
          'The locked Gate ledger head could not be advanced for the batch.'
        );
      }
      return { revision, ledger: nextLedger, idempotentReplays };
    });
  }

  async append(
    unparsedInput: AflTradeGateLedgerAppendInput
  ): Promise<AflTradeGateLedgerAppendResult> {
    const input = parseAppendInput(unparsedInput);
    return this.client.transaction(async (transaction) => {
      const stored = await loadLedger(transaction, true);
      const replay = findReplay(stored, input);
      if (replay === 'conflict') {
        throw new AflTradeGateLedgerRepositoryError(
          'CONFLICTING_REPLAY',
          'A Gate proposal or decision identity already names different content.'
        );
      }
      const rightsExists = await requireExactSourceRights(transaction, input.sourceRights);
      if (replay === 'exact') {
        if (!rightsExists) {
          throw invalidStored('An exact Gate decision replay is missing its source-rights record.');
        }
        return { ...stored, idempotentReplay: true };
      }
      if (stored.revision !== input.expectedRevision) {
        throw new AflTradeGateLedgerRepositoryError(
          'STALE_REVISION',
          'The Gate ledger revision changed before the append could commit.'
        );
      }
      let nextLedger: AflTradeGateDecisionLedger;
      try {
        nextLedger = appendAflTradeGateDecision(stored.ledger, input.proposal, input.decision);
      } catch (cause) {
        throw new AflTradeGateLedgerRepositoryError(
          'INVALID_APPEND',
          'The Gate decision does not validly extend the stored ledger.',
          { cause }
        );
      }
      if (!rightsExists) await insertSourceRights(transaction, input.sourceRights);
      await insertProposal(transaction, input.proposal);
      await insertDecision(transaction, input.decision);
      const revision = stored.revision + 1;
      const updated = await transaction.query(
        `UPDATE outcome_gate_ledger_head
         SET revision = $1, updated_at = $2
         WHERE singleton_id = 1 AND revision = $3`,
        [
          revision,
          input.decision.content.decidedAt ?? input.proposal.content.proposedAt,
          stored.revision,
        ]
      );
      if (updated.rowCount !== 1) {
        throw new AflTradeGateLedgerRepositoryError(
          'STALE_REVISION',
          'The locked Gate ledger head could not be advanced.'
        );
      }
      return { revision, ledger: nextLedger, idempotentReplay: false };
    });
  }

  async appendDecision(
    unparsedInput: AflTradeGateLedgerDecisionAppendInput
  ): Promise<AflTradeGateLedgerAppendResult> {
    const input = parseDecisionAppendInput(unparsedInput);
    if (input.decision.content.authorityKind === 'automated_validation_record') {
      throw new AflTradeGateLedgerRepositoryError(
        'INVALID_APPEND',
        'Automated model-validity records must use the governed qualification boundary.'
      );
    }
    return this.client.transaction(async (transaction) => {
      const stored = await loadLedger(transaction, true);
      const replay = findReplay(stored, input);
      if (replay === 'conflict') {
        throw new AflTradeGateLedgerRepositoryError(
          'CONFLICTING_REPLAY',
          'A Gate proposal or decision identity already names different content.'
        );
      }
      if (replay === 'exact') {
        return { ...stored, idempotentReplay: true };
      }
      if (stored.revision !== input.expectedRevision) {
        throw new AflTradeGateLedgerRepositoryError(
          'STALE_REVISION',
          'The Gate ledger revision changed before the append could commit.'
        );
      }
      let nextLedger: AflTradeGateDecisionLedger;
      try {
        nextLedger = appendAflTradeGateDecision(stored.ledger, input.proposal, input.decision);
      } catch (cause) {
        throw new AflTradeGateLedgerRepositoryError(
          'INVALID_APPEND',
          'A Gate decision does not validly extend the stored ledger.',
          { cause }
        );
      }
      await insertProposal(transaction, input.proposal);
      await insertDecision(transaction, input.decision);
      const revision = stored.revision + 1;
      const updated = await transaction.query(
        `UPDATE outcome_gate_ledger_head
         SET revision = $1, updated_at = $2
         WHERE singleton_id = 1 AND revision = $3`,
        [
          revision,
          input.decision.content.decidedAt ?? input.proposal.content.proposedAt,
          stored.revision,
        ]
      );
      if (updated.rowCount !== 1) {
        throw new AflTradeGateLedgerRepositoryError(
          'STALE_REVISION',
          'The locked Gate ledger head could not be advanced.'
        );
      }
      return { revision, ledger: nextLedger, idempotentReplay: false };
    });
  }
}

export function createPostgresAflTradeGateDecisionLedgerRepository(
  client: AflOutcomeSqlClient
): AflTradeGateDecisionLedgerRepository {
  return new PostgresAflTradeGateDecisionLedgerRepository(client);
}
