import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeArtifactCustodyProfile,
  AFL_TRADE_ARTIFACT_KEY_DERIVATION,
  AFL_TRADE_ARTIFACT_CONDITIONAL_CREATE,
} from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeArtifactReadbackReceiptSchema } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeSourceSnapshotManifest } from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import { createAflTradeConsumedFieldSet } from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { aflTradeHpnPavFieldMapSchema } from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import {
  createAflTradeSourceFact,
  createAflTradeProviderAppearanceCandidate,
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
} from '@/server/aflTradeIntelligence/outcomes/factualObservationContracts';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';
import {
  fullPlayerPavDatasetAdmissionFixture,
  playerPavDatasetAdmissionFixture,
} from './playerPavDatasetAdmissionFixture';

type NumericalFixture = Awaited<ReturnType<typeof playerPavDatasetAdmissionFixture>>;
const addressed = (prefix: string, value: unknown) => createAflTradeContentAddress(prefix, value);
const xml = (value: unknown) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Real SpreadsheetML bytes containing synthetic records, never a retained provider download. */
function workbookBytes(values: readonly Record<string, unknown>[], fields: readonly string[]) {
  const row = (cells: readonly unknown[]) =>
    `<Row>${cells.map((value) => `<Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xml(value)}</Data></Cell>`).join('')}</Row>`;
  return Buffer.from(
    `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Synthetic records"><Table>${row(fields)}${values.map((value) => row(fields.map((field) => value[field]))).join('')}</Table></Worksheet></Workbook>`
  );
}

/** Schema-checked fabricated source custody for isolated PostgreSQL tests only. */
export async function playerPavSourceAuthorityDocuments(
  fixture: NumericalFixture,
  custodyAt?: string
) {
  if (fixture.policy.content.environment !== 'non_production')
    throw new Error('Source PG fixture requires non_production numerical inputs.');
  const serviceFixture = await fullPlayerPavDatasetAdmissionFixture();
  const sourceAuthorities = fixture.sourceDocuments.map((document) => {
    const base =
      serviceFixture.evidence.sourceRights.find(
        (source) => source.captureId === document.run.captureId
      ) ??
      serviceFixture.evidence.sourceRights.find(
        (source) => source.rightsProposal.content.provider === document.run.provider
      )!;
    const fields = [
      ...new Set(document.rows.flatMap((row) => Object.keys(row.source.sourceValues))),
    ].sort();
    const bytes = workbookBytes(
      document.rows.map((row) => row.source.sourceValues),
      fields
    );
    const capturedAt = document.run.capturedAt;
    const artifact = createAflTradeByteArtifactRef(bytes, 'application/vnd.ms-excel', capturedAt);
    const rightsContent = {
      ...base.rightsProposal.content,
      registerId: document.run.captureId,
      datasetVersion: `synthetic-${document.run.seasonYear}`,
      scope: {
        ...base.rightsProposal.content.scope,
        seasonRanges: [{ from: document.run.seasonYear, to: document.run.seasonYear }],
      },
      acquisition: {
        kind: 'provided_artifact' as const,
        mediaType: artifact.mediaType,
        deliveryMethod: 'Generated synthetic SpreadsheetML fixture; not a provider download.',
      },
      operations: {
        ...base.rightsProposal.content.operations,
        bounded_evaluation_capture: 'allowed' as const,
      },
    };
    const rights = aflTradeSourceRightsProposalSchema.parse({
      rightsArtifactId: addressed('source-rights', rightsContent),
      content: rightsContent,
    });
    const operations = [
      'bounded_evaluation_capture',
      'raw_evidence_retention',
      'metadata_hash_retention',
      'derived_feature_creation',
      'model_training',
      'public_derived_output',
      'public_fact_display',
    ] as const;
    const proposalContent = {
      ...base.gateLedger.proposals[0]!.content,
      decisionKey: `synthetic-pav-source:${document.run.captureId}`,
      environment: 'non_production' as const,
      affectedArtifacts: [{ kind: 'source_rights' as const, artifactId: rights.rightsArtifactId }],
      scope: {
        ...base.gateLedger.proposals[0]!.content.scope,
        scopeKey: `synthetic-pav-source:${document.run.captureId}`,
        dimensions: base.gateLedger.proposals[0]!.content.scope.dimensions.map((dimension) =>
          dimension.name === 'source_rights_artifact'
            ? { ...dimension, values: [rights.rightsArtifactId] }
            : dimension.name === 'season'
              ? { ...dimension, values: [String(document.run.seasonYear)] }
              : dimension.name === 'operation'
                ? { ...dimension, values: [...operations] }
                : dimension
        ),
      },
    };
    const proposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: addressed('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const decisionContent = {
      ...base.gateLedger.decisions[0]!.content,
      proposalId: proposal.proposalId,
      decisionKey: proposal.content.decisionKey,
      environment: 'non_production' as const,
      authorityKind: 'external_human_record' as const,
      scope: proposal.content.scope,
      affectedArtifacts: proposal.content.affectedArtifacts,
      rationale: 'Fabricated external-review record for isolated PostgreSQL test setup only.',
      limitations: ['Synthetic fixture only; supplies no genuine source permission.'],
    };
    const decision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: addressed('gate-decision', decisionContent),
      content: decisionContent,
    });
    const ledger = { proposals: [proposal], decisions: [decision] };
    const fieldUses = fields.flatMap((sourceField) => [
      { sourceField, use: 'derived_feature' as const },
      { sourceField, use: 'model_training' as const },
    ]);
    const receipt = createAflTradeGate0AReceipt(
      ledger,
      rights,
      {
        ...base.derivationReceipt.content.request,
        environment: 'non_production',
        decisionKey: proposal.content.decisionKey,
        season: document.run.seasonYear,
        rightsArtifactId: rights.rightsArtifactId,
        evaluatedAt: capturedAt,
        operations: [...operations],
        fieldUses,
        rawRetentionDays: 365,
      },
      capturedAt
    );
    const profile = createAflTradeArtifactCustodyProfile({
      schemaVersion: 'afl-trade-artifact-custody-profile/v1',
      subject: 'afl-trade-intelligence',
      contractRole: 'requirements_only_not_readiness_or_authorization',
      repositoryId: 'synthetic-pav-source-fixture',
      environment: 'non_production',
      artifactClass: 'raw_source',
      maximumObjectBytes: 128 * 1024 * 1024,
      keyDerivation: AFL_TRADE_ARTIFACT_KEY_DERIVATION,
      conditionalCreate: AFL_TRADE_ARTIFACT_CONDITIONAL_CREATE,
      encryption: {
        inTransit: 'tls_required',
        atRest: { mode: 'provider_managed', keyReferenceSha256: null },
      },
      retention: {
        deletion: {
          kind: 'maximum_age',
          maximumDays: 365,
          enforcement: 'provider_lifecycle_required',
        },
        deleteOnWithdrawal: true,
        worm: null,
      },
      residency: {
        allowedJurisdictions: ['AU'],
        crossJurisdictionTransfer: 'approved_jurisdictions_only',
      },
      infrastructureEvidenceIds: [addressed('artifact', { fixture: 'synthetic-custody-profile' })],
    });
    const readbackContent = {
      schemaVersion: 'afl-trade-artifact-readback/v4' as const,
      artifact,
      repositoryAssurance: 'durable_object_storage' as const,
      artifactClass: 'raw_source' as const,
      custodyProfileId: profile.profileId,
      custodyProfile: profile,
      custodyEnvironment: 'non_production' as const,
      verifiedAt: capturedAt,
      verification: 'exact_reference_and_sha256_bytes' as const,
      status: 'passed' as const,
    };
    const readback = aflTradeArtifactReadbackReceiptSchema.parse({
      receiptId: addressed('artifact-readback', readbackContent),
      content: readbackContent,
    });
    const snapshot = createAflTradeSourceSnapshotManifest({
      schemaVersion: 'afl-trade-source-snapshot/v3',
      sourceArtifact: artifact,
      readbackReceipt: readback,
      capture: {
        kind: 'workbook',
        sourceRegisterId: rights.content.registerId,
        upstreamProvider: rights.content.provider,
        upstreamDataset: rights.content.dataset,
        upstreamDatasetVersion: rights.content.datasetVersion,
        originalFilename: `synthetic-${document.run.provider}-${document.run.seasonYear}.xls`,
        workbookFormat: 'xls',
        worksheetNames: ['Synthetic records'],
        importFormatVersion: 'synthetic-pav-v1',
        accessMechanism: 'manual_review',
      },
      sourceRightsProposal: rights,
      gate0aProposal: proposal,
      gate0aDecision: decision,
      gate0aReceipt: receipt,
      fitzRoyCaptureReceipt: null,
      capturedFields: fields,
      retrievedAt: capturedAt,
      effectiveAt: `${document.run.seasonYear}-09-27T00:00:00.000Z`,
      retention: { rawRetentionDays: 365, deleteOnWithdrawal: true },
      createdAt: capturedAt,
    });
    const captureId = addressed('source-capture', {
      snapshotId: snapshot.snapshotId,
      fixture: true,
    });
    const consumedFieldSet = createAflTradeConsumedFieldSet({
      schemaVersion: 'afl-trade-consumed-field-set/v1',
      captureId,
      sourceSnapshotId: snapshot.snapshotId,
      createdAt: capturedAt,
      fields: fields.map((sourceField) => ({
        sourceField,
        uses: ['derived_feature', 'model_training'],
      })),
    });
    const decodedRows = document.rows.map((row) => ({
      row,
      sourceRowSha256: sha256AflTradeCanonicalJson(row.source.sourceValues),
      typedPayload: Object.fromEntries(
        Object.entries(row.source.sourceValues).map(([field, value]) => [
          field,
          typeof value === 'number'
            ? { kind: Number.isInteger(value) ? 'integer' : 'decimal', value: String(value) }
            : { kind: 'text', value },
        ])
      ),
    }));
    return {
      document,
      fieldMap: fixture.pavMeasurements
        .find((measurement) => measurement.inputSet.content.seasonYear === document.run.seasonYear)!
        .inputSet.content.fieldMaps.find((map) => map.fieldMapId === document.run.fieldMapId)!,
      captureId,
      snapshot,
      artifact,
      bytes,
      profile,
      readback,
      rights,
      ledger,
      receipt,
      consumedFieldSet,
      decodedRows,
    };
  });
  return {
    sourceAuthorities,
    factualDocuments: sourceAuthorities.flatMap((source) =>
      source.document.rows.map((row) =>
        sourceFactForRow(source, row, custodyAt ?? source.document.run.finalizedAt)
      )
    ),
    artifactBytes: sourceAuthorities.map((source) => ({
      artifactId: source.artifact.artifactId,
      bytes: source.bytes,
    })),
  };
}

/** Inserts only synthetic upstream state; all HPN/PAV/dataset owners remain enabled. */
export async function seedPlayerPavSourceAuthorityFixture(
  sql: AflOutcomeSqlClient,
  input: {
    fixture: NumericalFixture;
    custodyAt: string;
  }
) {
  const prepared = await playerPavSourceAuthorityDocuments(input.fixture, input.custodyAt);
  const maps = [
    ...new Map(
      input.fixture.pavMeasurements
        .flatMap((measurement) =>
          measurement.inputSet.content.fieldMaps.map((map) =>
            aflTradeHpnPavFieldMapSchema.parse(map)
          )
        )
        .map((map) => [map.fieldMapId, map])
    ).values(),
  ];
  const seasons = input.fixture.pavMeasurements.map(({ inputSet }) => ({
    seasonYear: inputSet.content.seasonYear,
    effectiveThrough: inputSet.content.effectiveThrough,
    factualRunId: inputSet.content.factualUniverse.factualRunId,
    sources: inputSet.content.sourceRuns.map((run) => {
      const row = inputSet.content.rows.find(
        (row) => row.source.normalizationRunId === run.normalizationRunId
      )!;
      return {
        normalizationRunId: run.normalizationRunId,
        fieldMapId: run.fieldMapId,
        inputKind: row.kind,
        role: row.kind === 'player_match_stats' ? row.role : null,
      };
    }),
  }));
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  const currentLedger = await ledger.load();
  await ledger.appendBatch({
    expectedRevision: currentLedger.revision,
    records: prepared.sourceAuthorities.map((source) => ({
      sourceRights: source.rights,
      proposal: source.ledger.proposals[0]!,
      decision: source.ledger.decisions[0]!,
    })),
  });
  await sql.transaction(async (transaction) => {
    // This is explicit fabricated upstream state in a disposable test schema, not admission.
    await transaction.query("SET LOCAL session_replication_role='replica'");
    const put = (table: string, record: Record<string, unknown>) =>
      insertFixtureRecord(transaction, table, record);
    for (const map of maps) {
      await put('outcome_review_decision', {
        decision_id: map.content.approvalDecision.id,
        subject_type: 'provider_field_map',
        subject_id: map.fieldMapId,
        decision: 'approved',
        rationale: 'Synthetic fixture HPN mapping review only.',
        evidence_json: { fixture: true },
        decided_by: 'synthetic-pav-fixture-reviewer',
        decided_at: input.custodyAt,
      });
      await put('outcome_provider_field_map', {
        field_map_id: addressed('provider-field-map', { hpn: map.fieldMapId }),
        capability_id: map.content.capabilityId,
        fitzroy_version: 'synthetic-fixture',
        source_schema_sha256: map.content.sourceSchemaSha256,
        field_map_sha256: sha256AflTradeCanonicalJson(map),
        approval_decision_id: map.content.approvalDecision.id,
        approved_at: input.custodyAt,
        map_json: map,
      });
    }
    const spells = [
      ...new Map(
        input.fixture.pavMeasurements
          .flatMap((measurement) =>
            measurement.inputSet.content.rows.flatMap((row) =>
              row.kind === 'player_match_stats' ? [row.acquisitionSpell] : []
            )
          )
          .map((spell) => [spell.spellVersionId, spell])
      ).values(),
    ];
    for (const clubId of [...new Set(spells.map((spell) => spell.clubId))])
      await put('outcome_club', {
        club_id: clubId,
        current_name: `Synthetic ${clubId}`,
        status: 'approved',
      });
    for (const spell of spells) {
      await put('outcome_player', {
        player_id: spell.playerId,
        display_name: `Synthetic ${spell.playerId}`,
        status: 'approved',
      });
      await put('outcome_acquisition_spell_rule', {
        rule_id: spell.ruleId,
        rule_version: 'synthetic-fixture',
        definition_json: { fixture: true },
        status: 'approved',
        created_at: spell.recordedAt,
      });
      await put('outcome_event_asset', {
        asset_version_id: spell.startAssetVersionId,
        event_version_id: spell.startEventVersionId,
        asset_key: `fixture:${spell.spellId}`,
        kind: 'player',
        player_id: spell.playerId,
        player_identity_id: `fixture-identity:${spell.playerId}`,
        pick_id: null,
        from_club_id: null,
        to_club_id: spell.clubId,
        source_import_row_id: `fixture-import:${spell.playerId}`,
        raw_description: 'Synthetic acquisition',
        status: 'approved',
      });
      await put('outcome_acquisition_spell_version', {
        spell_version_id: spell.spellVersionId,
        spell_id: spell.spellId,
        version: spell.version,
        player_id: spell.playerId,
        club_id: spell.clubId,
        start_event_version_id: spell.startEventVersionId,
        start_asset_version_id: spell.startAssetVersionId,
        start_date: spell.startDate,
        end_date: spell.endDate,
        end_reason: spell.endReason,
        rule_id: spell.ruleId,
        status: spell.status,
        supersedes_spell_version_id: spell.supersedesSpellVersionId,
        recorded_at: spell.recordedAt,
      });
    }
    for (const source of prepared.sourceAuthorities) {
      const { run } = source.document;
      const snapshot = source.snapshot.content;
      await put('outcome_artifact_custody', {
        artifact_id: source.artifact.artifactId,
        content_sha256: source.artifact.contentSha256,
        storage_uri: source.artifact.storageUri,
        media_type: source.artifact.mediaType,
        byte_length: source.artifact.byteLength,
        artifact_class: 'raw_source',
        environment: 'non_production',
        custody_profile_id: source.profile.profileId,
        created_at: source.artifact.createdAt,
        verified_at: source.readback.content.verifiedAt,
        custody_json: source.readback,
      });
      await put('outcome_source_capture', {
        capture_id: source.captureId,
        attempt_id: addressed('source-capture-attempt', { snapshotId: source.snapshot.snapshotId }),
        source_snapshot_id: source.snapshot.snapshotId,
        source_artifact_id: source.artifact.artifactId,
        environment: 'non_production',
        provider: run.provider,
        dataset: source.rights.content.dataset,
        dataset_version: source.rights.content.datasetVersion,
        access_mechanism: 'manual_review',
        capability_id: run.capabilityId,
        competition: 'AFLM',
        anchor_season_year: run.seasonYear,
        effective_at: snapshot.effectiveAt,
        captured_at: run.capturedAt,
        status: 'approved',
        manifest_json: snapshot,
      });
      await put('outcome_source_capture_season', {
        capture_id: source.captureId,
        competition: 'AFLM',
        season_year: run.seasonYear,
      });
      await put('outcome_provider_normalization_run', {
        normalization_run_id: run.normalizationRunId,
        capture_id: source.captureId,
        field_map_id: addressed('provider-field-map', { hpn: run.fieldMapId }),
        decoder_version: 'synthetic-fixture',
        normalizer_version: 'synthetic-fixture',
        source_rds_sha256: source.artifact.contentSha256,
        decoded_sha256: sha256AflTradeCanonicalJson(
          source.decodedRows.map((row) => row.typedPayload)
        ),
        receipt_sha256: sha256AflTradeCanonicalJson({ fixture: run.normalizationRunId }),
        staging_sha256: run.stagingSha256,
        status: 'staged',
        source_row_count: source.decodedRows.length,
        accepted_row_count: source.decodedRows.length,
        quarantined_row_count: 0,
        issue_count: 0,
        identity_candidate_count:
          source.document.rows[0]!.kind === 'player_match_stats' ? source.decodedRows.length : 0,
        match_candidate_count: source.decodedRows.length,
        metric_candidate_count: 0,
        achievement_candidate_count: 0,
        started_at: run.capturedAt,
        completed_at: input.custodyAt,
        finalized_at: input.custodyAt,
        receipt_json: { fixture: true },
      });
      for (const [index, decoded] of source.decodedRows.entries()) {
        await put('outcome_provider_decoded_row', {
          provider_decoded_row_id: decoded.row.source.providerDecodedRowId,
          normalization_run_id: run.normalizationRunId,
          capture_id: source.captureId,
          competition: 'AFLM',
          season_year: run.seasonYear,
          source_row_number: index + 1,
          source_row_sha256: decoded.sourceRowSha256,
          row_status: 'staged',
          typed_payload: decoded.typedPayload,
          recorded_at: input.custodyAt,
        });
        await seedFixtureResolutionRows(
          transaction,
          decoded.row,
          run.provider,
          run.seasonYear,
          input.custodyAt
        );
      }
    }
    for (const measurement of input.fixture.pavMeasurements) {
      const set = measurement.inputSet.content;
      const universe = set.factualUniverse;
      await put('outcome_review_decision', {
        decision_id: addressed('review-decision', { fixturePolicy: universe.policyId }),
        subject_type: 'factual_reconciliation_policy',
        subject_id: universe.policyId,
        decision: 'approved',
        rationale: 'Synthetic factual denominator review.',
        evidence_json: { fixture: true },
        decided_by: 'synthetic-pav-fixture-reviewer',
        decided_at: input.custodyAt,
      });
      await put('outcome_factual_reconciliation_policy', {
        policy_id: universe.policyId,
        policy_version: 'synthetic-fixture',
        environment: 'non_production',
        competition: 'AFLM',
        valid_from_season: 2003,
        valid_through_season: 2020,
        policy_sha256: sha256AflTradeCanonicalJson({ fixture: universe.policyId }),
        approval_decision_id: addressed('review-decision', { fixturePolicy: universe.policyId }),
        status: 'approved',
        policy_json: { fixture: true },
        created_at: input.custodyAt,
      });
      await put('outcome_factual_reconciliation_run', {
        factual_run_id: universe.factualRunId,
        policy_id: universe.policyId,
        environment: 'non_production',
        competition: 'AFLM',
        season_year: set.seasonYear,
        algorithm_version: 'synthetic-fixture',
        input_set_sha256: universe.inputSetSha256,
        output_set_sha256: sha256AflTradeCanonicalJson(universe),
        status: 'approved',
        source_fact_count: 5,
        reconciled_fact_count: 5,
        conflict_count: 0,
        started_at: input.custodyAt,
        completed_at: input.custodyAt,
        finalized_at: input.custodyAt,
        receipt_json: { fixture: true },
        run_sha256: sha256AflTradeCanonicalJson({ fixture: universe.factualRunId }),
      });
      for (const match of universe.completedMatchFacts) {
        const row = set.rows.find(
          (row) => row.kind === 'completed_match_result' && row.match.canonicalId === match.matchId
        )!;
        const suffix = row.source.providerDecodedRowId;
        await put('outcome_match', {
          match_id: match.matchId,
          competition: 'AFLM',
          season_year: set.seasonYear,
          provider: null,
          native_match_id: null,
          round_label: 'Synthetic final',
          match_date: match.effectiveAt,
          home_club_id: match.homeClubId,
          away_club_id: match.awayClubId,
        });
        const sourceAuthority = prepared.sourceAuthorities.find(
          (source) => source.document.run.normalizationRunId === row.source.normalizationRunId
        )!;
        const fact = sourceFactForRow(sourceAuthority, row, input.custodyAt);
        for (const [index, factId] of [fact.factId].entries()) {
          await put('outcome_provider_match_universe_fact', {
            match_fact_id: factId,
            fact_batch_id: addressed('source-fact-batch', { season: set.seasonYear }),
            normalization_run_id: row.source.normalizationRunId,
            provider_decoded_row_id: suffix,
            match_candidate_id: addressed('provider-match-candidate', suffix),
            match_resolution_decision_id: addressed(
              'provider-resolution-decision',
              `match:${suffix}`
            ),
            match_assignment_decision_id: addressed(
              'provider-resolution-decision',
              `match:${suffix}`
            ),
            match_identity_id: addressed('provider-match-identity', `match:${suffix}`),
            match_id: match.matchId,
            competition: 'AFLM',
            season_year: set.seasonYear,
            availability: 'measured',
            completion_state: 'completed',
            reason_code: null,
            effective_at: match.effectiveAt,
            recorded_at: input.custodyAt,
            candidate_sha256: fact.content.source.candidateDigests.match,
            candidate_digests_json: fact.content.source.candidateDigests,
            fact_sha256: fact.factSha256,
            fact_json: fact,
          });
          await put('outcome_factual_reconciliation_match_input', {
            factual_run_id: universe.factualRunId,
            match_fact_id: factId,
            ordinal: index + 1,
            membership_sha256: sha256AflTradeCanonicalJson({ factId }),
            membership_json: { fixture: true },
          });
        }
      }
      let ordinal = 0;
      for (const appearance of universe.playerAppearanceFacts) {
        const row = set.rows.find(
          (row) =>
            row.kind === 'player_match_stats' &&
            row.role === 'primary' &&
            row.player.canonicalId === appearance.playerId &&
            row.match.canonicalId === appearance.matchId
        )!;
        const suffix = row.source.providerDecodedRowId;
        const side = appearance.clubId === 'club:a' ? 'home' : 'away';
        const sourceAuthority = prepared.sourceAuthorities.find(
          (source) => source.document.run.normalizationRunId === row.source.normalizationRunId
        )!;
        const fact = sourceFactForRow(sourceAuthority, row, input.custodyAt);
        if (fact.content.factKind !== 'player_appearance')
          throw new Error('Expected a synthetic appearance fact.');
        for (const factId of [fact.factId]) {
          await put('outcome_provider_player_appearance_fact', {
            appearance_fact_id: factId,
            fact_batch_id: addressed('source-fact-batch', { season: set.seasonYear }),
            normalization_run_id: row.source.normalizationRunId,
            provider_decoded_row_id: suffix,
            appearance_candidate_id: fact.content.appearanceCandidate.candidateId,
            identity_candidate_id: addressed('provider-identity-candidate', suffix),
            match_candidate_id: addressed('provider-match-candidate', suffix),
            player_resolution_decision_id: addressed(
              'provider-resolution-decision',
              `player:${suffix}`
            ),
            player_assignment_decision_id: addressed(
              'provider-resolution-decision',
              `player:${suffix}`
            ),
            match_resolution_decision_id: addressed(
              'provider-resolution-decision',
              `match:${suffix}`
            ),
            match_assignment_decision_id: addressed(
              'provider-resolution-decision',
              `match:${suffix}`
            ),
            represented_club_resolution_decision_id: addressed(
              'provider-resolution-decision',
              `${side}:${suffix}`
            ),
            represented_club_assignment_decision_id: addressed(
              'provider-resolution-decision',
              `${side}:${suffix}`
            ),
            player_identity_id: addressed('provider-player-identity', `player:${suffix}`),
            match_identity_id: addressed('provider-match-identity', `match:${suffix}`),
            represented_club_identity_id: addressed('provider-club-identity', `${side}:${suffix}`),
            player_id: appearance.playerId,
            match_id: appearance.matchId,
            represented_club_id: appearance.clubId,
            competition: 'AFLM',
            season_year: set.seasonYear,
            availability: 'measured',
            appeared: true,
            reason_code: null,
            effective_at: set.completedMatches[0]!.effectiveAt,
            recorded_at: input.custodyAt,
            candidate_sha256: fact.content.appearanceCandidate.candidateSha256,
            candidate_digests_json: fact.content.source.candidateDigests,
            fact_sha256: fact.factSha256,
            fact_json: fact,
          });
          await put('outcome_factual_reconciliation_appearance_input', {
            factual_run_id: universe.factualRunId,
            appearance_fact_id: factId,
            ordinal: ++ordinal,
            membership_sha256: sha256AflTradeCanonicalJson({ factId }),
            membership_json: { fixture: true },
          });
        }
      }
    }
    await transaction.query("SET LOCAL session_replication_role='origin'");
  });
  const repository = new PostgresAflTradeHpnPavInputRepository(sql);
  for (const map of maps) await repository.registerFieldMap(map, { environment: 'non_production' });
  return { ...prepared, seasons, maps };
}

function sourceFactForRow(
  sourceAuthority: {
    document: NumericalFixture['sourceDocuments'][number];
    captureId: string;
    fieldMap: unknown;
  },
  row: NumericalFixture['sourceDocuments'][number]['rows'][number],
  custodyAt: string
) {
  const suffix = row.source.providerDecodedRowId;
  const run = sourceAuthority.document.run;
  const sourceRowNumber =
    sourceAuthority.document.rows.findIndex(
      (candidate) => candidate.source.providerDecodedRowId === suffix
    ) + 1;
  const ref = (prefix: string, value: unknown) => {
    const id = addressed(prefix, value);
    return { id, sha256: id.split(':')[1]! };
  };
  const candidateSha = sha256AflTradeCanonicalJson({ fixture: true, decodedRowId: suffix });
  const normalizationFinalization = ref('provider-normalization-finalization', {
    normalizationRunId: run.normalizationRunId,
    stagingSha256: run.stagingSha256,
    finalizedAt: custodyAt,
  });
  const assignment = (kind: string, entityKind: 'player' | 'club' | 'match') => ({
    assignmentCaseId: addressed('provider-identity-assignment-case', `${kind}:${suffix}`),
    entityKind,
    revision: 1,
    decisionId: addressed('provider-resolution-decision', `${kind}:${suffix}`),
    status: 'active' as const,
  });
  const resolutionBase = (kind: string) => ({
    resolutionCaseId: addressed('provider-resolution-case', `${kind}:${suffix}`),
    revision: 1,
    decision: ref('provider-resolution-decision', `${kind}:${suffix}`),
    canonicalTargetSnapshot: ref('canonical-target-snapshot', `${kind}:${suffix}`),
  });
  const match = {
    ...resolutionBase('match'),
    matchCandidateId: addressed('provider-match-candidate', suffix),
    matchIdentityId: addressed('provider-match-identity', `match:${suffix}`),
    matchId: row.match.canonicalId,
    canonicalMatchDate: `${run.seasonYear}-03-20T10:00:00.000Z`,
    canonicalRoundLabel: 'Synthetic final',
    homeClub: {
      clubId: 'club:a',
      resolutionDecision: ref('provider-resolution-decision', `home:${suffix}`),
      assignment: assignment('home', 'club'),
    },
    awayClub: {
      clubId: 'club:b',
      resolutionDecision: ref('provider-resolution-decision', `away:${suffix}`),
      assignment: assignment('away', 'club'),
    },
    assignment: assignment('match', 'match'),
  };
  const source = {
    captureId: sourceAuthority.captureId,
    normalizationRunId: run.normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt: custodyAt,
    stagingSha256: run.stagingSha256,
    providerDecodedRowId: suffix,
    sourceRowNumber,
    sourceRowSha256: sha256AflTradeCanonicalJson(row.source.sourceValues),
    semanticNaturalKeySha256: sha256AflTradeCanonicalJson({ fixture: suffix }),
    candidateDigests: {
      identity: row.kind === 'player_match_stats' ? candidateSha : null,
      match: candidateSha,
      metric: null,
      achievement: null,
      appearance: null as string | null,
    },
    rowStatus: 'staged',
    issueSet: ref('provider-resolution-issue-set', suffix),
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    consumedSourceFields: row.source.sourceFields,
  };
  const base = {
    schemaVersion: 'afl-trade-source-fact/v1',
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'non_production',
    provider: run.provider,
    capabilityId: run.capabilityId,
    competition: 'AFLM',
    seasonYear: run.seasonYear,
    fieldMapSha256: sha256AflTradeCanonicalJson(sourceAuthority.fieldMap),
    effectiveAt: match.canonicalMatchDate,
    recordedAt: custodyAt,
    source,
  };
  if (row.kind === 'completed_match_result')
    return createAflTradeSourceFact({
      ...base,
      factKind: 'match_universe',
      matchCandidateId: match.matchCandidateId,
      match,
      completionPolicy: ref('match-universe-policy', { fixture: true }),
      completion: { state: 'completed', providerStatus: 'completed' },
    });
  const identityCandidateId = addressed('provider-identity-candidate', suffix);
  const appearanceCandidate = createAflTradeProviderAppearanceCandidate({
    schemaVersion: 'afl-trade-provider-appearance-candidate/v1',
    environment: 'non_production',
    provider: run.provider,
    capabilityId: run.capabilityId,
    competition: 'AFLM',
    seasonYear: run.seasonYear,
    captureId: source.captureId,
    normalizationRunId: run.normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt: custodyAt,
    stagingSha256: run.stagingSha256,
    providerDecodedRowId: suffix,
    sourceRowNumber,
    sourceRowSha256: source.sourceRowSha256,
    semanticNaturalKeySha256: source.semanticNaturalKeySha256,
    fieldMapSha256: base.fieldMapSha256,
    identityCandidateId,
    identityCandidateSha256: candidateSha,
    matchCandidateId: match.matchCandidateId,
    matchCandidateSha256: candidateSha,
    appearanceState: 'observed',
    sourceFields: source.consumedSourceFields,
    derivationPolicy: ref('player-appearance-policy', { fixture: true }),
  });
  source.candidateDigests.appearance = appearanceCandidate.candidateSha256;
  const side = row.club.canonicalId === 'club:a' ? 'home' : 'away';
  return createAflTradeSourceFact({
    ...base,
    factKind: 'player_appearance',
    player: {
      ...resolutionBase('player'),
      mappingScope: 'provider_identity',
      identityCandidateId,
      playerIdentityId: addressed('provider-player-identity', `player:${suffix}`),
      playerId: row.player.canonicalId,
      assignment: assignment('player', 'player'),
    },
    representedClub: {
      ...resolutionBase(side),
      mappingScope: 'provider_identity',
      occurrence: { source: 'player_affiliation', identityCandidateId },
      clubIdentityId: addressed('provider-club-identity', `${side}:${suffix}`),
      clubId: row.club.canonicalId,
      assignment: assignment(side, 'club'),
    },
    match,
    appearanceCandidate,
    appearanceState: 'observed',
  });
}

async function insertFixtureRecord(
  sql: AflOutcomeSqlTransaction,
  table: string,
  record: Record<string, unknown>
) {
  const entries = Object.entries(record);
  await sql.query(
    `INSERT INTO "${table}" (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(',')}) ON CONFLICT DO NOTHING`,
    entries.map(([, value]) =>
      typeof value === 'object' && value !== null ? canonicalizeAflTradeJson(value) : value
    )
  );
}

async function seedFixtureResolutionRows(
  sql: AflOutcomeSqlTransaction,
  row: NumericalFixture['sourceDocuments'][number]['rows'][number],
  provider: string,
  seasonYear: number,
  custodyAt: string
) {
  const suffix = row.source.providerDecodedRowId;
  const matchCandidateId = addressed('provider-match-candidate', suffix);
  const candidate = { fixture: true, decodedRowId: suffix };
  await insertFixtureRecord(sql, 'outcome_provider_match_candidate', {
    match_candidate_id: matchCandidateId,
    provider_decoded_row_id: suffix,
    provider,
    native_match_id: row.match.canonicalId,
    round_label: 'Synthetic final',
    match_date_text: `${seasonYear}-03-20`,
    home_club_native_id: 'club:a',
    home_club_name: 'club:a',
    away_club_native_id: 'club:b',
    away_club_name: 'club:b',
    provider_status: 'completed',
    order_independent_sha256: sha256AflTradeCanonicalJson(candidate),
    candidate_sha256: sha256AflTradeCanonicalJson(candidate),
    candidate_canonical_json: canonicalizeAflTradeJson(candidate),
    candidate_json: candidate,
  });
  if (row.kind === 'player_match_stats')
    await insertFixtureRecord(sql, 'outcome_provider_identity_candidate', {
      identity_candidate_id: addressed('provider-identity-candidate', suffix),
      provider_decoded_row_id: suffix,
      provider,
      entity_kind: 'player',
      native_entity_id: row.player.canonicalId,
      recorded_name: row.player.canonicalId,
      recorded_club_id: row.club.canonicalId,
      recorded_club_name: row.club.canonicalId,
      locator_sha256: sha256AflTradeCanonicalJson(candidate),
      candidate_sha256: sha256AflTradeCanonicalJson(candidate),
      candidate_canonical_json: canonicalizeAflTradeJson(candidate),
      candidate_json: candidate,
    });
  for (const [kind, canonicalId] of [
    ['match', row.match.canonicalId],
    ['home', 'club:a'],
    ['away', 'club:b'],
    ...(row.kind === 'player_match_stats' ? [['player', row.player.canonicalId]] : []),
  ]) {
    const entity = kind === 'match' ? 'match' : kind === 'player' ? 'player' : 'club';
    const resolutionId = addressed(`provider-${entity}-resolution`, `${kind}:${suffix}`);
    const resolutionCaseId = addressed('provider-resolution-case', `${kind}:${suffix}`);
    const decisionId = addressed('provider-resolution-decision', `${kind}:${suffix}`);
    const assignmentCaseId = addressed('provider-identity-assignment-case', `${kind}:${suffix}`);
    const identityId = addressed(`provider-${entity}-identity`, `${kind}:${suffix}`);
    await insertFixtureRecord(sql, 'outcome_provider_identity_assignment_head', {
      assignment_case_id: assignmentCaseId,
      entity_kind: entity,
      identity_id: identityId,
      revision: 1,
      decision_id: decisionId,
      status: 'active',
      updated_at: custodyAt,
    });
    const common = {
      resolution_id: resolutionId,
      resolution_case_id: resolutionCaseId,
      revision: 1,
      outcome: 'approved',
      assignment_case_id: assignmentCaseId,
      assignment_entity_kind: entity,
      assignment_identity_id: identityId,
      assignment_revision: 1,
      assignment_status: 'active',
      decision_id: decisionId,
      proposal_id: `fixture-proposal:${kind}:${suffix}`,
      resolution_sha256: sha256AflTradeCanonicalJson({ kind, suffix }),
      decided_at: custodyAt,
      effective_at: custodyAt,
      decision_json: { fixture: true },
    };
    if (entity === 'club') {
      await insertFixtureRecord(sql, 'outcome_provider_club_resolution', {
        ...common,
        occurrence_source: 'match_candidate',
        match_candidate_id: matchCandidateId,
        side: kind,
        club_identity_id: identityId,
        club_id: canonicalId,
        valid_from_season: seasonYear,
        valid_through_season: seasonYear,
      });
      await insertFixtureRecord(sql, 'outcome_provider_club_resolution_head', {
        resolution_case_id: resolutionCaseId,
        revision: 1,
        resolution_id: resolutionId,
        updated_at: custodyAt,
      });
    } else {
      const candidateKey = entity === 'player' ? 'identity_candidate_id' : 'match_candidate_id';
      const candidateId =
        entity === 'player' ? addressed('provider-identity-candidate', suffix) : matchCandidateId;
      await insertFixtureRecord(sql, `outcome_provider_${entity}_resolution`, {
        ...common,
        [candidateKey]: candidateId,
        [`${entity}_identity_id`]: identityId,
        [`${entity}_id`]: canonicalId,
      });
      await insertFixtureRecord(sql, `outcome_provider_${entity}_resolution_head`, {
        resolution_case_id: resolutionCaseId,
        [candidateKey]: candidateId,
        revision: 1,
        resolution_id: resolutionId,
        updated_at: custodyAt,
      });
    }
  }
}
