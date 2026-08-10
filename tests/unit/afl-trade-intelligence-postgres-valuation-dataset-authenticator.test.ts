import { describe, expect, it, vi } from 'vitest';

const digest = (character: string) => character.repeat(64);
const id = (prefix: string, character: string) => `${prefix}:${digest(character)}`;
const createdAt = '2026-08-09T00:00:00.000Z';
const admittedAt = '2026-08-09T01:00:00.000Z';

vi.mock('@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts', () => ({
  AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION:
    'afl-trade-dataset-admission-evidence/v5',
  aflTradeConsumedFieldSetSchema: { parse: (value: unknown) => value },
  aflTradeCorpusFactualLineageSchema: { parse: (value: unknown) => value },
  aflTradeDatasetOperationAuthorizationSchema: { parse: (value: unknown) => value },
  listAflTradeValuationDatasetArtifactMemberships: (dataset: any) => [
    { role: 'dataset', ordinal: 1, reference: dataset.content.datasetArtifact },
  ],
}));
vi.mock('@/server/aflTradeIntelligence/outcomes/factualReleaseCandidateContracts', () => ({
  aflTradeFactualReleaseCandidateSchema: { parse: (value: unknown) => value },
}));
vi.mock('@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest', () => ({
  aflTradeSourceSnapshotManifestSchema: { parse: (value: unknown) => value },
}));
vi.mock('@/server/aflTradeIntelligence/source/gate0aReceipt', () => ({
  aflTradeGate0AReceiptSchema: { parse: (value: unknown) => value },
}));
vi.mock('@/server/aflTradeIntelligence/source/providerResolutionContracts', () => ({
  aflTradeProviderResolutionDecisionSchema: { parse: (value: unknown) => value },
}));

import { createPostgresAflTradeValuationDatasetEvidenceAuthenticator } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetEvidenceAuthenticator';

const factualCandidate = {
  candidateId: id('factual-release-candidate', '1'),
  content: {
    members: {
      sourceCaptures: [
        {
          captureId: 'capture-1',
          sourceSnapshotId: id('source-snapshot', '2'),
          consumedFieldSetSha256: digest('3'),
        },
      ],
      eventVersions: [
        { eventVersionId: 'event-version-1', eventId: 'event-1', recordSha256: digest('4') },
      ],
      acquisitionSpells: [
        {
          spellVersionId: id('spell-version', '5'),
          spellId: 'spell-1',
          playerId: 'player-1',
          clubId: 'club-1',
        },
      ],
      lineageEdges: [{ edgeId: id('lineage-edge', '6'), recordSha256: digest('7') }],
    },
  },
};

const corpusLineage = {
  lineageId: id('corpus-factual-lineage', '8'),
  content: {
    sourceMappings: [
      {
        captureId: 'capture-1',
        sourceSnapshotId: id('source-snapshot', '2'),
        consumedFieldSetId: id('consumed-field-set', '9'),
      },
    ],
    domainLineageMappings: [
      {
        eventId: 'event-1',
        eventVersionId: 'event-version-1',
        acquisitionSpellId: 'spell-1',
        acquisitionSpellVersionId: id('spell-version', '5'),
        playerId: 'player-1',
        clubId: 'club-1',
        lineageEdgeIds: [id('lineage-edge', '6')],
      },
    ],
  },
};

const dataset = {
  datasetId: id('dataset', 'a'),
  content: {
    createdAt,
    datasetArtifact: {
      artifactId: id('artifact', 'b'),
      contentSha256: digest('b'),
      mediaType: 'application/json',
      byteLength: 2,
      createdAt,
    },
    factualParent: {
      factualCandidateId: factualCandidate.candidateId,
      corpusToCandidateLineageId: corpusLineage.lineageId,
    },
    rows: [
      {
        rowId: id('valuation-dataset-row', 'c'),
        content: {
          identity: {
            playerId: 'player-1',
            playerResolutionDecisionId: id('provider-resolution-decision', 'd'),
            playerAssignmentRevision: 1,
            clubId: 'club-1',
            clubResolutionDecisionId: id('provider-resolution-decision', 'e'),
            clubAssignmentRevision: 1,
          },
          lineage: {
            eventId: 'event-1',
            eventVersionId: 'event-version-1',
            acquisitionSpellId: 'spell-1',
            acquisitionSpellVersionId: id('spell-version', '5'),
            lineageEdgeIds: [id('lineage-edge', '6')],
          },
        },
      },
    ],
  },
};

function rowFor(sql: string) {
  if (sql.includes('outcome_factual_release_candidate'))
    return [{ candidate_json: factualCandidate, finalized_at: createdAt }];
  if (sql.includes('outcome_corpus_factual_lineage'))
    return [{ lineage_json: corpusLineage, gate2_decision_key: 'gate2-lineage' }];
  if (sql.includes('outcome_valuation_dataset_consumed_field_set'))
    return [
      {
        field_set_json: {
          fieldSetId: id('consumed-field-set', '9'),
          content: { captureId: 'capture-1', sourceSnapshotId: id('source-snapshot', '2') },
        },
      },
    ];
  if (sql.includes('outcome_source_capture'))
    return [
      {
        capture_id: 'capture-1',
        manifest_json: {
          snapshotId: id('source-snapshot', '2'),
          content: {
            sourceRightsProposal: { rightsArtifactId: id('source-rights', 'f') },
            gate0aDecision: { content: { environment: 'test_fixture' } },
          },
        },
      },
    ];
  if (sql.includes('outcome_valuation_dataset_gate0_evaluation'))
    return [
      {
        operation_kind: 'derived_feature_creation',
        receipt_json: { receiptId: id('gate0a-evaluation', '1') },
      },
      {
        operation_kind: 'model_training',
        receipt_json: { receiptId: id('gate0a-evaluation', '2') },
      },
    ];
  if (sql.includes('outcome_valuation_dataset_operation_authority'))
    return [
      {
        authority_kind: 'analytical_authority',
        receipt_json: { receiptId: id('architecture-operation-receipt', '3') },
      },
      {
        authority_kind: 'operational_authorization',
        receipt_json: { receiptId: id('architecture-operation-receipt', '4') },
      },
    ];
  if (sql.includes('outcome_provider_player_resolution'))
    return [
      {
        entity_kind: 'player',
        entity_id: 'player-1',
        decision_json: { decisionId: id('provider-resolution-decision', 'd') },
        resolution_case_id: id('provider-resolution-case', '5'),
        resolution_revision: 1,
        resolution_id: id('provider-resolution-decision', 'd'),
        resolution_updated_at: createdAt,
        assignment_case_id: id('provider-assignment-case', '6'),
        assignment_entity_kind: 'player',
        assignment_identity_id: id('provider-player-identity', '7'),
        assignment_revision: 1,
        assignment_decision_id: id('provider-resolution-decision', 'd'),
        assignment_status: 'active',
        assignment_updated_at: createdAt,
      },
    ];
  if (sql.includes('outcome_provider_club_resolution'))
    return [
      {
        entity_kind: 'club',
        entity_id: 'club-1',
        decision_json: { decisionId: id('provider-resolution-decision', 'e') },
        resolution_case_id: id('provider-resolution-case', '8'),
        resolution_revision: 1,
        resolution_id: id('provider-resolution-decision', 'e'),
        resolution_updated_at: createdAt,
        assignment_case_id: id('provider-assignment-case', '9'),
        assignment_entity_kind: 'club',
        assignment_identity_id: id('provider-club-identity', '0'),
        assignment_revision: 1,
        assignment_decision_id: id('provider-resolution-decision', 'e'),
        assignment_status: 'active',
        assignment_updated_at: createdAt,
      },
    ];
  if (sql.includes('outcome_event_version'))
    return [{ event_version_id: 'event-version-1', event_id: 'event-1' }];
  if (sql.includes('outcome_acquisition_spell_version'))
    return [
      {
        spell_version_id: id('spell-version', '5'),
        spell_id: 'spell-1',
        player_id: 'player-1',
        club_id: 'club-1',
        start_event_version_id: 'event-version-1',
      },
    ];
  if (sql.includes('outcome_pick_lineage_edge')) return [{ edge_id: id('lineage-edge', '6') }];
  return [];
}

describe('PostgreSQL valuation dataset evidence authenticator', () => {
  it('reconstructs authority from durable rows and exact retained bytes', async () => {
    const loadExactWithObservation = vi.fn(async () => ({ bytes: new Uint8Array([123, 125]) }));
    const authenticator = createPostgresAflTradeValuationDatasetEvidenceAuthenticator({
      sql: {
        async query<Row>(sql: string) {
          const rows = rowFor(sql) as Row[];
          return { rows, rowCount: rows.length };
        },
        async transaction<_T>() {
          throw new Error('not used');
        },
      },
      releaseRepository: { loadRegistry: vi.fn(async () => ({ revision: 3 })) },
      gateRepository: { load: vi.fn(async () => ({ revision: 9, ledger: { decisions: [] } })) },
      artifactRepository: { loadExactWithObservation },
    });

    const evidence = (await authenticator.authenticate({
      dataset: dataset as never,
      admittedAt,
    })) as Record<string, any>;

    expect(evidence.schemaVersion).toBe('afl-trade-dataset-admission-evidence/v5');
    expect(evidence.sourceRights).toHaveLength(1);
    expect(evidence.identityAuthorities).toHaveLength(2);
    expect(evidence.domainLineageAuthorities).toHaveLength(1);
    expect(evidence.rowAuthorities).toHaveLength(1);
    expect(evidence.artifactBytes).toEqual([
      { artifactId: id('artifact', 'b'), bytes: new Uint8Array([123, 125]) },
    ]);
    expect(loadExactWithObservation).toHaveBeenCalledTimes(1);
  });

  it('fails closed when exact retained bytes are unavailable', async () => {
    const authenticator = createPostgresAflTradeValuationDatasetEvidenceAuthenticator({
      sql: {
        async query<Row>(sql: string) {
          const rows = rowFor(sql) as Row[];
          return { rows, rowCount: rows.length };
        },
        async transaction<_T>() {
          throw new Error('not used');
        },
      },
      releaseRepository: { loadRegistry: vi.fn(async () => ({ revision: 3 })) },
      gateRepository: { load: vi.fn(async () => ({ revision: 9, ledger: { decisions: [] } })) },
      artifactRepository: { loadExactWithObservation: vi.fn(async () => null) },
    });

    await expect(
      authenticator.authenticate({ dataset: dataset as never, admittedAt })
    ).rejects.toThrow('retained artifact');
  });
});
