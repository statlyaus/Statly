import { createHash } from 'node:crypto';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';

const hash = (marker: string) => marker.repeat(64);
const sha = (value: unknown) =>
  createHash('sha256').update(canonicalizeAflTradeJson(value)).digest('hex');

/** Explicit synthetic upstream custody, never genuine source or admission proof. */
export async function seedPrivateValuationCohortBindingFixture(
  client: AflOutcomeSqlClient,
  options: { includeTradeEvidence?: boolean } = {}
) {
  const scopeKey = 'afl-men:2025-trades';
  const enqueued = await client.query<{ request_id: string }>(
    `SELECT enqueue_outcome_private_valuation_dispatch($1,'ad_hoc','2026-08-01T00:00:00Z','synthetic-cohort') AS request_id`,
    [scopeKey]
  );
  const requestId = enqueued.rows[0]!.request_id;
  const claim = await new PostgresAflTradePrivateValuationScheduleRepository(client).claim(
    'system:weekly-valuation-coordinator',
    requestId
  );
  if (!claim) throw new Error('Synthetic cohort fixture could not claim its dispatch');
  const outputId = `private-valuation-factual-output:${hash('1')}`;
  const candidateId = `factual-release-candidate:${hash('2')}`;
  const lineageId = `corpus-factual-lineage:${hash('4')}`;
  const admissionId = `corpus-factual-lineage-admission:${hash('5')}`;
  const captureId = `source-capture:${hash('6')}`;
  const rightsId = `source-rights:${hash('7')}`;
  const gate0Id = `gate-decision:${hash('8')}`;
  const gate2Id = `gate-decision:${hash('9')}`;
  const eventId = `outcome-event:${hash('a')}`;
  const eventVersionId = `outcome-event-version:${hash('b')}`;
  const instant = '2026-01-01T00:00:00.000Z';
  const sourceMemberSetSha256 = sha([]);
  const corpusContent = {
    schemaVersion: 'afl-trade-canonical-corpus/v3',
    environment: 'non_production',
    competition: 'AFLM',
    anchorSeasonRange: { from: 2025, through: 2025 },
    createdAt: instant,
    knowledgeCutoffAt: instant,
    promotionCount: 1,
    memberCount: 1,
    memberSetSha256: sourceMemberSetSha256,
    recordCounts: {},
    publicationEligible: false,
    promotions: [],
    members: [],
  };
  const corpusId = `corpus:${sha(corpusContent)}`;
  const captureAt = '2025-12-01T00:00:00.000Z';
  const gate0Key = 'synthetic-cohort-source';
  const rights = {
    rightsArtifactId: rightsId,
    content: {
      schemaVersion: 'afl-trade-source-rights/v2',
      provider: 'synthetic',
      dataset: 'cohort',
      datasetVersion: '1',
      proposedAt: '2025-11-01T00:00:00.000Z',
    },
  };
  const captureManifest = {
    executionReceipt: {
      content: {
        schemaVersion: 'afl-trade-external-capture-execution/v2',
        request: { environment: 'non_production', competition: 'AFLM' },
        sourceRights: rights,
        gate0aReceipt: {
          content: {
            request: { decisionKey: gate0Key },
            result: { status: 'mechanically_eligible', decisionId: gate0Id },
          },
        },
      },
    },
  };
  const source = {
    captureId,
    sourceSnapshotId: `source-snapshot:${hash('6')}`,
    rightsArtifactId: rightsId,
    gateDecisionId: gate0Id,
    recordSha256: sha(captureManifest),
    recordedAt: captureAt,
  };
  const records = [
    {
      recordKind: 'transaction',
      canonicalRecordId: eventVersionId,
      table: 'outcome_release_event_version',
      key: 'event_version_id',
      record: {
        eventVersionId,
        eventId,
        competition: 'AFLM',
        seasonYear: 2025,
        kind: 'trade',
        status: 'approved',
        eventDate: '2025-10-01',
        recordedAt: captureAt,
        parties: [],
      } as Record<string, unknown>,
    },
  ];
  if (options.includeTradeEvidence) {
    for (const [recordKind, table, key, identityField] of [
      ['transfer', 'outcome_release_event_asset', 'asset_version_id', 'assetVersionId'],
      ['draft_event', 'outcome_release_event_version', 'event_version_id', 'eventVersionId'],
      ['draft_player_asset', 'outcome_release_event_asset', 'asset_version_id', 'assetVersionId'],
      ['draft_selection', 'outcome_release_draft_selection', 'selection_id', 'selectionId'],
      [
        'pick_custody',
        'outcome_release_pick_custody',
        'custody_observation_id',
        'custodyObservationId',
      ],
      ['pick_realization', 'outcome_release_pick_realization', 'realization_id', 'realizationId'],
    ] as const) {
      records.push({
        recordKind,
        canonicalRecordId: `synthetic:${recordKind}`,
        table,
        key,
        record: {
          [identityField]: `synthetic:${recordKind}`,
          status: 'approved',
          recordedAt: captureAt,
        },
      });
    }
  }
  records.sort((left, right) =>
    left.recordKind < right.recordKind ? -1 : left.recordKind > right.recordKind ? 1 : 0
  );
  const snapshots = records.map((row, index) => {
    const snapshot = {
      schemaVersion: 'afl-trade-canonical-release-member/v1',
      recordKind: row.recordKind,
      record: row.record,
    };
    return {
      ...row,
      recordCanonicalJson: canonicalizeAflTradeJson(snapshot),
      membership: {
        ordinal: index + 1,
        recordKind: row.recordKind,
        canonicalRecordId: row.canonicalRecordId,
        canonicalRecordSha256: sha(snapshot),
      },
    };
  });
  const canonicalMembers = snapshots.map(({ membership }) => membership);
  const counts = Object.fromEntries(
    [
      'transaction',
      'transfer',
      'draft_event',
      'draft_player_asset',
      'draft_selection',
      'pick_custody',
      'pick_realization',
    ].map((kind) => [kind, records.filter((row) => row.recordKind === kind).length])
  );
  const promotionSources = [
    { promotionId: `external-canonical-promotion:${hash('a')}`, captureIds: [captureId] },
  ];
  const manifestContent = {
    schemaVersion: 'afl-draft-trade-factual-release/v3',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    authorityBoundary: 'registry_validation_and_activation_required',
    environment: 'non_production',
    validFromSeason: 2025,
    validThroughSeason: 2025,
    corpusSha256: sha(corpusContent),
    corpusSchemaVersion: 'afl-trade-canonical-corpus/v3',
    memberCount: records.length,
    sourceRecordCounts: counts,
    canonicalMemberCount: records.length,
    canonicalRecordCounts: counts,
    factualCandidateSchemaVersion: 'afl-trade-factual-release-candidate/v4',
    scopeKey,
    competition: 'AFLM',
    corpusId,
    sourceMemberSetSha256,
    canonicalMemberSetSha256: sha(canonicalMembers),
    sourceCaptures: [source],
    sourceCaptureSetSha256: sha([source]),
    promotionSources,
    promotionSourceSetSha256: sha(promotionSources),
    canonicalMembers,
    createdAt: instant,
    effectiveThrough: instant,
  };
  const releaseId = `outcome-release:${sha(manifestContent)}`;
  const manifest = { releaseId, content: manifestContent };
  const hpnBinding = {
    requestId,
    factualOutputId: outputId,
    factualOperationId: `current-valuation-factual-refresh-operation:${hash('d')}`,
    privateFactualCandidateId: `private-factual-candidate:${hash('e')}`,
    privateFactualRevision: 1,
    hpnFactualRunId: `factual-reconciliation-run:${hash('f')}`,
    hpnInputSetSha256: hash('f'),
    hpnFinalizedAt: instant,
  };
  await client.transaction(async (transaction) => {
    // All upstream fixture inserts are isolated. The new bind/get and current gate,
    // capture, cohort membership and dispatch checks run as deployed, restricted SQL.
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    const insert = async (table: string, row: Record<string, unknown>) => {
      const keys = Object.keys(row);
      await transaction.query(
        `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(',')})
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
        Object.values(row).map((value) =>
          typeof value === 'object' && value !== null ? canonicalizeAflTradeJson(value) : value
        )
      );
    };
    await insert('outcome_private_valuation_factual_output', {
      output_id: outputId,
      request_id: requestId,
      candidate_id: `factual-release-candidate:${hash('0')}`,
      factual_release_id: `outcome-release:${hash('0')}`,
      player_dataset_id: `dataset:${hash('0')}`,
      player_dataset_admission_id: `dataset-admission:${hash('0')}`,
      prepared_at: instant,
      output_json: { content: { schemaVersion: 'afl-trade-private-valuation-factual-output/v2' } },
    });
    await insert('synthetic_cohort_hpn_authority', {
      request_id: requestId,
      binding_json: hpnBinding,
    });
    await insert('outcome_source_rights_proposal', {
      rights_artifact_id: rightsId,
      provider: 'synthetic',
      dataset: 'cohort',
      dataset_version: '1',
      proposed_at: rights.content.proposedAt,
      content_json: rights,
    });
    await insert('outcome_source_capture', {
      capture_id: captureId,
      attempt_id: 'synthetic-attempt',
      source_snapshot_id: source.sourceSnapshotId,
      source_artifact_id: `artifact:${hash('6')}`,
      environment: 'non_production',
      provider: 'synthetic',
      dataset: 'cohort',
      dataset_version: '1',
      access_mechanism: 'synthetic',
      competition: 'AFLM',
      anchor_season_year: 2025,
      effective_at: captureAt,
      captured_at: captureAt,
      status: 'approved',
      manifest_json: captureManifest,
    });
    await insert('outcome_promotion_backed_corpus', {
      corpus_id: corpusId,
      environment: 'non_production',
      competition: 'AFLM',
      anchor_season_from: 2025,
      anchor_season_through: 2025,
      created_at: instant,
      knowledge_cutoff_at: instant,
      promotion_count: 1,
      member_count: 1,
      member_set_sha256: sourceMemberSetSha256,
      record_counts_json: {},
      corpus_sha256: sha(corpusContent),
      corpus_canonical_json: canonicalizeAflTradeJson(corpusContent),
      member_set_canonical_json: '[]',
      corpus_json: { corpusId, content: corpusContent },
      status: 'finalized',
      finalized_at: instant,
    });
    await insert('outcome_release_manifest', {
      release_id: releaseId,
      scope_key: scopeKey,
      environment: 'non_production',
      created_at: instant,
      effective_through: instant,
      manifest_json: manifest,
      manifest_canonical_json: canonicalizeAflTradeJson(manifestContent),
    });
    await insert('outcome_factual_release_candidate', {
      candidate_id: candidateId,
      target_release_id: releaseId,
      environment: 'non_production',
      scope_key: scopeKey,
      competition: 'AFLM',
      valid_from_season: 2025,
      valid_through_season: 2025,
      member_counts_json: {},
      created_at: instant,
      effective_through: instant,
      candidate_sha256: hash('2'),
      member_set_sha256: sourceMemberSetSha256,
      candidate_json: {
        content: {
          schemaVersion: 'afl-trade-factual-release-candidate/v4',
          targetReleaseManifest: manifest,
        },
      },
      status: 'approved',
      finalized_at: instant,
      promotion_backed_corpus_id: corpusId,
      source_member_set_sha256: sourceMemberSetSha256,
      canonical_member_set_sha256: sha(canonicalMembers),
    });
    await insert('outcome_release_source_capture', {
      release_id: releaseId,
      capture_id: captureId,
      ordinal: 1,
      record_sha256: sha(captureManifest),
      membership_json: source,
      record_canonical_json: canonicalizeAflTradeJson(captureManifest),
    });
    await insert('outcome_event', {
      event_id: eventId,
      competition: 'AFLM',
      season_year: 2025,
      stable_key: 'synthetic-cohort',
    });
    await insert('outcome_event_version', {
      event_version_id: eventVersionId,
      event_id: eventId,
      version: 1,
      kind: 'trade',
      acquisition_mechanism: 'trade',
      event_date: '2025-10-01',
      official_name: 'Synthetic cohort trade',
      status: 'approved',
      source_import_row_id: 'synthetic-import-row',
      recorded_at: captureAt,
    });
    for (const snapshot of snapshots) {
      await insert(snapshot.table, {
        release_id: releaseId,
        [snapshot.key]: snapshot.canonicalRecordId,
        ordinal: snapshot.membership.ordinal,
        record_sha256: snapshot.membership.canonicalRecordSha256,
        membership_json: snapshot.membership,
        record_canonical_json: snapshot.recordCanonicalJson,
      });
    }
    await insert('outcome_record_state_commitment', {
      event_revision: 1,
      release_id: releaseId,
      record_state_id: `outcome-release-record-state:${hash('a')}`,
      record_state_json: { state: 'approved' },
    });
    await insert('outcome_corpus_factual_lineage', {
      lineage_id: lineageId,
      corpus_id: corpusId,
      release_id: releaseId,
      candidate_id: candidateId,
      environment: 'non_production',
      scope_key: scopeKey,
      competition: 'AFLM',
      valid_from_season: 2025,
      valid_through_season: 2025,
      source_member_set_sha256: sourceMemberSetSha256,
      canonical_member_set_sha256: sha(canonicalMembers),
      created_at: instant,
      lineage_canonical_json: '{}',
      lineage_json: {},
    });
    for (const [gate, decisionKey, decisionId, marker, affectedArtifacts] of [
      [
        'gate_0a_permission_to_evaluate',
        gate0Key,
        gate0Id,
        '8',
        [{ kind: 'source_rights', artifactId: rightsId }],
      ],
      [
        'gate_2_corpus_lineage',
        `gate2:${lineageId}`,
        gate2Id,
        '9',
        [
          { kind: 'corpus_manifest', artifactId: corpusId },
          { kind: 'factual_release', artifactId: releaseId },
          { kind: 'factual_release_candidate', artifactId: candidateId },
          { kind: 'corpus_factual_lineage', artifactId: lineageId },
        ],
      ],
    ] as const) {
      const proposalId = `gate-proposal:${hash(marker)}`;
      const content = {
        schemaVersion: 'afl-trade-gate-proposal/v1',
        gate,
        decisionKey,
        version: 1,
        environment: 'non_production',
        scope: { scopeKey },
        proposedAt: '2025-11-01T00:00:00.000Z',
        affectedArtifacts,
      };
      await insert('outcome_gate_proposal', {
        proposal_id: proposalId,
        gate,
        decision_key: decisionKey,
        version: 1,
        environment: 'non_production',
        scope_key: scopeKey,
        proposed_at: content.proposedAt,
        proposal_json: { proposalId, content },
      });
      await insert('outcome_gate_decision', {
        decision_id: decisionId,
        proposal_id: proposalId,
        gate,
        decision_key: decisionKey,
        version: 1,
        environment: 'non_production',
        state: 'approved',
        decided_at: content.proposedAt,
        effective_at: content.proposedAt,
        revalidate_at: '2099-01-01T00:00:00.000Z',
        decision_json: { content: { affectedArtifacts } },
      });
    }
    await insert('outcome_corpus_factual_lineage_admission', {
      admission_id: admissionId,
      lineage_id: lineageId,
      gate_proposal_id: `gate-proposal:${hash('9')}`,
      gate_decision_id: gate2Id,
      gate_ledger_revision: 1,
      admitted_at: instant,
      revalidate_at: '2099-01-01T00:00:00.000Z',
      admission_canonical_json: '{}',
      admission_json: {},
    });
  });
  return {
    requestId,
    claim,
    outputId,
    admissionId,
    releaseId,
    candidateId,
    lineageId,
    corpusId,
    eventId,
    eventVersionId,
    captureId,
    gate0Id,
    gate2Id,
    rightsId,
    hpnBinding,
    snapshots,
    effectiveThrough: instant,
  };
}
