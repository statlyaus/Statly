import {
  aflTradeConsumedFieldSetSchema,
  aflTradeCorpusFactualLineageSchema,
  createAflTradeConsumedFieldSet,
  createAflTradeCorpusFactualLineage,
  type AflTradeConsumedFieldSet,
  type AflTradeCorpusFactualLineage,
} from '../artifacts/valuationDatasetAdmissionContracts';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeSourceSnapshotManifestSchema } from '../artifacts/sourceSnapshotManifest';
import {
  resolveAflTradeGateEligibility,
  type AflTradeGateDecisionLedger,
} from '../governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import {
  aflTradeFactualReleaseCandidateSchema,
  type AflTradeFactualReleaseCandidate,
} from '../outcomes/factualReleaseCandidateContracts';
import { parseAflTradeExternalCaptureExecutionReceipt } from '../source/externalDraftTradeIngestion';
import type { AflTradeSourceRightsProposal } from '../source/sourceRights';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { requireOrInsertAflTradeValuationDatasetFieldSet } from './postgresValuationDatasetRepository';

const ADMISSION_SCHEMA_VERSION = 'afl-trade-valuation-dataset-lineage-admission/v1' as const;
const ADMISSION_AUTHORITY_BOUNDARY =
  'gate_2_private_factual_lineage_only_no_model_grade_publication_or_activation_authority' as const;

export type AflTradeValuationDatasetFactualLineageErrorCode =
  | 'INVALID_INPUT'
  | 'CANDIDATE_UNAVAILABLE'
  | 'LINEAGE_CONFLICT'
  | 'GATE2_UNAVAILABLE'
  | 'ADMISSION_CONFLICT';

export class AflTradeValuationDatasetFactualLineageError extends Error {
  constructor(
    readonly code: AflTradeValuationDatasetFactualLineageErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeValuationDatasetFactualLineageError';
  }
}

export interface AflTradeValuationDatasetFactualLineageAdmission {
  readonly admissionId: string;
  readonly content: {
    readonly schemaVersion: typeof ADMISSION_SCHEMA_VERSION;
    readonly authorityBoundary: typeof ADMISSION_AUTHORITY_BOUNDARY;
    readonly publicationEligible: false;
    readonly environment: 'test_fixture' | 'non_production' | 'production';
    readonly scopeKey: string;
    readonly competition: 'AFLM' | 'AFLW';
    readonly validFromSeason: number;
    readonly validThroughSeason: number;
    readonly lineageId: string;
    readonly corpusId: string;
    readonly factualReleaseId: string;
    readonly factualCandidateId: string;
    readonly sourceMemberSetSha256: string;
    readonly gate2DecisionKey: string;
    readonly gateProposalId: string;
    readonly gateDecisionId: string;
    readonly gateDecisionVersion: number;
    readonly gateLedgerRevision: number;
    readonly admittedAt: string;
    readonly effectiveAt: string;
    readonly revalidateAt: string;
  };
}

interface CandidateRow extends Record<string, unknown> {
  candidate_id: string;
  candidate_sha256: string;
  status: string;
  finalized_at: Date | string | null;
  candidate_json: unknown;
}

interface SnapshotRow extends Record<string, unknown> {
  capture_id: string;
  source_snapshot_id: string;
  manifest_json: unknown;
}

interface SpellRow extends Record<string, unknown> {
  spell_version_id: string;
  spell_id: string;
  player_id: string;
  club_id: string;
  start_event_version_id: string;
  start_asset_version_id: string;
  event_id: string;
  event_competition: string;
  event_season_year: number | string;
  source_capture_id: string;
  asset_source_capture_id: string;
  promotion_environment: string;
  promotion_competition: string;
}

interface EdgeRow extends Record<string, unknown> {
  edge_id: string;
  event_id: string | null;
}

interface LineageRow extends Record<string, unknown> {
  lineage_json: unknown;
}

interface AdmissionRow extends Record<string, unknown> {
  admission_json: unknown;
}

interface RevisionRow extends Record<string, unknown> {
  revision: number | string;
}

interface ProposalRow extends Record<string, unknown> {
  proposal_json: unknown;
}

interface DecisionRow extends Record<string, unknown> {
  decision_json: unknown;
}

function fail(
  code: AflTradeValuationDatasetFactualLineageErrorCode,
  message: string,
  cause?: unknown
): never {
  throw new AflTradeValuationDatasetFactualLineageError(code, message, { cause });
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function exactInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function memberMappings(candidate: AflTradeFactualReleaseCandidate) {
  const members = candidate.content.members;
  return [
    ...members.sourceCaptures.map((member) => ({
      kind: 'source_capture' as const,
      memberId: member.captureId,
      recordSha256: member.recordSha256,
    })),
    ...members.eventVersions.map((member) => ({
      kind: 'event_version' as const,
      memberId: member.eventVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.lineageEdges.map((member) => ({
      kind: 'lineage_edge' as const,
      memberId: member.edgeId,
      recordSha256: member.recordSha256,
    })),
    ...members.acquisitionSpells.map((member) => ({
      kind: 'acquisition_spell' as const,
      memberId: member.spellVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.factualRuns.map((member) => ({
      kind: 'factual_run' as const,
      memberId: member.factualRunId,
      recordSha256: member.recordSha256,
    })),
    ...members.reconciledMetrics.map((member) => ({
      kind: 'reconciled_metric' as const,
      memberId: member.reconciledFactId,
      recordSha256: member.recordSha256,
    })),
    ...members.achievementRuns.map((member) => ({
      kind: 'achievement_run' as const,
      memberId: member.achievementRunId,
      recordSha256: member.recordSha256,
    })),
    ...members.reconciledAchievements.map((member) => ({
      kind: 'reconciled_achievement' as const,
      memberId: member.reconciledAchievementId,
      recordSha256: member.recordSha256,
    })),
    ...members.spellMetrics.map((member) => ({
      kind: 'spell_metric' as const,
      memberId: member.spellMetricVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.reviewDecisions.map((member) => ({
      kind: 'review_decision' as const,
      memberId: member.decisionId,
      recordSha256: member.recordSha256,
    })),
  ].sort((left, right) =>
    `${left.kind}|${left.memberId}`.localeCompare(`${right.kind}|${right.memberId}`)
  );
}

export function createAflTradeValuationDatasetGate2DecisionKey(
  lineage: AflTradeCorpusFactualLineage
): string {
  return `gate2:${aflTradeCorpusFactualLineageSchema.parse(lineage).lineageId}`;
}

export function createAflTradeValuationDatasetGate2AffectedArtifacts(
  input: AflTradeCorpusFactualLineage
): AflTradeGovernedArtifactRef[] {
  const lineage = aflTradeCorpusFactualLineageSchema.parse(input);
  return [
    { kind: 'corpus_manifest', artifactId: lineage.content.corpusId },
    { kind: 'factual_release', artifactId: lineage.content.factualReleaseId },
    { kind: 'factual_release_candidate', artifactId: lineage.content.factualCandidateId },
    { kind: 'corpus_factual_lineage', artifactId: lineage.lineageId },
  ];
}

function exactArtifacts(
  actual: readonly AflTradeGovernedArtifactRef[],
  expected: readonly AflTradeGovernedArtifactRef[]
): boolean {
  const ordered = (values: readonly AflTradeGovernedArtifactRef[]) =>
    [...values].sort((left, right) =>
      `${left.kind}\0${left.artifactId}`.localeCompare(`${right.kind}\0${right.artifactId}`)
    );
  return exactJson(ordered(actual), ordered(expected));
}

function exactScope(
  candidate: AflTradeFactualReleaseCandidate,
  scope: AflTradeGateDecisionLedger['decisions'][number]['content']['scope']
): boolean {
  return (
    scope.scopeKey === candidate.content.scopeKey &&
    exactJson(scope.dimensions, [
      { name: 'scope', values: [candidate.content.scopeKey] },
      { name: 'competition', values: [candidate.content.competition] },
      { name: 'valid_from_season', values: [String(candidate.content.validFromSeason)] },
      { name: 'valid_through_season', values: [String(candidate.content.validThroughSeason)] },
    ])
  );
}

async function loadLedgerLocked(transaction: AflOutcomeSqlTransaction) {
  const head = await transaction.query<RevisionRow>(
    'SELECT revision FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE'
  );
  const proposals = await transaction.query<ProposalRow>(
    'SELECT proposal_json FROM outcome_gate_proposal ORDER BY proposed_at,gate,decision_key,version,proposal_id'
  );
  const decisions = await transaction.query<DecisionRow>(
    'SELECT decision_json FROM outcome_gate_decision ORDER BY version,gate,decision_key,decision_id'
  );
  if (head.rows.length !== 1) fail('GATE2_UNAVAILABLE', 'The Gate ledger head is unavailable.');
  try {
    const ledger = {
      proposals: proposals.rows.map(({ proposal_json }) =>
        aflTradeGateDecisionProposalSchema.parse(proposal_json)
      ),
      decisions: decisions.rows.map(({ decision_json }) =>
        aflTradeGateDecisionRecordSchema.parse(decision_json)
      ),
    };
    const revision = Number(head.rows[0]!.revision);
    if (revision !== ledger.decisions.length || revision < 1) {
      fail('GATE2_UNAVAILABLE', 'The Gate ledger head and authenticated decisions disagree.');
    }
    return { revision, ledger };
  } catch (cause) {
    fail('GATE2_UNAVAILABLE', 'The Gate ledger failed authentication.', cause);
  }
}

function parseAdmission(value: unknown): AflTradeValuationDatasetFactualLineageAdmission {
  if (typeof value !== 'object' || value === null) {
    fail('ADMISSION_CONFLICT', 'The retained lineage admission is not an object.');
  }
  const admission = value as AflTradeValuationDatasetFactualLineageAdmission;
  if (
    typeof admission.admissionId !== 'string' ||
    admission.content?.schemaVersion !== ADMISSION_SCHEMA_VERSION ||
    admission.admissionId !==
      createAflTradeContentAddress('corpus-factual-lineage-admission', admission.content)
  ) {
    fail('ADMISSION_CONFLICT', 'The retained lineage admission failed authentication.');
  }
  return admission;
}

async function loadCandidate(
  transaction: AflOutcomeSqlTransaction,
  factualCandidateId: string
): Promise<AflTradeFactualReleaseCandidate> {
  const result = await transaction.query<CandidateRow>(
    `SELECT candidate_id,candidate_sha256,status,finalized_at,candidate_json
       FROM outcome_factual_release_candidate
      WHERE candidate_id=$1 FOR SHARE`,
    [factualCandidateId]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row === undefined ||
    row.status !== 'approved' ||
    row.finalized_at === null
  ) {
    fail('CANDIDATE_UNAVAILABLE', 'Lineage requires one finalized factual candidate.');
  }
  try {
    const candidate = aflTradeFactualReleaseCandidateSchema.parse({
      candidateId: row.candidate_id,
      candidateSha256: row.candidate_sha256,
      content: row.candidate_json,
    });
    if (
      candidate.candidateId !== factualCandidateId ||
      candidate.content.environment === 'test_fixture' ||
      exactInstant(row.finalized_at) !== candidate.content.createdAt
    ) {
      fail(
        'CANDIDATE_UNAVAILABLE',
        'Lineage requires an exact non-fixture finalized factual candidate.'
      );
    }
    return candidate;
  } catch (cause) {
    if (cause instanceof AflTradeValuationDatasetFactualLineageError) throw cause;
    fail('CANDIDATE_UNAVAILABLE', 'The factual candidate failed authentication.', cause);
  }
}

export function selectAflTradeModelConsumedSourceFields(
  fieldUses: readonly Readonly<{ sourceField: string; use: string }>[]
): string[] {
  const requestedUsesByField = new Map<string, Set<string>>();
  for (const { sourceField, use } of fieldUses) {
    const requestedUses = requestedUsesByField.get(sourceField) ?? new Set<string>();
    requestedUses.add(use);
    requestedUsesByField.set(sourceField, requestedUses);
  }
  return [...requestedUsesByField]
    .filter(
      ([, requestedUses]) =>
        requestedUses.has('derived_feature') && requestedUses.has('model_training')
    )
    .map(([sourceField]) => sourceField)
    .sort();
}

export function parseAflTradeModelSourceSnapshotRecord(row: SnapshotRow): {
  readonly snapshotId: string;
  readonly fieldUses: readonly Readonly<{ sourceField: string; use: string }>[];
  readonly rightsProposal: AflTradeSourceRightsProposal;
  readonly environment: 'test_fixture' | 'non_production' | 'production';
  readonly capturedFields: readonly string[];
  readonly createdAt: string;
} {
  const sourceSnapshot = aflTradeSourceSnapshotManifestSchema.safeParse({
    snapshotId: row.source_snapshot_id,
    content: row.manifest_json,
  });
  if (sourceSnapshot.success) {
    return {
      snapshotId: sourceSnapshot.data.snapshotId,
      fieldUses: sourceSnapshot.data.content.gate0aReceipt.content.request.fieldUses,
      rightsProposal: sourceSnapshot.data.content.sourceRightsProposal,
      environment: sourceSnapshot.data.content.gate0aDecision.content.environment,
      capturedFields: sourceSnapshot.data.content.capturedFields,
      createdAt: sourceSnapshot.data.content.createdAt,
    };
  }
  if (
    typeof row.manifest_json !== 'object' ||
    row.manifest_json === null ||
    Array.isArray(row.manifest_json)
  ) {
    fail('CANDIDATE_UNAVAILABLE', 'A contributing source snapshot is malformed.');
  }
  const manifest = row.manifest_json as Record<string, unknown>;
  if (manifest.schemaVersion !== 'afl-trade-external-source-snapshot/v1') {
    fail('CANDIDATE_UNAVAILABLE', 'A contributing source snapshot is malformed.');
  }
  const snapshotContent = {
    schemaVersion: manifest.schemaVersion,
    provider: manifest.provider,
    dataset: manifest.dataset,
    datasetVersion: manifest.datasetVersion,
    capabilityId: manifest.capabilityId,
    competition: manifest.competition,
    anchorSeasonYear: manifest.anchorSeasonYear,
    draftPathway: manifest.draftPathway,
    sourceUrl: manifest.sourceUrl,
    sourceArtifactId: manifest.sourceArtifactId,
    sourceSha256: manifest.sourceSha256,
    parserVersion: manifest.parserVersion,
    fieldManifestSha256: manifest.fieldManifestSha256,
    effectiveAt: manifest.effectiveAt,
    capturedAt: manifest.capturedAt,
  };
  const expectedSnapshotId = createAflTradeContentAddress('source-snapshot', snapshotContent);
  let execution: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt>;
  try {
    execution = parseAflTradeExternalCaptureExecutionReceipt(manifest.executionReceipt);
  } catch (cause) {
    fail('CANDIDATE_UNAVAILABLE', 'An external source execution receipt is malformed.', cause);
  }
  if (
    execution.content.schemaVersion !== 'afl-trade-external-capture-execution/v2' ||
    manifest.sourceSnapshotId !== expectedSnapshotId ||
    row.source_snapshot_id !== expectedSnapshotId ||
    execution.content.request.provider !== manifest.provider ||
    execution.content.request.capabilityId !== manifest.capabilityId ||
    execution.content.request.parserVersion !== manifest.parserVersion ||
    execution.content.request.fieldManifestSha256 !== manifest.fieldManifestSha256 ||
    execution.content.gate0aReceipt.content.request.rightsArtifactId !==
      execution.content.sourceRights.rightsArtifactId
  ) {
    fail(
      'CANDIDATE_UNAVAILABLE',
      'An external source snapshot does not authenticate its exact execution authority.'
    );
  }
  return {
    snapshotId: expectedSnapshotId,
    fieldUses: execution.content.gate0aReceipt.content.request.fieldUses,
    rightsProposal: execution.content.sourceRights,
    environment: execution.content.gate0aReceipt.content.request.environment,
    capturedFields: [
      ...new Set(
        execution.content.gate0aReceipt.content.request.fieldUses.map(
          ({ sourceField }) => sourceField
        )
      ),
    ].sort(),
    createdAt: String(manifest.capturedAt),
  };
}

async function deriveSourceMappings(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate,
  createdAt: string
): Promise<{
  fieldSets: AflTradeConsumedFieldSet[];
  mappings: AflTradeCorpusFactualLineage['content']['sourceMappings'];
}> {
  const captureIds = candidate.content.members.sourceCaptures.map(({ captureId }) => captureId);
  const result = await transaction.query<SnapshotRow>(
    `SELECT capture_id,source_snapshot_id,manifest_json FROM outcome_source_capture
      WHERE capture_id=ANY($1::text[]) ORDER BY capture_id`,
    [captureIds]
  );
  if (result.rows.length !== captureIds.length) {
    fail('CANDIDATE_UNAVAILABLE', 'A contributing source snapshot is unavailable.');
  }
  const rows = new Map(result.rows.map((row) => [row.capture_id, row]));
  const fieldSets: AflTradeConsumedFieldSet[] = [];
  const mappings = candidate.content.members.sourceCaptures.map((member) => {
    const row = rows.get(member.captureId);
    if (row === undefined) fail('CANDIDATE_UNAVAILABLE', 'A source capture is ambiguous.');
    const snapshot = parseAflTradeModelSourceSnapshotRecord(row);
    const sourceFields = selectAflTradeModelConsumedSourceFields(snapshot.fieldUses);
    if (sourceFields.length === 0) {
      fail(
        'CANDIDATE_UNAVAILABLE',
        'A contributing source snapshot has no fields admitted for feature derivation and model training.'
      );
    }
    const fieldSet = createAflTradeConsumedFieldSet({
      schemaVersion: 'afl-trade-consumed-field-set/v1',
      captureId: member.captureId,
      sourceSnapshotId: member.sourceSnapshotId,
      createdAt,
      fields: sourceFields.map((sourceField) => ({
        sourceField,
        uses: ['derived_feature', 'model_training'] as const,
      })),
    });
    if (
      snapshot.snapshotId !== member.sourceSnapshotId ||
      fieldSet.content.fieldSetSha256 !== member.consumedFieldSetSha256
    ) {
      fail(
        'CANDIDATE_UNAVAILABLE',
        'The factual source member does not bind its exact consumed field set.'
      );
    }
    fieldSets.push(aflTradeConsumedFieldSetSchema.parse(fieldSet));
    return {
      captureId: member.captureId,
      sourceSnapshotId: member.sourceSnapshotId,
      consumedFieldSetId: fieldSet.fieldSetId,
      consumedFieldSetSha256: fieldSet.content.fieldSetSha256,
    };
  });
  return { fieldSets, mappings };
}

async function deriveDomainMappings(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
): Promise<AflTradeCorpusFactualLineage['content']['domainLineageMappings']> {
  const spellIds = candidate.content.members.acquisitionSpells.map(
    ({ spellVersionId }) => spellVersionId
  );
  const result = await transaction.query<SpellRow>(
    `SELECT spell.spell_version_id,spell.spell_id,spell.player_id,spell.club_id,
            spell.start_event_version_id,spell.start_asset_version_id,event.event_id,
            event_root.competition AS event_competition,
            event_root.season_year AS event_season_year,promotion_run.capture_id AS source_capture_id,
            asset_promotion_run.capture_id AS asset_source_capture_id,
            promotion.environment::text AS promotion_environment,
            promotion.competition AS promotion_competition
       FROM outcome_acquisition_spell_version spell
       JOIN outcome_event_version event
         ON event.event_version_id=spell.start_event_version_id
       JOIN outcome_event_asset asset
         ON asset.asset_version_id=spell.start_asset_version_id
        AND asset.event_version_id=event.event_version_id
        AND asset.player_id=spell.player_id
        AND asset.to_club_id=spell.club_id
       JOIN outcome_event event_root
         ON event_root.event_id=event.event_id
       JOIN outcome_import_row row
         ON row.import_row_id=event.source_import_row_id
       JOIN outcome_import_run run
         ON run.import_run_id=row.import_run_id
       JOIN outcome_external_canonical_promotion_import_run promotion_run
         ON promotion_run.import_run_id=run.import_run_id
        AND promotion_run.capture_id=run.capture_id
       JOIN outcome_external_canonical_promotion promotion
         ON promotion.promotion_id=promotion_run.promotion_id
        AND promotion.status='finalized'
        AND promotion.finalized_at IS NOT NULL
       JOIN outcome_external_canonical_promotion_record event_promotion_record
         ON event_promotion_record.promotion_id=promotion.promotion_id
        AND event_promotion_record.source_import_row_id=row.import_row_id
        AND event_promotion_record.canonical_record_id=event.event_version_id
        AND event_promotion_record.record_kind IN ('transaction','draft_event')
       JOIN outcome_import_row asset_row
         ON asset_row.import_row_id=asset.source_import_row_id
       JOIN outcome_import_run asset_run
         ON asset_run.import_run_id=asset_row.import_run_id
       JOIN outcome_external_canonical_promotion_import_run asset_promotion_run
         ON asset_promotion_run.import_run_id=asset_run.import_run_id
        AND asset_promotion_run.capture_id=asset_run.capture_id
        AND asset_promotion_run.promotion_id=promotion.promotion_id
       JOIN outcome_external_canonical_promotion_record asset_promotion_record
         ON asset_promotion_record.promotion_id=promotion.promotion_id
        AND asset_promotion_record.source_import_row_id=asset_row.import_row_id
        AND asset_promotion_record.canonical_record_id=asset.asset_version_id
        AND asset_promotion_record.record_kind IN ('transfer','draft_player_asset')
       JOIN outcome_external_canonical_promotion_review_head review_head
         ON review_head.candidate_id=promotion.candidate_id
        AND review_head.decision_id=promotion.approval_decision_id
        AND review_head.status='approved'
      WHERE spell.spell_version_id=ANY($1::text[])
        AND event.status='approved'
        AND asset.status='approved'
        AND row.parse_status='approved'
        AND run.import_kind='external_canonical_promotion'
        AND run.status='approved'
        AND asset_row.parse_status='approved'
        AND asset_run.import_kind='external_canonical_promotion'
        AND asset_run.status='approved'
      ORDER BY spell.spell_version_id
      FOR SHARE OF promotion,review_head`,
    [spellIds]
  );
  if (result.rows.length !== spellIds.length) {
    fail(
      'CANDIDATE_UNAVAILABLE',
      'Domain lineage lacks an authenticated finalized canonical promotion.'
    );
  }
  const candidateCaptureIds = new Set(
    candidate.content.members.sourceCaptures.map(({ captureId }) => captureId)
  );
  if (
    result.rows.some((row) => {
      const seasonYear = Number(row.event_season_year);
      return (
        !candidateCaptureIds.has(row.source_capture_id) ||
        !candidateCaptureIds.has(row.asset_source_capture_id) ||
        row.promotion_environment !== candidate.content.environment ||
        row.promotion_competition !== candidate.content.competition ||
        row.event_competition !== candidate.content.competition ||
        !Number.isSafeInteger(seasonYear) ||
        seasonYear < candidate.content.validFromSeason ||
        seasonYear > candidate.content.validThroughSeason
      );
    })
  ) {
    fail('CANDIDATE_UNAVAILABLE', 'Promoted domain lineage falls outside the factual scope.');
  }
  const eventIds = [...new Set(result.rows.map(({ event_id }) => event_id))].sort();
  const edgeResult = await transaction.query<EdgeRow>(
    `SELECT edge_id,event_id FROM outcome_pick_lineage_edge
      WHERE event_id=ANY($1::text[]) ORDER BY edge_id`,
    [eventIds]
  );
  const candidateEvents = new Map(
    candidate.content.members.eventVersions.map((member) => [member.eventVersionId, member])
  );
  const candidateSpells = new Map(
    candidate.content.members.acquisitionSpells.map((member) => [member.spellVersionId, member])
  );
  const candidateEdges = new Set(
    candidate.content.members.lineageEdges.map(({ edgeId }) => edgeId)
  );
  const representedEdges = new Set<string>();
  const representedEventVersions = new Set<string>();
  const mappings = result.rows.map((row) => {
    const event = candidateEvents.get(row.start_event_version_id);
    const spell = candidateSpells.get(row.spell_version_id);
    const lineageEdgeIds = edgeResult.rows
      .filter(({ event_id, edge_id }) => event_id === row.event_id && candidateEdges.has(edge_id))
      .map(({ edge_id }) => edge_id)
      .sort();
    lineageEdgeIds.forEach((edgeId) => representedEdges.add(edgeId));
    if (
      event === undefined ||
      spell === undefined ||
      event.eventId !== row.event_id ||
      spell.spellId !== row.spell_id ||
      spell.playerId !== row.player_id ||
      spell.clubId !== row.club_id
    ) {
      fail('CANDIDATE_UNAVAILABLE', 'Factual and canonical domain lineage disagree.');
    }
    representedEventVersions.add(row.start_event_version_id);
    return {
      eventId: row.event_id,
      eventVersionId: row.start_event_version_id,
      acquisitionSpellId: row.spell_id,
      acquisitionSpellVersionId: row.spell_version_id,
      playerId: row.player_id,
      clubId: row.club_id,
      lineageEdgeIds,
    };
  });
  if (
    candidateSpells.size !== mappings.length ||
    candidateEvents.size !== representedEventVersions.size ||
    [...candidateEvents.keys()].some(
      (eventVersionId) => !representedEventVersions.has(eventVersionId)
    ) ||
    candidateEdges.size !== representedEdges.size
  ) {
    fail('CANDIDATE_UNAVAILABLE', 'Factual domain lineage is not exhaustively represented.');
  }
  return mappings.sort((left, right) =>
    `${left.eventVersionId}|${left.acquisitionSpellVersionId}`.localeCompare(
      `${right.eventVersionId}|${right.acquisitionSpellVersionId}`
    )
  );
}

export async function hasCurrentAflTradeValuationDatasetDomainProvenance(
  transaction: AflOutcomeSqlTransaction,
  input: { factualCandidateId: string; lineageId: string }
): Promise<boolean> {
  try {
    let stored = await transaction.query<LineageRow>(
      `SELECT lineage_json FROM outcome_valuation_dataset_factual_lineage
        WHERE lineage_id=$1 AND candidate_id=$2 FOR SHARE`,
      [input.lineageId, input.factualCandidateId]
    );
    if (stored.rows.length === 0) {
      stored = await transaction.query<LineageRow>(
        `SELECT lineage_json FROM outcome_corpus_factual_lineage
          WHERE lineage_id=$1 AND candidate_id=$2 FOR SHARE`,
        [input.lineageId, input.factualCandidateId]
      );
    }
    if (stored.rows.length !== 1) return false;
    const lineage = aflTradeCorpusFactualLineageSchema.parse(stored.rows[0]!.lineage_json);
    if (lineage.content.factualCandidateId !== input.factualCandidateId) return false;
    const candidate = await loadCandidate(transaction, input.factualCandidateId);
    const currentMappings = await deriveDomainMappings(transaction, candidate);
    return exactJson(currentMappings, lineage.content.domainLineageMappings);
  } catch {
    return false;
  }
}

export class PostgresAflTradeValuationDatasetFactualLineageRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async stage(input: { factualCandidateId: string; createdAt: string }) {
    if (
      !/^factual-release-candidate:[a-f0-9]{64}$/.test(input.factualCandidateId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt)
    ) {
      fail('INVALID_INPUT', 'Private factual lineage staging input is invalid.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `valuation-dataset-lineage:${input.factualCandidateId}`,
      ]);
      const candidate = await loadCandidate(transaction, input.factualCandidateId);
      if (Date.parse(input.createdAt) < Date.parse(candidate.content.createdAt)) {
        fail('INVALID_INPUT', 'Lineage creation cannot predate factual finalization.');
      }
      const source = await deriveSourceMappings(transaction, candidate, input.createdAt);
      const domainLineageMappings = await deriveDomainMappings(transaction, candidate);
      const corpusId = createAflTradeContentAddress('corpus', {
        schemaVersion: 'afl-trade-private-factual-corpus/v1',
        factualReleaseId: candidate.content.targetRelease.id,
        factualCandidateId: candidate.candidateId,
        sourceMemberSetSha256: candidate.content.memberSetSha256,
      });
      const lineage = createAflTradeCorpusFactualLineage({
        schemaVersion: 'afl-trade-corpus-factual-lineage/v2',
        environment: candidate.content.environment,
        scopeKey: candidate.content.scopeKey,
        competition: candidate.content.competition,
        createdAt: input.createdAt,
        corpusId,
        factualReleaseId: candidate.content.targetRelease.id,
        factualCandidateId: candidate.candidateId,
        sourceMemberSetSha256: candidate.content.memberSetSha256,
        memberMappings: memberMappings(candidate),
        sourceMappings: source.mappings,
        domainLineageMappings,
      });
      const replay = await transaction.query<LineageRow>(
        `SELECT lineage_json FROM outcome_valuation_dataset_factual_lineage
          WHERE lineage_id=$1 FOR SHARE`,
        [lineage.lineageId]
      );
      if (replay.rows.length > 0) {
        if (replay.rows.length !== 1 || !exactJson(replay.rows[0]?.lineage_json, lineage)) {
          fail('LINEAGE_CONFLICT', 'The lineage identity already names different content.');
        }
        return {
          lineage,
          decisionKey: createAflTradeValuationDatasetGate2DecisionKey(lineage),
          affectedArtifacts: createAflTradeValuationDatasetGate2AffectedArtifacts(lineage),
          idempotentReplay: true,
        } as const;
      }
      for (const fieldSet of source.fieldSets) {
        await requireOrInsertAflTradeValuationDatasetFieldSet(transaction, fieldSet);
      }
      await transaction.query(
        `INSERT INTO outcome_valuation_dataset_factual_lineage
          (lineage_id,corpus_id,release_id,candidate_id,environment,scope_key,competition,
           source_member_set_sha256,created_at,lineage_canonical_json,lineage_json)
         VALUES ($1,$2,$3,$4,$5::"OutcomeEnvironment",$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          lineage.lineageId,
          lineage.content.corpusId,
          lineage.content.factualReleaseId,
          lineage.content.factualCandidateId,
          lineage.content.environment,
          lineage.content.scopeKey,
          lineage.content.competition,
          lineage.content.sourceMemberSetSha256,
          lineage.content.createdAt,
          canonicalizeAflTradeJson(lineage.content),
          canonicalizeAflTradeJson(lineage),
        ]
      );
      return {
        lineage,
        decisionKey: createAflTradeValuationDatasetGate2DecisionKey(lineage),
        affectedArtifacts: createAflTradeValuationDatasetGate2AffectedArtifacts(lineage),
        idempotentReplay: false,
      } as const;
    });
  }

  async admit(input: { lineageId: string; evaluatedAt: string }) {
    if (
      !/^corpus-factual-lineage:[a-f0-9]{64}$/.test(input.lineageId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.evaluatedAt)
    ) {
      fail('INVALID_INPUT', 'Private factual lineage admission input is invalid.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `valuation-dataset-lineage-admission:${input.lineageId}`,
      ]);
      const stored = await transaction.query<LineageRow>(
        `SELECT lineage_json FROM outcome_valuation_dataset_factual_lineage
          WHERE lineage_id=$1 FOR SHARE`,
        [input.lineageId]
      );
      if (stored.rows.length !== 1) {
        fail('CANDIDATE_UNAVAILABLE', 'The exact staged private factual lineage is unavailable.');
      }
      const lineage = aflTradeCorpusFactualLineageSchema.parse(stored.rows[0]!.lineage_json);
      const candidate = await loadCandidate(transaction, lineage.content.factualCandidateId);
      if (
        !(await hasCurrentAflTradeValuationDatasetDomainProvenance(transaction, {
          factualCandidateId: lineage.content.factualCandidateId,
          lineageId: lineage.lineageId,
        }))
      ) {
        fail(
          'CANDIDATE_UNAVAILABLE',
          'The staged lineage no longer has current canonical-promotion authority.'
        );
      }
      const authority = await loadLedgerLocked(transaction);
      const decisionKey = createAflTradeValuationDatasetGate2DecisionKey(lineage);
      const resolution = resolveAflTradeGateEligibility(authority.ledger, {
        gate: 'gate_2_corpus_lineage',
        decisionKey,
        environment: lineage.content.environment,
        evaluatedAt: input.evaluatedAt,
      });
      if (resolution.status !== 'mechanically_eligible' || resolution.decision === null) {
        fail('GATE2_UNAVAILABLE', 'The exact Gate 2 decision is not currently eligible.');
      }
      const decision = resolution.decision;
      const proposal = authority.ledger.proposals.find(
        ({ proposalId }) => proposalId === decision.content.proposalId
      );
      const expectedArtifacts = createAflTradeValuationDatasetGate2AffectedArtifacts(lineage);
      if (
        proposal === undefined ||
        !exactArtifacts(proposal.content.affectedArtifacts, expectedArtifacts) ||
        !exactArtifacts(decision.content.affectedArtifacts, expectedArtifacts) ||
        !exactScope(candidate, proposal.content.scope) ||
        !exactScope(candidate, decision.content.scope) ||
        Date.parse(proposal.content.proposedAt) < Date.parse(lineage.content.createdAt) ||
        decision.content.decidedAt === null ||
        decision.content.effectiveAt === null ||
        decision.content.revalidateAt === null ||
        Date.parse(decision.content.decidedAt) < Date.parse(proposal.content.proposedAt) ||
        Date.parse(decision.content.decidedAt) > Date.parse(input.evaluatedAt) ||
        Date.parse(decision.content.revalidateAt) <= Date.parse(input.evaluatedAt)
      ) {
        fail('GATE2_UNAVAILABLE', 'Gate 2 scope, artifacts, or chronology do not match lineage.');
      }
      const content = {
        schemaVersion: ADMISSION_SCHEMA_VERSION,
        authorityBoundary: ADMISSION_AUTHORITY_BOUNDARY,
        publicationEligible: false as const,
        environment: lineage.content.environment,
        scopeKey: lineage.content.scopeKey,
        competition: lineage.content.competition,
        validFromSeason: candidate.content.validFromSeason,
        validThroughSeason: candidate.content.validThroughSeason,
        lineageId: lineage.lineageId,
        corpusId: lineage.content.corpusId,
        factualReleaseId: lineage.content.factualReleaseId,
        factualCandidateId: lineage.content.factualCandidateId,
        sourceMemberSetSha256: lineage.content.sourceMemberSetSha256,
        gate2DecisionKey: decisionKey,
        gateProposalId: proposal.proposalId,
        gateDecisionId: decision.decisionId,
        gateDecisionVersion: decision.content.version,
        gateLedgerRevision: authority.revision,
        admittedAt: input.evaluatedAt,
        effectiveAt: decision.content.effectiveAt,
        revalidateAt: decision.content.revalidateAt,
      };
      const admission: AflTradeValuationDatasetFactualLineageAdmission = {
        admissionId: createAflTradeContentAddress('corpus-factual-lineage-admission', content),
        content,
      };
      const replay = await transaction.query<AdmissionRow>(
        `SELECT admission_json FROM outcome_valuation_dataset_factual_lineage_admission
          WHERE lineage_id=$1 FOR SHARE`,
        [lineage.lineageId]
      );
      if (replay.rows.length > 0) {
        const retained = parseAdmission(replay.rows[0]?.admission_json);
        if (replay.rows.length !== 1 || retained.content.gateDecisionId !== decision.decisionId) {
          fail('ADMISSION_CONFLICT', 'The lineage already binds a different Gate 2 authority.');
        }
        return { admission: retained, idempotentReplay: true } as const;
      }
      await transaction.query(
        `INSERT INTO outcome_valuation_dataset_factual_lineage_admission
          (admission_id,lineage_id,gate_proposal_id,gate_decision_id,gate_ledger_revision,
           admitted_at,revalidate_at,admission_canonical_json,admission_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          admission.admissionId,
          lineage.lineageId,
          admission.content.gateProposalId,
          admission.content.gateDecisionId,
          admission.content.gateLedgerRevision,
          admission.content.admittedAt,
          admission.content.revalidateAt,
          canonicalizeAflTradeJson(admission.content),
          canonicalizeAflTradeJson(admission),
        ]
      );
      return { admission, idempotentReplay: false } as const;
    });
  }
}
