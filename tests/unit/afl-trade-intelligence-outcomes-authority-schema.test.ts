import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = join(process.cwd(), 'prisma', 'afl-trade-outcomes', 'schema.prisma');
const migrationPath = join(
  process.cwd(),
  'prisma',
  'afl-trade-outcomes',
  'migrations',
  '0002_normalized_analytical_authority',
  'migration.sql'
);
const schema = readFileSync(schemaPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');
const providerStagingMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0003_provider_observation_staging',
    'migration.sql'
  ),
  'utf8'
);
const providerResolutionMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0004_governed_provider_resolution',
    'migration.sql'
  ),
  'utf8'
);
const factualObservationMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0005_factual_observations',
    'migration.sql'
  ),
  'utf8'
);
const achievementReconciliationMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0006_reconciled_achievements',
    'migration.sql'
  ),
  'utf8'
);
const factualReleaseCandidateMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0007_factual_release_v2_candidate',
    'migration.sql'
  ),
  'utf8'
);
const sealedFactualProjectionMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0008_sealed_factual_projection_items',
    'migration.sql'
  ),
  'utf8'
);
const publicRuntimeAuthorityMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0009_public_runtime_authority',
    'migration.sql'
  ),
  'utf8'
);
const externalCanonicalPromotionMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0014_external_candidate_promotion',
    'migration.sql'
  ),
  'utf8'
);
const operationalAuthorityRoleUnionMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0038_restore_operational_authority_role_union',
    'migration.sql'
  ),
  'utf8'
);

describe('isolated AFL outcomes analytical authority schema', () => {
  it('admits the separately scoped canonical promoter role at the database boundary', () => {
    expect(externalCanonicalPromotionMigration).toContain(
      "'afl_trade_identity_reviewer', 'afl_trade_canonical_promoter'"
    );
    expect(externalCanonicalPromotionMigration).toContain(
      "authority.role='afl_trade_canonical_promoter'"
    );
    expect(externalCanonicalPromotionMigration).toContain(
      "authority.capability_id='external_candidate_promotion'"
    );
  });

  it('preserves every governed operational role when extending the shared authority table', () => {
    for (const role of [
      'afl_trade_identity_reviewer',
      'afl_trade_canonical_promoter',
      'afl_trade_external_identity_reviewer',
      'afl_trade_model_run_operator',
    ]) {
      expect(operationalAuthorityRoleUnionMigration).toContain(`'${role}'`);
    }
  });

  it('owns the complete public provenance, factual, review, lineage, and release chain', () => {
    for (const model of [
      'OutcomeArtifactCustody',
      'OutcomeSourceCaptureAttempt',
      'OutcomeSourceCapture',
      'OutcomeSourceCaptureSeason',
      'OutcomeImportRun',
      'OutcomeImportRow',
      'OutcomeImportPartition',
      'OutcomeImportPartitionRow',
      'OutcomeCompetitionSeason',
      'OutcomeClub',
      'OutcomePlayer',
      'OutcomePlayerIdentity',
      'OutcomePlayerIdentityAssignment',
      'OutcomeMatch',
      'OutcomeMetricDefinition',
      'OutcomePlayerStatObservation',
      'OutcomePlayerStatMetric',
      'OutcomeEvent',
      'OutcomeEventVersion',
      'OutcomeEventParty',
      'OutcomeEventAsset',
      'OutcomeDraftPick',
      'OutcomeDraftSelection',
      'OutcomePickLineageEdge',
      'OutcomeReviewDecision',
      'OutcomeDataException',
      'OutcomeReconciliationRun',
      'OutcomeCorrection',
      'OutcomeAcquisitionSpellRule',
      'OutcomeAcquisitionSpellVersion',
      'OutcomeReleaseEventVersion',
      'OutcomeReleaseStatObservation',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it('preserves the workbook acquisition mechanisms as closed governed values', () => {
    const acquisitionEnum = schema.match(/enum OutcomeAcquisitionMechanism \{([\s\S]*?)\n\}/)?.[1];
    expect(acquisitionEnum?.trim().split(/\s+/)).toEqual([
      'national_draft',
      'rookie_draft',
      'midseason_draft',
      'preseason_draft',
      'mini_draft',
      'trade',
      'free_agency',
      'pre_draft',
      'post_draft',
      'training_squad',
    ]);
    expect(migration).toContain('outcome_event_version_kind_mechanism_check');
  });

  it('keeps observed identities immutable and resolves them through reviewed assignments', () => {
    const identityModel = schema.match(/model OutcomePlayerIdentity \{([\s\S]*?)\n\}/)?.[1];
    expect(identityModel).toContain('identitySha256');
    expect(identityModel).not.toMatch(/\bplayerId\b|resolutionState/);
    expect(schema).toMatch(
      /model OutcomePlayerIdentityAssignment \{[\s\S]*decision\s+OutcomeReviewDecision/
    );
    expect(migration).toContain('outcome_player_identity_assignment_chain_integrity');
  });

  it('uses typed release membership with database-enforced target foreign keys', () => {
    expect(schema).not.toContain('model OutcomeReleaseMember {');
    for (const table of [
      'outcome_release_source_capture',
      'outcome_release_event_version',
      'outcome_release_stat_observation',
      'outcome_release_identity_assignment',
      'outcome_release_pick_lineage',
      'outcome_release_acquisition_spell',
      'outcome_release_reconciliation',
      'outcome_release_review_decision',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain('validate_outcome_release_membership');
    expect(migration).toContain("table_name || '_eligibility'");
    expect(migration).toContain('reject_outcome_registered_release_membership_insert');
    expect(migration).toContain("table_name || '_registered_release_guard'");
    expect(migration).toContain('reject_outcome_released_child_insert');
    expect(migration).toContain("'outcome-release-parent:' || target_id");
    expect(migration).toContain('\'outcome-release-membership:\' || NEW."release_id"');
    expect(migration).toContain('same-release, same-environment, same-season source provenance');
    expect(migration).toContain('JOIN "outcome_import_partition_row" partition_row');
    expect(migration).toContain('partition."season_year" = target_season_year');
    expect(migration).toContain('outcome_event_asset_released_parent_insert_guard');
    expect(migration).toContain('outcome_player_stat_metric_released_parent_insert_guard');
    expect(migration).toContain("table_name || '_append_only'");
    expect(migration).toContain(
      'Each provider-field-map decision must supersede its sole current decision'
    );
  });

  it('enforces null-versus-zero, typed assets, event chains, and exact active releases natively', () => {
    for (const constraint of [
      'outcome_player_metric_availability_check',
      'outcome_event_asset_typed_payload_check',
      'outcome_registry_event_chain_integrity',
      'outcome_registry_head_exact_event_fkey',
      'outcome_active_release_exact_activation',
      'outcome_source_capture_custody_integrity',
      'outcome_source_capture_anchor_scope',
      'outcome_source_capture_season_insert_guard',
      'outcome_import_run_capture_scope_lock',
      'outcome_import_partition_scope_integrity',
      'outcome_player_stat_observation_capture_scope_fkey',
      'outcome_import_partition_row_partition_run_fkey',
      'outcome_import_partition_row_row_run_fkey',
      'outcome_player_stat_observation_match_id_competition_seaso_fkey',
      'outcome_pick_lineage_no_self_check',
      'outcome_acquisition_spell_version_chain_integrity',
      'outcome_acquisition_spell_metric_coverage_check',
      'outcome_draft_selection_approved_player_check',
    ]) {
      expect(migration).toContain(constraint);
    }
    expect(schema).toMatch(
      /model OutcomeMetricDefinition \{[\s\S]*@@id\(\[metricCode, definitionVersion\]\)/
    );
    expect(schema).toMatch(
      /model OutcomePlayerStatMetric \{[\s\S]*definitionVersion[\s\S]*references: \[metricCode, definitionVersion\]/
    );
    expect(schema).toMatch(/model OutcomeAcquisitionSpellMetric \{[\s\S]*numericValue\s+Decimal\?/);
    expect(schema).toMatch(/model OutcomeEventAsset \{[\s\S]*playerIdentityId/);
    expect(schema).toMatch(/model OutcomeDraftSelection \{[\s\S]*playerIdentityId/);
    expect(schema).toMatch(
      /match\s+OutcomeMatch\?[\s\S]*fields: \[matchId, competition, seasonYear\]/
    );
    expect(migration).toContain('exact reviewed identity assignment');
    expect(migration).toContain('review."subject_type" = \'player_identity\'');
    expect(migration).toContain('asset."player_id" = spell."player_id"');
    expect(migration).toContain('asset."to_club_id" = spell."club_id"');
    expect(migration).toContain('parent_pick."status" = \'approved\'');
    expect(migration).toContain('event_member."release_id" = NEW."release_id"');
    expect(migration).toContain('knowledge and effective times are within the release cutoff');
    expect(migration).toContain('only approved canonical clubs, players, and picks');
    expect(migration).toContain('no post-cutoff evidence');
    expect(migration).toContain('outcome_source_capture_attempt_referenced_guard');
    expect(migration).toContain("'outcome_import_run'");
    expect(migration).toContain("'outcome_club'");
    expect(migration).toContain("'outcome_player'");
    expect(migration).toContain("'outcome_reconciliation_run'");
    expect(migration).toContain("'outcome_metric_definition'");
  });

  it('has no fantasy ownership or Firestore authority coupling', () => {
    expect(schema).not.toMatch(
      /\b(?:User|League|Membership|Roster|FantasyTeam|Firebase|Firestore|LeagueTrade)\b/
    );
    expect(migration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
    expect(schema).toContain('env("AFL_OUTCOMES_DATABASE_URL")');
  });

  it('stages all fitzRoy rows and unresolved candidates before canonical identity resolution', () => {
    for (const model of [
      'OutcomeProviderFieldMap',
      'OutcomeProviderNormalizationRun',
      'OutcomeProviderNormalizationAttempt',
      'OutcomeProviderDecodedRow',
      'OutcomeProviderIdentityCandidate',
      'OutcomeProviderMatchCandidate',
      'OutcomeProviderMetricCandidate',
      'OutcomeProviderAchievementCandidate',
      'OutcomeProviderNormalizationIssue',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const invariant of [
      'outcome_provider_decoded_row_run_capture_fkey',
      'outcome_provider_decoded_row_capture_scope_fkey',
      'outcome_provider_metric_candidate_value_check',
      'outcome_provider_normalization_count_check',
      'validate_outcome_provider_normalization_run',
      'outcome-capture-scope:',
      'outcome-review-subject:provider_field_map:',
      'validate_outcome_provider_normalization_finalization',
      'reject_outcome_provider_child_after_finalization',
      'Provider child records require a visible normalization-run parent',
      'Provider candidate records require a visible decoded-row parent',
      'fieldMapSha256',
      'normalizer_version',
      'staging_sha256',
      'candidate_canonical_json',
      'candidate_sha256',
      "table_name || '_append_only'",
    ]) {
      expect(providerStagingMigration).toContain(invariant);
    }
    expect(migration).toContain('\'outcome-review-subject:\' || NEW."subject_type"');
    expect(providerStagingMigration).not.toMatch(
      /INSERT INTO (?:outcome_player\b|outcome_club\b|outcome_match\b|outcome_release_|outcome_projection_)/i
    );
    expect(providerStagingMigration).not.toMatch(/\b(?:user_id|league_id|firestore|fantasy)\b/i);
  });

  it('governs provider identity resolution without fantasy ownership or self-asserted evidence', () => {
    for (const model of [
      'OutcomeGovernedEvidenceReference',
      'OutcomeOperationalPrincipalAuthority',
      'OutcomeProviderNativeIdNamespace',
      'OutcomeProviderResolutionProposal',
      'OutcomeProviderPlayerResolution',
      'OutcomeProviderClubResolution',
      'OutcomeProviderMatchResolution',
      'OutcomeProviderIdentityAssignmentHead',
      'OutcomeLegacyMatchProviderKey',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const invariant of [
      'validate_outcome_governed_review_leaf',
      'validate_outcome_governed_evidence',
      "encode(sha256(convert_to(NEW.evidence_canonical_json,'UTF8')),'hex')",
      'validate_outcome_operational_authority',
      'valid_from_season',
      "proposal->'staging'->>'environment'",
      'validate_outcome_provider_native_namespace',
      'Current native-ID namespace validity ranges cannot overlap',
      'validate_outcome_provider_resolution_proposal',
      'Resolution proposal candidate payload mismatch',
      'Resolution proposal candidate digest mismatch',
      'fieldMapSha256',
      'validate_outcome_provider_issue_closure',
      'validate_outcome_provider_resolution_insert',
      'validate_outcome_provider_resolution_head',
      'validate_outcome_provider_assignment_head',
      'validate_outcome_provider_identity_root',
      'outcome_player_identity_legacy_provider_native_key',
      'New non-fixture provider player identities require a governed native-ID namespace',
      'reject_outcome_legacy_provider_assignment_insert',
      'validate_outcome_provider_identity_occurrence',
      'require_outcome_provider_typed_resolution',
      'Each provider resolution review decision requires exactly one matching typed resolution by commit',
      'require_outcome_governed_evidence_registry_role',
      'afl_trade_governance_registry_writer',
      'afl_trade_nonproduction_governance_registry_writer',
      'require_outcome_provider_governance_role',
      'afl_trade_identity_issue_reviewer',
      'afl_trade_nonproduction_identity_issue_reviewer',
      'Each native-ID namespace decision requires its exact environment-bound namespace by commit',
      'Each normalization-issue decision requires its exact environment-bound issue',
      'Match target requires exact current home/away club decisions',
      'outcome_match_provider_neutral_check',
      'outcome_legacy_match_provider_key_append_only',
      'outcome_legacy_match_provider_key_insert_guard',
      'statement_timestamp()',
      'A current reusable assignment must be deactivated before the resolution can change target',
      'Provider resolution occurrence count does not match its approved reusable identity scope',
    ]) {
      expect(providerResolutionMigration).toContain(invariant);
    }
    expect(providerResolutionMigration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
    const matchModel = schema.match(/model OutcomeMatch \{([\s\S]*?)\n\}/)?.[1];
    expect(matchModel).not.toMatch(/^\s*provider\s/m);
    expect(matchModel).not.toMatch(/^\s*nativeMatchId\s/m);
    expect(matchModel).toMatch(/^\s*legacyProvider\s+String\?.*@map\("provider"\) @ignore$/m);
    expect(matchModel).toMatch(
      /^\s*legacyNativeMatchId\s+String\?.*@map\("native_match_id"\) @ignore$/m
    );
  });

  it('keeps source facts separate from reconciled facts and derives games only from evidence', () => {
    for (const model of [
      'OutcomeProviderFactBatch',
      'OutcomeProviderAppearanceCandidate',
      'OutcomeProviderFactRowAccounting',
      'OutcomeProviderMatchUniverseFact',
      'OutcomeProviderPlayerAppearanceFact',
      'OutcomeProviderNumericMetricFact',
      'OutcomeProviderAchievementFact',
      'OutcomeFactualReconciliationPolicy',
      'OutcomeFactualReconciliationRun',
      'OutcomeFactualReconciliationMetricInput',
      'OutcomeFactualReconciliationAppearanceInput',
      'OutcomeFactualReconciliationMatchInput',
      'OutcomeReconciledFactualMetric',
      'OutcomeReconciledFactualMetricMember',
      'OutcomeReconciledFactualMetricHead',
      'OutcomeAcquisitionSpellMetricPolicy',
      'OutcomeAcquisitionSpellMetricBatch',
      'OutcomeAcquisitionSpellMetricVersion',
      'OutcomeAcquisitionSpellMetricVersionMember',
      'OutcomeAcquisitionSpellMetricHead',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const invariant of [
      'outcome_provider_fact_batch_counts_check',
      'outcome_provider_appearance_candidate_identity_check',
      'outcome_provider_appearance_candidate_observed_check',
      'outcome_provider_fact_row_accounting_disposition_check',
      'validate_outcome_provider_fact_batch',
      'Fact batch requires an exact finalized normalization run',
      'Fact batch child counts do not match its receipt',
      'reject_outcome_provider_fact_after_finalization',
      'validate_outcome_provider_fact_row_accounting',
      'validate_outcome_provider_match_fact',
      'validate_outcome_provider_appearance_fact',
      'validate_outcome_provider_metric_fact',
      'validate_outcome_provider_achievement_fact',
      'represented_club_resolution_decision_id',
      'outcome_provider_metric_fact_state_check',
      'outcome_factual_policy_approval_fkey',
      'validate_outcome_factual_reconciliation_run',
      'validate_outcome_reconciled_metric_members',
      'reject_source_games_metric',
      'games is derived from reconciled completed matches and appearances',
      'outcome_spell_metric_policy_approval_fkey',
      'validate_outcome_spell_metric_policy_review_chain',
      'validate_outcome_spell_metric_batch',
      'validate_outcome_spell_metric_member_insert',
      'Spell metric member must be the exact current reconciled player-club match fact inside the spell',
      'validate_outcome_spell_metric_head',
      'Spell metric head compare-and-swap revision is stale',
    ]) {
      expect(factualObservationMigration).toContain(invariant);
    }
    for (const model of [
      'OutcomeAchievementReconciliationPolicy',
      'OutcomeAchievementReconciliationRun',
      'OutcomeAchievementReconciliationInput',
      'OutcomeReconciledAchievement',
      'OutcomeReconciledAchievementMember',
      'OutcomeReconciledAchievementHead',
      'OutcomeFactualReleaseCandidate',
      'OutcomeReleaseReconciledMetricMember',
      'OutcomeReleaseReconciledAchievementMember',
      'OutcomeReleaseSpellMetricMember',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(factualObservationMigration).not.toMatch(
      /INSERT INTO (?:outcome_player_stat_observation|outcome_release_|outcome_projection_)/i
    );
    expect(factualObservationMigration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
  });

  it('reconciles achievements before private typed release construction', () => {
    for (const invariant of [
      'validate_outcome_achievement_policy_review',
      'validate_outcome_achievement_policy_insert',
      'validate_outcome_achievement_run',
      'validate_outcome_achievement_input',
      'validate_outcome_reconciled_achievement_insert',
      'validate_outcome_reconciled_achievement_member',
      'validate_outcome_reconciled_achievement_head',
      'Achievement head compare-and-swap revision is stale',
      'reject_outcome_achievement_child_after_finalization',
    ]) {
      expect(achievementReconciliationMigration).toContain(invariant);
    }
    expect(achievementReconciliationMigration).not.toMatch(
      /INSERT INTO (?:outcome_release_|outcome_projection_|outcome_active_release)/i
    );
    expect(achievementReconciliationMigration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
  });

  it('builds factual candidate v3 membership for a release-v2 before registration', () => {
    for (const table of [
      'outcome_factual_release_candidate',
      'outcome_release_factual_run_member',
      'outcome_release_reconciled_metric_member',
      'outcome_release_achievement_run_member',
      'outcome_release_reconciled_achievement_member',
      'outcome_release_spell_metric_member',
    ]) {
      expect(factualReleaseCandidateMigration).toContain(`CREATE TABLE "${table}"`);
    }
    for (const invariant of [
      'afl-trade-factual-release-candidate/v3',
      'afl-draft-trade-outcome-release/v2',
      "->'targetReleaseManifest'",
      'Release-v2 candidate requires an exact unregistered target release',
      'Finalized release-v2 candidate rejects late members',
      'Release-v2 forbids legacy stat-observation membership',
      'Release-v2 forbids legacy identity-assignment membership',
      'Release-v2 forbids legacy reconciliation membership',
      'Release-v2 registry events require one exact finalized candidate',
      'Candidate-backed releases must use the factual release-v2 contract',
      'Release-v2 requires an exact factual projection-v2 source root',
      'Release-v2 metric members are stale, unfinalized, or post-cutoff',
      'Release-v2 achievement members are stale, unfinalized, or post-cutoff',
      'Release-v2 spell metrics are stale, unfinalized, or post-cutoff',
      'Release-v2 source-capture count mismatch',
      'Release-v2 factual-run count mismatch',
      'Release-v2 achievement count mismatch',
      'Release-v2 spell-metric count mismatch',
      'outcome-release-membership:',
    ]) {
      expect(factualReleaseCandidateMigration).toContain(invariant);
    }
    expect(factualReleaseCandidateMigration).not.toMatch(
      /INSERT INTO (?:outcome_registry_event|outcome_projection_manifest|outcome_active_release)/i
    );
    expect(factualReleaseCandidateMigration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
  });

  it('seals factual projection list rows with an independently recomputed public root', () => {
    expect(schema).toContain('model OutcomeFactualProjectionItemSet {');
    for (const invariant of [
      'afl-trade-factual-projection-item-set/v1',
      'searchable_public_list_rows_no_exports_valuation_or_fantasy_ownership',
      'Factual projection item canonical bytes, digest, or index fields mismatch',
      'Factual projection item-set count or digest mismatch',
      'Factual release validation requires its exact finalized public item set',
      'Finalized factual projection items are immutable',
      'Factual projection requires a candidate finalized before its manifest',
      'Factual release event requires its exact projection-v2 record state',
      "COALESCE(NEW.\"event_json\"->'content'->'affectedRecordStates'",
      'COALESCE(',
      'sha256(convert_to(',
      'outcome-factual-projection-items:',
    ]) {
      expect(sealedFactualProjectionMigration).toContain(invariant);
    }
    expect(sealedFactualProjectionMigration).not.toContain('CREATE EXTENSION');
    expect(sealedFactualProjectionMigration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
  });

  it('persists source authority and valuation publication state outside fantasy ownership', () => {
    for (const model of [
      'OutcomeSourceRightsProposal',
      'OutcomeGateLedgerHead',
      'OutcomeGateProposal',
      'OutcomeGateDecision',
      'OutcomeValuationPublicationRegistryHead',
      'OutcomeValuationPublicationManifest',
      'OutcomeValuationProjectionManifest',
      'OutcomeValuationPublicationEvent',
      'OutcomeValuationActivePublication',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }

    const authorityModels = schema.slice(schema.indexOf('model OutcomeSourceRightsProposal'));
    expect(authorityModels).not.toMatch(
      /\b(?:User|League|Membership|Roster|FantasyTrade|Firestore)\b/
    );

    for (const invariant of [
      'outcome_source_rights_fitzroy_capability_check',
      "jsonb_array_length(\"content_json\"->'content'->'acquisition'->'capabilities') = 1",
      'outcome_gate_decision_approval_expiry_check',
      'validate_outcome_gate_decision_insert',
      'Gate decisions must form one chronological linear chain',
      'outcome_gate_ledger_commit_check',
      'Gate ledger head revision must equal its immutable decision count',
      'validate_outcome_valuation_projection_insert',
      '\'public_projection\'::"OutcomeArtifactClass"',
      'outcome_valuation_registry_commit_check',
      'Valuation registry revision must equal its immutable event count',
      'validate_outcome_valuation_active_pointer',
      'Active valuation pointer does not match the published registry head',
      'outcome_source_rights_proposal_append_only',
      'outcome_gate_decision_append_only',
      'outcome_valuation_publication_event_append_only',
    ]) {
      expect(publicRuntimeAuthorityMigration).toContain(invariant);
    }
    expect(publicRuntimeAuthorityMigration).not.toMatch(
      /\b(?:user_id|league_id|membership_id|roster_id|fantasy_team_id|firestore)\b/i
    );
  });
});
