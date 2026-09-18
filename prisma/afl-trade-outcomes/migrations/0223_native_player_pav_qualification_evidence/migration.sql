-- Retain reviewed native player-PAV point assessments without granting model or Gate authority.
CREATE TABLE outcome_governed_native_player_pav_qualification_evidence (
  evidence_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  final_evaluation_id TEXT NOT NULL,
  final_evidence_artifact_id TEXT NOT NULL,
  criteria_id TEXT NOT NULL,
  criteria_artifact_id TEXT NOT NULL,
  calibration_configuration_artifact_id TEXT NOT NULL,
  evidence_artifact_id TEXT NOT NULL UNIQUE,
  support_status TEXT NOT NULL,
  assessment_status TEXT NOT NULL,
  qualification_granted BOOLEAN NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  content_canonical_json TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outcome_native_player_pav_qualification_run_fkey
    FOREIGN KEY (run_id) REFERENCES outcome_governed_valuation_component_run(run_id)
    ON DELETE RESTRICT,
  CONSTRAINT outcome_native_player_pav_qualification_final_artifact_fkey
    FOREIGN KEY (final_evidence_artifact_id) REFERENCES outcome_artifact_custody(artifact_id)
    ON DELETE RESTRICT,
  CONSTRAINT outcome_native_player_pav_qualification_criteria_artifact_fkey
    FOREIGN KEY (criteria_artifact_id) REFERENCES outcome_artifact_custody(artifact_id)
    ON DELETE RESTRICT,
  CONSTRAINT outcome_native_pav_qual_calibration_artifact_fkey
    FOREIGN KEY (calibration_configuration_artifact_id)
    REFERENCES outcome_artifact_custody(artifact_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_native_player_pav_qualification_evidence_artifact_fkey
    FOREIGN KEY (evidence_artifact_id) REFERENCES outcome_artifact_custody(artifact_id)
    ON DELETE RESTRICT,
  CONSTRAINT outcome_native_player_pav_qualification_run_criteria_key
    UNIQUE (run_id,criteria_id),
  CONSTRAINT outcome_native_player_pav_qualification_shape CHECK ((
    evidence_id ~ '^native-player-pav-qualification-evidence:[a-f0-9]{64}$'
    AND final_evaluation_id ~ '^native-pav-final-evaluation:[a-f0-9]{64}$'
    AND criteria_id ~ '^native-player-pav-qualification-criteria:[a-f0-9]{64}$'
    AND final_evidence_artifact_id ~ '^artifact:[a-f0-9]{64}$'
    AND criteria_artifact_id ~ '^artifact:[a-f0-9]{64}$'
    AND calibration_configuration_artifact_id ~ '^artifact:[a-f0-9]{64}$'
    AND evidence_artifact_id ~ '^artifact:[a-f0-9]{64}$'
    AND support_status IN (
      'complete_common_distribution_support',
      'incomplete_distribution_support',
      'empty_paired_support'
    )
    AND assessment_status='inconclusive'
    AND qualification_granted=FALSE
    AND content_canonical_json=outcome_afl_trade_canonical_json(evidence_json->'content')
    AND content_sha256=encode(sha256(convert_to(content_canonical_json,'UTF8')),'hex')
    AND evidence_id='native-player-pav-qualification-evidence:'||content_sha256
    AND evidence_json->>'evidenceId'=evidence_id
    AND evidence_json#>>'{content,schemaVersion}'=
      'governed-native-player-pav-qualification-evidence/v1'
    AND evidence_json#>>'{content,authorityBoundary}'=
      'authenticated_inconclusive_no_qualification_authority'
    AND evidence_json#>>'{content,finalEvaluationId}'=final_evaluation_id
    AND evidence_json#>>'{content,finalEvidenceArtifact,artifactId}'=final_evidence_artifact_id
    AND evidence_json#>>'{content,criteriaId}'=criteria_id
    AND evidence_json#>>'{content,criteriaArtifact,artifactId}'=criteria_artifact_id
    AND evidence_json#>>'{content,calibrationConfigurationArtifact,artifactId}'=
      calibration_configuration_artifact_id
    AND evidence_json#>>'{content,support,status}'=support_status
    AND evidence_json#>>'{content,assessment,status}'=assessment_status
    AND evidence_json#>'{content,acceptanceInput,precision}'='null'::JSONB
    AND (evidence_json#>>'{content,qualificationGranted}')::BOOLEAN=qualification_granted
    AND (evidence_json#>>'{content,assessment,qualificationGranted}')::BOOLEAN=FALSE
  ) IS TRUE)
);

CREATE INDEX outcome_native_player_pav_qualification_run_idx
  ON outcome_governed_native_player_pav_qualification_evidence(run_id,recorded_at,evidence_id);

CREATE TRIGGER outcome_native_player_pav_qualification_immutable
  BEFORE UPDATE OR DELETE ON outcome_governed_native_player_pav_qualification_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();
CREATE TRIGGER outcome_native_player_pav_qualification_no_truncate
  BEFORE TRUNCATE ON outcome_governed_native_player_pav_qualification_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION reject_outcome_append_only_mutation();
