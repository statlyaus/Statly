import {
  aflTradeConsumedFieldSetSchema,
  aflTradeCorpusFactualLineageSchema,
  aflTradeDatasetOperationAuthorizationSchema,
  listAflTradeValuationDatasetArtifactMemberships,
  type AflTradeCorpusFactualLineage,
} from '../artifacts/valuationDatasetAdmissionContracts';
import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { aflTradeFactualReleaseCandidateSchema } from '../outcomes/factualReleaseCandidateContracts';
import type { AflDraftTradeOutcomeReleaseRepository } from '../outcomes/outcomeReleaseRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeGate0AReceiptSchema } from '../source/gate0aReceipt';
import { aflTradeProviderResolutionDecisionSchema } from '../source/providerResolutionContracts';
import {
  AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION,
  type AflTradeValuationDatasetAdmissionEvidenceAuthenticator,
} from './valuationDatasetAdmission';
import { parseAflTradeModelSourceSnapshotRecord } from './postgresValuationDatasetFactualLineageRepository';

const MAXIMUM_DATASET_ARTIFACT_BYTES = 128 * 1024 * 1024;

interface ExactArtifactLoader {
  loadExactWithObservation(
    reference: AflTradeArtifactRef,
    maximumBytes: number
  ): Promise<{ bytes: Uint8Array } | null>;
}

interface FactualCandidateRow extends Record<string, unknown> {
  candidate_id: string;
  candidate_sha256: string;
  candidate_json: unknown;
  finalized_at: Date | string | null;
}

interface LineageRow extends Record<string, unknown> {
  lineage_json: unknown;
  gate2_decision_key: string;
}

interface FieldSetRow extends Record<string, unknown> {
  field_set_json: unknown;
}

interface CaptureRow extends Record<string, unknown> {
  capture_id: string;
  source_snapshot_id: string;
  manifest_json: unknown;
}

interface EvaluationRow extends Record<string, unknown> {
  operation_kind: 'derived_feature_creation' | 'model_training';
  receipt_json: unknown;
}

interface OperationAuthorityRow extends Record<string, unknown> {
  authority_kind: 'analytical_authority' | 'operational_authorization';
  receipt_json: unknown;
}

interface IdentityAuthorityRow extends Record<string, unknown> {
  entity_kind: 'player' | 'club';
  entity_id: string;
  decision_json: unknown;
  resolution_case_id: string;
  resolution_revision: number | string;
  resolution_id: string;
  resolution_updated_at: Date | string;
  assignment_case_id: string;
  assignment_entity_kind: 'player' | 'club' | 'club_alias';
  assignment_identity_id: string;
  assignment_revision: number | string;
  assignment_decision_id: string;
  assignment_status: string;
  assignment_updated_at: Date | string;
}

interface EventRow extends Record<string, unknown> {
  event_version_id: string;
  event_id: string;
}

interface SpellRow extends Record<string, unknown> {
  spell_version_id: string;
  spell_id: string;
  player_id: string;
  club_id: string;
  start_event_version_id: string;
}

interface EdgeRow extends Record<string, unknown> {
  edge_id: string;
}

function exactInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireOne<Row>(rows: readonly Row[], description: string): Row {
  if (rows.length !== 1) {
    throw new Error(`Valuation dataset authentication requires one exact ${description}.`);
  }
  return rows[0];
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function loadFactualParents(
  sql: AflOutcomeSqlClient,
  factualCandidateId: string,
  lineageId: string
) {
  const candidateResult = await sql.query<FactualCandidateRow>(
    `SELECT candidate_id,candidate_sha256,candidate_json,finalized_at
       FROM outcome_factual_release_candidate
      WHERE candidate_id=$1 AND status='approved' AND finalized_at IS NOT NULL`,
    [factualCandidateId]
  );
  const candidateRow = requireOne(candidateResult.rows, 'finalized factual candidate');
  const factualCandidate = aflTradeFactualReleaseCandidateSchema.parse({
    candidateId: candidateRow.candidate_id,
    candidateSha256: candidateRow.candidate_sha256,
    content: candidateRow.candidate_json,
  });
  const lineageResult = await sql.query<LineageRow>(
    `SELECT lineage.lineage_json,decision.decision_key AS gate2_decision_key
       FROM outcome_valuation_dataset_factual_lineage lineage
       JOIN outcome_valuation_dataset_factual_lineage_admission admission
         ON admission.lineage_id=lineage.lineage_id
       JOIN outcome_gate_decision decision
         ON decision.decision_id=admission.gate_decision_id
      WHERE lineage.lineage_id=$1
        AND decision.state='approved'
        AND NOT EXISTS (
          SELECT 1 FROM outcome_gate_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id)
      UNION ALL
     SELECT lineage.lineage_json,decision.decision_key AS gate2_decision_key
       FROM outcome_corpus_factual_lineage lineage
       JOIN outcome_corpus_factual_lineage_admission admission
         ON admission.lineage_id=lineage.lineage_id
       JOIN outcome_gate_decision decision
         ON decision.decision_id=admission.gate_decision_id
      WHERE lineage.lineage_id=$1
        AND decision.state='approved'
        AND NOT EXISTS (
          SELECT 1 FROM outcome_gate_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id)`,
    [lineageId]
  );
  const lineageRow = requireOne(lineageResult.rows, 'corpus-to-factual lineage');
  return {
    factualCandidate,
    factualCandidateFinalizedAt: exactInstant(candidateRow.finalized_at!),
    corpusLineage: aflTradeCorpusFactualLineageSchema.parse(lineageRow.lineage_json),
    gate2DecisionKey: lineageRow.gate2_decision_key,
  };
}

async function loadSourceAuthority(
  sql: AflOutcomeSqlClient,
  lineage: AflTradeCorpusFactualLineage,
  datasetCreatedAt: string,
  admittedAt: string,
  gateLedger: Awaited<ReturnType<AflTradeGateDecisionLedgerRepository['load']>>['ledger']
) {
  const mappings = lineage.content.sourceMappings;
  const fieldSetIds = uniqueValues(mappings.map(({ consumedFieldSetId }) => consumedFieldSetId));
  const captureIds = uniqueValues(mappings.map(({ captureId }) => captureId));
  const fieldSetResult = await sql.query<FieldSetRow>(
    `SELECT field_set_json
       FROM outcome_valuation_dataset_consumed_field_set
      WHERE field_set_id=ANY($1::text[])
      ORDER BY field_set_id`,
    [fieldSetIds]
  );
  const fieldSets = fieldSetResult.rows.map(({ field_set_json }) =>
    aflTradeConsumedFieldSetSchema.parse(field_set_json)
  );
  if (fieldSets.length !== fieldSetIds.length) {
    throw new Error('Valuation dataset authentication is missing a consumed field set.');
  }
  const capturesResult = await sql.query<CaptureRow>(
    `SELECT capture_id,source_snapshot_id,manifest_json
       FROM outcome_source_capture
      WHERE capture_id=ANY($1::text[])
      ORDER BY capture_id`,
    [captureIds]
  );
  if (capturesResult.rows.length !== captureIds.length) {
    throw new Error('Valuation dataset authentication is missing a contributing source capture.');
  }
  const captures = new Map(
    capturesResult.rows.map((row) => {
      const snapshot = parseAflTradeModelSourceSnapshotRecord(row);
      return [
        row.capture_id,
        {
          ...snapshot,
          sourceSnapshotManifest: {
            snapshotId: snapshot.snapshotId,
            content: {
              capturedFields: [...snapshot.capturedFields],
              createdAt: snapshot.createdAt,
            },
          },
        },
      ] as const;
    })
  );
  const sourceRights = [];
  for (const mapping of mappings) {
    const snapshot = captures.get(mapping.captureId);
    if (!snapshot || snapshot.snapshotId !== mapping.sourceSnapshotId) {
      throw new Error('Valuation dataset source capture and lineage do not match.');
    }
    const rightsArtifactId = snapshot.rightsProposal.rightsArtifactId;
    const evaluations = await sql.query<EvaluationRow>(
      `SELECT operation_kind,receipt_json
         FROM outcome_valuation_dataset_gate0_evaluation
        WHERE rights_artifact_id=$1
          AND environment=$2::"OutcomeEnvironment"
          AND ((operation_kind='derived_feature_creation' AND evaluated_at<=$3)
            OR (operation_kind='model_training' AND evaluated_at=$4))
        ORDER BY operation_kind,evaluated_at DESC`,
      [rightsArtifactId, snapshot.environment, datasetCreatedAt, admittedAt]
    );
    const derivationRows = evaluations.rows.filter(
      ({ operation_kind }) => operation_kind === 'derived_feature_creation'
    );
    const admissionRows = evaluations.rows.filter(
      ({ operation_kind }) => operation_kind === 'model_training'
    );
    if (derivationRows.length === 0) {
      throw new Error(
        'Valuation dataset authentication requires a derived-feature Gate 0A evaluation.'
      );
    }
    const derivationReceipt = aflTradeGate0AReceiptSchema.parse(derivationRows[0].receipt_json);
    const admissionReceipt = aflTradeGate0AReceiptSchema.parse(
      requireOne(admissionRows, 'model-training Gate 0A evaluation').receipt_json
    );
    sourceRights.push({
      captureId: mapping.captureId,
      sourceSnapshotId: mapping.sourceSnapshotId,
      consumedFieldSetId: mapping.consumedFieldSetId,
      sourceSnapshotManifest: snapshot.sourceSnapshotManifest,
      rightsProposal: snapshot.rightsProposal,
      derivationReceipt,
      admissionReceipt,
      gateLedger,
    });
  }
  return { consumedFieldSets: fieldSets, sourceRights };
}

async function loadOperationAuthorities(
  sql: AflOutcomeSqlClient,
  datasetId: string,
  admittedAt: string
) {
  const result = await sql.query<OperationAuthorityRow>(
    `SELECT authority_kind,receipt_json
       FROM outcome_valuation_dataset_operation_authority
      WHERE dataset_id=$1 AND valid_through>$2
      ORDER BY authority_kind`,
    [datasetId, admittedAt]
  );
  const analytical = result.rows.filter(
    ({ authority_kind }) => authority_kind === 'analytical_authority'
  );
  const operational = result.rows.filter(
    ({ authority_kind }) => authority_kind === 'operational_authorization'
  );
  return {
    analyticalAuthority: aflTradeDatasetOperationAuthorizationSchema.parse(
      requireOne(analytical, 'analytical operation authority').receipt_json
    ),
    operationalAuthorization: aflTradeDatasetOperationAuthorizationSchema.parse(
      requireOne(operational, 'operational authorization').receipt_json
    ),
  };
}

async function loadIdentityAuthority(
  sql: AflOutcomeSqlClient,
  entityKind: 'player' | 'club',
  decisionIds: readonly string[],
  authenticatedAt: string
) {
  if (decisionIds.length === 0) return [];
  const isPlayer = entityKind === 'player';
  const table = isPlayer
    ? 'outcome_provider_player_resolution'
    : 'outcome_provider_club_resolution';
  const head = isPlayer
    ? 'outcome_provider_player_resolution_head'
    : 'outcome_provider_club_resolution_head';
  const entityColumn = isPlayer ? 'player_id' : 'club_id';
  const result = await sql.query<IdentityAuthorityRow>(
    `SELECT '${entityKind}' AS entity_kind,resolution.${entityColumn} AS entity_id,
            resolution.decision_json,resolution.resolution_case_id,
            resolution_head.revision AS resolution_revision,
            resolution_head.resolution_id,resolution_head.updated_at AS resolution_updated_at,
            assignment.assignment_case_id,assignment.entity_kind AS assignment_entity_kind,
            assignment.identity_id AS assignment_identity_id,assignment.revision AS assignment_revision,
            assignment.decision_id AS assignment_decision_id,
            assignment.status AS assignment_status,assignment.updated_at AS assignment_updated_at
       FROM ${table} resolution
       JOIN ${head} resolution_head
         ON resolution_head.resolution_case_id=resolution.resolution_case_id
        AND resolution_head.resolution_id=resolution.resolution_id
       JOIN outcome_provider_identity_assignment_head assignment
         ON assignment.assignment_case_id=resolution.assignment_case_id
        AND assignment.decision_id=resolution.decision_id
      WHERE resolution.decision_id=ANY($1::text[])
        AND resolution.${entityColumn} IS NOT NULL
      ORDER BY resolution.decision_id`,
    [decisionIds]
  );
  if (result.rows.length !== decisionIds.length) {
    throw new Error(
      `Valuation dataset authentication is missing a current ${entityKind} authority.`
    );
  }
  return result.rows.map((row) => ({
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    decision: aflTradeProviderResolutionDecisionSchema.parse(row.decision_json),
    resolutionHead: {
      resolutionCaseId: row.resolution_case_id,
      revision: Number(row.resolution_revision),
      resolutionId: row.resolution_id,
      updatedAt: exactInstant(row.resolution_updated_at),
    },
    assignmentHead: {
      assignmentCaseId: row.assignment_case_id,
      entityKind: row.assignment_entity_kind,
      identityId: row.assignment_identity_id,
      revision: Number(row.assignment_revision),
      decisionId: row.assignment_decision_id,
      status: row.assignment_status,
      updatedAt: exactInstant(row.assignment_updated_at),
    },
    authenticatedAt,
  }));
}

async function loadDomainAuthority(
  sql: AflOutcomeSqlClient,
  factualCandidate: ReturnType<typeof aflTradeFactualReleaseCandidateSchema.parse>,
  lineage: AflTradeCorpusFactualLineage,
  authenticatedAt: string
) {
  const mappings = lineage.content.domainLineageMappings;
  const eventIds = uniqueValues(mappings.map(({ eventVersionId }) => eventVersionId));
  const spellIds = uniqueValues(
    mappings.map(({ acquisitionSpellVersionId }) => acquisitionSpellVersionId)
  );
  const edgeIds = uniqueValues(mappings.flatMap(({ lineageEdgeIds }) => lineageEdgeIds));
  const [eventResult, spellResult, edgeResult] = await Promise.all([
    sql.query<EventRow>(
      `SELECT event_version_id,event_id FROM outcome_event_version
        WHERE event_version_id=ANY($1::text[]) ORDER BY event_version_id`,
      [eventIds]
    ),
    sql.query<SpellRow>(
      `SELECT spell_version_id,spell_id,player_id,club_id,start_event_version_id
         FROM outcome_acquisition_spell_version
        WHERE spell_version_id=ANY($1::text[]) ORDER BY spell_version_id`,
      [spellIds]
    ),
    edgeIds.length === 0
      ? Promise.resolve({ rows: [] as EdgeRow[], rowCount: 0 })
      : sql.query<EdgeRow>(
          `SELECT edge_id FROM outcome_pick_lineage_edge
            WHERE edge_id=ANY($1::text[]) ORDER BY edge_id`,
          [edgeIds]
        ),
  ]);
  if (
    eventResult.rows.length !== eventIds.length ||
    spellResult.rows.length !== spellIds.length ||
    edgeResult.rows.length !== edgeIds.length
  ) {
    throw new Error('Valuation dataset authentication is missing canonical domain lineage.');
  }
  const events = new Map(eventResult.rows.map((row) => [row.event_version_id, row]));
  const spells = new Map(spellResult.rows.map((row) => [row.spell_version_id, row]));
  const candidateEvents = new Map(
    factualCandidate.content.members.eventVersions.map((member: any) => [
      member.eventVersionId,
      member,
    ])
  );
  const candidateEdges = new Map(
    factualCandidate.content.members.lineageEdges.map((member: any) => [member.edgeId, member])
  );
  return mappings.map((mapping) => {
    const event = events.get(mapping.eventVersionId);
    const spell = spells.get(mapping.acquisitionSpellVersionId);
    const eventMember: any = candidateEvents.get(mapping.eventVersionId);
    if (
      !event ||
      !spell ||
      !eventMember ||
      event.event_id !== mapping.eventId ||
      spell.spell_id !== mapping.acquisitionSpellId ||
      spell.player_id !== mapping.playerId ||
      spell.club_id !== mapping.clubId ||
      spell.start_event_version_id !== mapping.eventVersionId
    ) {
      throw new Error('Valuation dataset domain mapping does not match canonical rows.');
    }
    return {
      eventVersionId: mapping.eventVersionId,
      eventId: mapping.eventId,
      eventRecordSha256: eventMember.recordSha256,
      acquisitionSpellId: mapping.acquisitionSpellId,
      acquisitionSpellVersionId: mapping.acquisitionSpellVersionId,
      playerId: mapping.playerId,
      clubId: mapping.clubId,
      lineageEdges: mapping.lineageEdgeIds.map((edgeId) => {
        const edge: any = candidateEdges.get(edgeId);
        if (!edge)
          throw new Error('Valuation dataset lineage edge is not a sealed factual member.');
        return { edgeId, recordSha256: edge.recordSha256 };
      }),
      authenticatedAt,
    };
  });
}

async function loadArtifactBytes(
  loader: ExactArtifactLoader,
  dataset: Parameters<
    AflTradeValuationDatasetAdmissionEvidenceAuthenticator['authenticate']
  >[0]['dataset']
) {
  const references = new Map(
    listAflTradeValuationDatasetArtifactMemberships(dataset).map(({ reference }) => [
      reference.artifactId,
      reference,
    ])
  );
  const retained = [];
  for (const reference of references.values()) {
    const loaded = await loader.loadExactWithObservation(reference, MAXIMUM_DATASET_ARTIFACT_BYTES);
    if (loaded === null) {
      throw new Error(`The retained artifact ${reference.artifactId} is unavailable.`);
    }
    retained.push({ artifactId: reference.artifactId, bytes: loaded.bytes });
  }
  return retained;
}

export function createPostgresAflTradeValuationDatasetEvidenceAuthenticator(dependencies: {
  sql: AflOutcomeSqlClient;
  releaseRepository: Pick<AflDraftTradeOutcomeReleaseRepository, 'loadRegistry'>;
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  artifactRepository: ExactArtifactLoader;
}): AflTradeValuationDatasetAdmissionEvidenceAuthenticator {
  return {
    async authenticate({ dataset, admittedAt }) {
      const parent = dataset.content.factualParent;
      const [factual, releaseRegistry, gateState, operationAuthority, artifactBytes] =
        await Promise.all([
          loadFactualParents(
            dependencies.sql,
            parent.factualCandidateId,
            parent.corpusToCandidateLineageId
          ),
          dependencies.releaseRepository.loadRegistry(),
          dependencies.gateRepository.load(),
          loadOperationAuthorities(dependencies.sql, dataset.datasetId, admittedAt),
          loadArtifactBytes(dependencies.artifactRepository, dataset),
        ]);
      const sourceAuthority = await loadSourceAuthority(
        dependencies.sql,
        factual.corpusLineage,
        dataset.content.createdAt,
        admittedAt,
        gateState.ledger
      );
      const playerDecisionIds = uniqueValues(
        dataset.content.rows.map(({ content }) => content.identity.playerResolutionDecisionId)
      );
      const clubDecisionIds = uniqueValues(
        dataset.content.rows.map(({ content }) => content.identity.clubResolutionDecisionId)
      );
      const [playerAuthorities, clubAuthorities, domainLineageAuthorities] = await Promise.all([
        loadIdentityAuthority(
          dependencies.sql,
          'player',
          playerDecisionIds,
          dataset.content.createdAt
        ),
        loadIdentityAuthority(dependencies.sql, 'club', clubDecisionIds, dataset.content.createdAt),
        loadDomainAuthority(
          dependencies.sql,
          factual.factualCandidate,
          factual.corpusLineage,
          dataset.content.createdAt
        ),
      ]);
      return {
        schemaVersion: AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION,
        authenticatedAt: admittedAt,
        factualCandidate: factual.factualCandidate,
        factualCandidateFinalizedAt: factual.factualCandidateFinalizedAt,
        releaseRegistry,
        corpusLineage: factual.corpusLineage,
        consumedFieldSets: sourceAuthority.consumedFieldSets,
        gate2Ledger: gateState.ledger,
        gate2DecisionKey: factual.gate2DecisionKey,
        sourceRights: sourceAuthority.sourceRights,
        identityAuthorities: [...playerAuthorities, ...clubAuthorities],
        domainLineageAuthorities,
        rowAuthorities: dataset.content.rows.map((row) => ({
          rowId: row.rowId,
          identity: row.content.identity,
          eventId: row.content.lineage.eventId,
          eventVersionId: row.content.lineage.eventVersionId,
          acquisitionSpellId: row.content.lineage.acquisitionSpellId,
          acquisitionSpellVersionId: row.content.lineage.acquisitionSpellVersionId,
          lineageEdgeIds: row.content.lineage.lineageEdgeIds,
        })),
        artifactBytes,
        analyticalAuthority: operationAuthority.analyticalAuthority,
        operationalAuthorization: operationAuthority.operationalAuthorization,
      };
    },
  };
}
