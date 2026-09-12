-- Registration augments the existing acquisition owner. Legacy immutable receipts are retained.
ALTER TABLE outcome_acquisition_spell_rule
  ADD COLUMN registration_canonical_json TEXT,
  ADD COLUMN registration_approval_decision_id TEXT REFERENCES outcome_review_decision(decision_id),
  ADD COLUMN registered_at TIMESTAMPTZ(3),
  ADD CONSTRAINT outcome_acquisition_rule_registration_tuple CHECK (
    (registration_canonical_json IS NULL AND registration_approval_decision_id IS NULL AND registered_at IS NULL
      AND definition_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-acquisition-registration-rule/v1') OR
    (registration_canonical_json IS NOT NULL AND registration_approval_decision_id IS NOT NULL AND registered_at IS NOT NULL)
  );

CREATE FUNCTION outcome_acquisition_registration_evidence_exact(
  refs JSONB, target_environment TEXT, evidence_cutoff TIMESTAMPTZ, verified_cutoff TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_typeof(refs)='array' AND jsonb_array_length(refs) BETWEEN 1 AND 50
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(refs) WITH ORDINALITY item(ref,ordinal)
      LEFT JOIN outcome_artifact_custody custody ON custody.artifact_id=ref->>'artifactId'
      WHERE custody.artifact_id IS NULL
        OR custody.environment::TEXT IS DISTINCT FROM target_environment
        OR custody.content_sha256::TEXT IS DISTINCT FROM ref->>'contentSha256'
        OR custody.storage_uri IS DISTINCT FROM ref->>'storageUri'
        OR custody.media_type IS DISTINCT FROM ref->>'mediaType'
        OR custody.byte_length IS DISTINCT FROM (ref->>'byteLength')::BIGINT
        OR custody.created_at IS DISTINCT FROM (ref->>'createdAt')::TIMESTAMPTZ
        OR custody.created_at>evidence_cutoff OR custody.verified_at>verified_cutoff
        OR custody.artifact_id IS DISTINCT FROM 'artifact:'||custody.content_sha256
        OR custody.storage_uri IS DISTINCT FROM 'artifact://sha256/'||custody.content_sha256
        OR ref IS DISTINCT FROM jsonb_build_object('artifactId',custody.artifact_id,
          'contentSha256',custody.content_sha256,'storageUri',custody.storage_uri,
          'mediaType',custody.media_type,'byteLength',custody.byte_length,'createdAt',ref->'createdAt')
        OR (ordinal>1 AND (refs->(ordinal::INTEGER-2)->>'artifactId') >= ref->>'artifactId')
    ),FALSE)
$$;

CREATE FUNCTION outcome_acquisition_registration_review_current(
  approval_id TEXT, target_type TEXT, target_id TEXT, record JSONB,
  proposal_at TIMESTAMPTZ, registered_at TIMESTAMPTZ, cutoff TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM outcome_review_decision review
    WHERE review.decision_id=approval_id AND review.subject_type=target_type
      AND review.subject_id=target_id AND review.decision='approved'
      AND review.evidence_json=record AND review.decided_at>=proposal_at
      AND review.decided_at<=registered_at AND registered_at<=cutoff
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=review.decision_id)
      AND 1=(SELECT count(*) FROM outcome_review_decision leaf
        WHERE leaf.subject_type=target_type AND leaf.subject_id=target_id
          AND NOT EXISTS (SELECT 1 FROM outcome_review_decision next
            WHERE next.supersedes_decision_id=leaf.decision_id))
  )
$$;

CREATE FUNCTION outcome_acquisition_rule_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM outcome_acquisition_spell_rule rule
    CROSS JOIN LATERAL (SELECT rule.definition_json->'content' AS c) content
    WHERE rule.rule_id=target_id AND rule.status='approved'
      AND rule.registration_canonical_json IS NOT NULL
      AND rule.registration_canonical_json=outcome_afl_trade_canonical_json(c)
      AND rule.rule_id='acquisition-spell-rule:'||encode(sha256(convert_to(rule.registration_canonical_json,'UTF8')),'hex')
      AND rule.definition_json=jsonb_build_object('ruleId',rule.rule_id,'content',c)
      AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration-rule/v1',
        'environment',c->'environment','competition',c->'competition','ruleVersion',rule.rule_version,
        'entry','exact_promoted_incoming_player_asset_on_event_date',
        'departure','exact_reviewed_departure_event_day_excluded',
        'intervals','inclusive_start_inclusive_end_no_same_club_overlap',
        'missingEvidence','reject_never_infer_from_appearances',
        'evidence',c->'evidence','createdAt',c->'createdAt')
      AND c->>'environment' IN ('test_fixture','non_production')
      AND c->>'competition' IN ('AFLM','AFLW')
      AND (c->>'createdAt')::TIMESTAMPTZ=rule.created_at
      AND outcome_acquisition_registration_evidence_exact(c->'evidence',c->>'environment',rule.created_at,rule.registered_at)
      AND outcome_acquisition_registration_review_current(rule.registration_approval_decision_id,
        'acquisition_spell_rule',rule.rule_id,rule.definition_json,rule.created_at,rule.registered_at,cutoff)
  )
$$;

CREATE FUNCTION require_outcome_acquisition_rule_registration() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registration_canonical_json IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:acquisition_spell_rule:'||NEW.rule_id,0));
    IF NEW.registered_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
      OR NOT outcome_acquisition_rule_registration_current(NEW.rule_id,transaction_timestamp()) THEN
      RAISE EXCEPTION 'Acquisition rule registration requires exact current review and retained evidence';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_acquisition_rule_registration_guard
  AFTER INSERT ON outcome_acquisition_spell_rule FOR EACH ROW
  EXECUTE FUNCTION require_outcome_acquisition_rule_registration();

ALTER TABLE outcome_acquisition_spell_version
  ADD COLUMN registration_canonical_json TEXT,
  ADD COLUMN registration_approval_decision_id TEXT REFERENCES outcome_review_decision(decision_id),
  ADD COLUMN registered_at TIMESTAMPTZ(3),
  ADD CONSTRAINT outcome_acquisition_spell_registration_tuple CHECK (
    (registration_canonical_json IS NULL AND registration_approval_decision_id IS NULL AND registered_at IS NULL) OR
    (registration_canonical_json IS NOT NULL AND registration_approval_decision_id IS NOT NULL AND registered_at IS NOT NULL)
  );

-- Both directions authenticate the exact promotion member and its retained source ancestry.
CREATE FUNCTION outcome_acquisition_registration_event_current(
  binding JSONB, target_player TEXT, target_club TEXT, target_environment TEXT,
  target_competition TEXT, incoming BOOLEAN, proposal_at TIMESTAMPTZ, cutoff TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_external_canonical_promotion promotion
  JOIN outcome_external_canonical_promotion_review_head head
    ON head.candidate_id=promotion.candidate_id AND head.decision_id=promotion.approval_decision_id
  JOIN outcome_external_canonical_promotion_review_decision typed ON typed.decision_id=head.decision_id
  JOIN outcome_review_decision review ON review.decision_id=typed.decision_id
  JOIN outcome_external_reconciliation_candidate candidate ON candidate.candidate_id=promotion.candidate_id
  JOIN outcome_external_canonical_promotion_record member ON member.promotion_id=promotion.promotion_id
  JOIN outcome_event_asset asset ON asset.asset_version_id=member.canonical_record_id
  JOIN outcome_event_version event ON event.event_version_id=asset.event_version_id
  JOIN outcome_event root ON root.event_id=event.event_id
  JOIN outcome_player player ON player.player_id=asset.player_id
  JOIN outcome_club club ON club.club_id=target_club
  WHERE promotion.promotion_id=binding->>'promotionId' AND promotion.status='finalized'
    AND promotion.environment::TEXT=target_environment AND promotion.competition=target_competition
    AND promotion.finalized_at<=proposal_at AND candidate.status='finalized'
    AND candidate.environment=promotion.environment AND candidate.competition=promotion.competition
    AND head.status='approved' AND typed.outcome='approved' AND review.decision='approved'
    AND typed.proposal_id=promotion.proposal_id
    AND EXISTS (
      SELECT 1 FROM outcome_operational_principal_authority authority
      JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
      JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
      WHERE authority.authority_evidence_id=typed.authority_evidence_id
        AND authority.principal_ref=review.decided_by AND authority.role='afl_trade_canonical_promoter'
        AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider='multi_source'
        AND authority.capability_id='external_candidate_promotion' AND authority.competition=target_competition
        AND candidate.anchor_season_year BETWEEN authority.valid_from_season AND authority.valid_through_season
        AND authority.valid_from<=cutoff AND (authority.valid_through IS NULL OR authority.valid_through>cutoff)
        AND evidence.environment::TEXT=target_environment AND evidence.status='approved' AND approval.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id)
    )
    AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=review.decision_id)
    AND asset.asset_version_id=binding->>'assetVersionId' AND event.event_version_id=binding->>'eventVersionId'
    AND member.record_kind IN ('transfer','draft_player_asset')
    AND member.source_import_row_id=asset.source_import_row_id
    AND asset.kind='player' AND asset.player_id=target_player AND asset.status='approved'
    AND (CASE WHEN incoming THEN asset.to_club_id ELSE asset.from_club_id END)=target_club
    AND player.status='approved' AND club.status='approved'
    AND event.status='approved' AND root.competition=target_competition
    AND event.event_date=(binding->>'eventDate')::DATE AND event.recorded_at<=proposal_at
    AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor WHERE successor.supersedes_version_id=event.event_version_id)
    AND EXISTS (
      SELECT 1 FROM outcome_external_canonical_promotion_record event_member
      WHERE event_member.promotion_id=promotion.promotion_id
        AND event_member.canonical_record_id=event.event_version_id
        AND event_member.record_kind IN ('transaction','draft_event')
        AND event_member.source_import_row_id=event.source_import_row_id
    )
    AND EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_identity_resolution identity
      JOIN outcome_external_identity_review_decision decision ON decision.decision_id=identity.review_decision_id
      JOIN outcome_external_identity_resolution_head identity_head ON identity_head.decision_id=decision.decision_id
      JOIN outcome_review_decision generic ON generic.decision_id=decision.decision_id
      WHERE identity.candidate_id=promotion.candidate_id AND identity.entity_kind='player'
        AND identity.canonical_id=target_player AND decision.canonical_target_id=target_player
        AND decision.decision_id=asset.external_identity_decision_id
        AND EXISTS (
          SELECT 1 FROM outcome_operational_principal_authority authority
          JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
          JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
          WHERE authority.authority_evidence_id=decision.authority_evidence_id
            AND authority.principal_ref=generic.decided_by AND authority.role='afl_trade_external_identity_reviewer'
            AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider=identity.provider
            AND authority.capability_id='external_identity_resolution' AND authority.competition=target_competition
            AND candidate.anchor_season_year BETWEEN authority.valid_from_season AND authority.valid_through_season
            AND authority.valid_from<=cutoff AND (authority.valid_through IS NULL OR authority.valid_through>cutoff)
            AND evidence.environment::TEXT=target_environment AND evidence.status='approved' AND approval.decision='approved'
            AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id)
        )
        AND decision.outcome='approved' AND identity_head.status='approved' AND generic.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=generic.decision_id)
    )
    AND outcome_acquisition_registration_evidence_exact(binding->'evidence',target_environment,proposal_at,cutoff)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(binding->'evidence') ref
      WHERE NOT EXISTS (
        SELECT 1 FROM outcome_external_evidence_row evidence
        JOIN outcome_external_evidence_batch batch ON batch.batch_id=evidence.batch_id
        JOIN outcome_external_reconciliation_source_batch source ON source.batch_id=batch.batch_id
        JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
        WHERE source.candidate_id=promotion.candidate_id AND batch.status='finalized'
          AND capture.status='approved' AND capture.environment::TEXT=target_environment
          AND capture.competition=target_competition AND capture.source_artifact_id=ref->>'artifactId'
          AND EXISTS (SELECT 1 FROM outcome_external_canonical_promotion_record source_member
            WHERE source_member.promotion_id=promotion.promotion_id
              AND source_member.canonical_record_id IN (asset.asset_version_id,event.event_version_id)
              AND source_member.evidence_ids ? evidence.evidence_id)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM outcome_external_canonical_promotion_record source_member
      CROSS JOIN LATERAL jsonb_array_elements_text(source_member.evidence_ids) source_id(id)
      LEFT JOIN outcome_external_evidence_row evidence ON evidence.evidence_id=source_id.id
      LEFT JOIN outcome_external_evidence_batch batch ON batch.batch_id=evidence.batch_id
      LEFT JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      WHERE source_member.promotion_id=promotion.promotion_id
        AND source_member.canonical_record_id IN (asset.asset_version_id,event.event_version_id)
        AND (capture.capture_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(binding->'evidence') ref
          WHERE ref->>'artifactId'=capture.source_artifact_id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_batch batch ON batch.batch_id=source.batch_id
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      WHERE source.candidate_id=promotion.candidate_id
        AND (batch.status<>'finalized' OR capture.status<>'approved')
    )
 )
$$;

CREATE FUNCTION outcome_acquisition_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_acquisition_spell_version spell
  JOIN outcome_acquisition_spell_rule rule ON rule.rule_id=spell.rule_id
  CROSS JOIN LATERAL (SELECT spell.registration_canonical_json::JSONB AS c) content
  WHERE spell.spell_version_id=target_id AND spell.status='approved'
    AND spell.registration_canonical_json IS NOT NULL
    AND spell.registration_canonical_json=outcome_afl_trade_canonical_json(c)
    AND spell.spell_version_id='acquisition-spell-version:'||encode(sha256(convert_to(spell.registration_canonical_json,'UTF8')),'hex')
    AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration/v1',
      'environment',c->'environment','competition',c->'competition','playerId',spell.player_id,
      'clubId',spell.club_id,'entry',c->'entry','departure',c->'departure','ruleId',spell.rule_id,
      'version',spell.version,'supersedesSpellVersionId',spell.supersedes_spell_version_id,
      'observedThrough',c->'observedThrough','continuityEvidence',c->'continuityEvidence','createdAt',c->'createdAt')
    AND c->>'environment'=rule.definition_json#>>'{content,environment}'
    AND c->>'competition'=rule.definition_json#>>'{content,competition}'
    AND outcome_acquisition_rule_registration_current(rule.rule_id,cutoff)
    AND (c->>'createdAt')::TIMESTAMPTZ=spell.recorded_at
    AND c#>>'{entry,eventVersionId}'=spell.start_event_version_id
    AND c#>>'{entry,assetVersionId}'=spell.start_asset_version_id
    AND (c#>>'{entry,eventDate}')::DATE=spell.start_date
    AND spell.start_date<=(c->>'observedThrough')::DATE
    AND (c->>'observedThrough')::DATE<=spell.recorded_at::DATE
    AND ((c->'departure'='null'::JSONB AND spell.end_date IS NULL AND spell.end_reason IS NULL)
      OR (jsonb_typeof(c->'departure')='object'
        AND spell.end_date=(c#>>'{departure,eventDate}')::DATE-1
        AND spell.end_reason='reviewed_departure' AND spell.end_date>=spell.start_date
        AND (c#>>'{departure,eventDate}')::DATE<=(c->>'observedThrough')::DATE
        AND outcome_acquisition_registration_event_current(c->'departure',spell.player_id,spell.club_id,
          c->>'environment',c->>'competition',FALSE,spell.recorded_at,cutoff)))
    AND outcome_acquisition_registration_event_current(c->'entry',spell.player_id,spell.club_id,
      c->>'environment',c->>'competition',TRUE,spell.recorded_at,cutoff)
    AND outcome_acquisition_registration_evidence_exact(c->'continuityEvidence',c->>'environment',spell.recorded_at,spell.registered_at)
    AND outcome_acquisition_registration_review_current(spell.registration_approval_decision_id,
      'acquisition_spell_registration',spell.spell_version_id,
      jsonb_build_object('spellVersionId',spell.spell_version_id,'content',c),spell.recorded_at,spell.registered_at,cutoff)
    AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
    AND ((spell.version=1 AND spell.supersedes_spell_version_id IS NULL AND spell.spell_id=spell.spell_version_id)
      OR EXISTS (SELECT 1 FROM outcome_acquisition_spell_version predecessor
        WHERE predecessor.spell_version_id=spell.supersedes_spell_version_id
          AND predecessor.registration_canonical_json IS NOT NULL
          AND predecessor.spell_id=spell.spell_id AND predecessor.player_id=spell.player_id
          AND predecessor.club_id=spell.club_id AND predecessor.version+1=spell.version
          AND predecessor.recorded_at<=spell.recorded_at))
 )
$$;

CREATE FUNCTION require_outcome_acquisition_spell_registration() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registration_canonical_json IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:acquisition_spell_registration:'||NEW.spell_version_id,0));
    IF NEW.registered_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
      OR NOT outcome_acquisition_spell_registration_current(NEW.spell_version_id,transaction_timestamp()) THEN
      RAISE EXCEPTION 'Acquisition spell registration requires exact current review and retained ancestry';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM outcome_acquisition_spell_rule WHERE rule_id=NEW.rule_id AND registration_canonical_json IS NOT NULL) THEN
    RAISE EXCEPTION 'Registered acquisition rules require registered spells';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_acquisition_spell_registration_guard
  AFTER INSERT ON outcome_acquisition_spell_version FOR EACH ROW
  EXECUTE FUNCTION require_outcome_acquisition_spell_registration();

-- Classification is taken from the original immutable assessment, never capture status
-- or a current-authority result that can turn false after revocation.
CREATE FUNCTION outcome_hpn_acquisition_spell_is_current(
  target_spell TEXT, target_row TEXT, target_run TEXT, target_map TEXT,
  effective_date DATE, cutoff TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE source RECORD; projected RECORD; assessment JSONB; source_first BOOLEAN;
BEGIN
  SELECT run.*,capture.environment,capture.competition,capture.provider,capture.capability_id AS capture_capability,decode_map.source_schema_sha256
    INTO source FROM outcome_provider_decoded_row decoded
    JOIN outcome_provider_normalization_run run ON run.normalization_run_id=decoded.normalization_run_id
    JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
    JOIN outcome_provider_field_map decode_map ON decode_map.field_map_id=run.field_map_id
    WHERE decoded.provider_decoded_row_id=target_row AND run.normalization_run_id=target_run;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO projected FROM outcome_hpn_projected_field_map WHERE field_map_id=target_map;
  IF FOUND THEN
    IF projected.environment<>source.environment OR projected.competition<>source.competition
      OR projected.provider<>source.provider OR projected.capability_id<>source.capture_capability
      OR projected.source_schema_sha256<>source.source_schema_sha256 THEN RETURN FALSE; END IF;
    SELECT source_use_assessment_json INTO assessment FROM outcome_hpn_field_map_review_decision
      WHERE decision_id=projected.approval_decision_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    source_first := assessment#>>'{content,schemaVersion}'='afl-trade-hpn-private-source-use-assessment/v2';
    IF source_first AND (assessment#>>'{content,source,normalizationRunId}' IS DISTINCT FROM target_run
      OR assessment#>>'{content,source,captureId}' IS DISTINCT FROM source.capture_id) THEN RETURN FALSE; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM outcome_hpn_pav_field_map map WHERE map.field_map_id=target_map
      AND map.environment=source.environment AND map.competition=source.competition
      AND map.provider=source.provider AND map.capability_id=source.capture_capability
      AND map.source_schema_sha256=source.source_schema_sha256) THEN RETURN FALSE; END IF;
    source_first := FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM outcome_acquisition_spell_version spell WHERE spell.spell_version_id=target_spell
      AND ((NOT COALESCE(source_first,TRUE) AND spell.registration_canonical_json IS NULL)
        OR (outcome_acquisition_spell_registration_current(target_spell,cutoff)
          AND spell.registration_canonical_json::JSONB->>'environment'=source.environment::TEXT
          AND spell.registration_canonical_json::JSONB->>'competition'=source.competition
          AND effective_date<=(spell.registration_canonical_json::JSONB->>'observedThrough')::DATE))
  );
END $$;

DO $$
DECLARE original_definition TEXT; updated_definition TEXT;
  eligible_fragment CONSTANT TEXT := $fragment$AND eligible."status"='approved'$fragment$;
  selected_fragment CONSTANT TEXT := $fragment$AND spell."status"='approved'$fragment$;
BEGIN
  SELECT pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure) INTO original_definition;
  IF (length(original_definition)-length(replace(original_definition,eligible_fragment,'')))/length(eligible_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,selected_fragment,'')))/length(selected_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact two HPN acquisition current-binding fragments';
  END IF;
  updated_definition:=replace(original_definition,eligible_fragment,eligible_fragment||$patch$
         AND outcome_hpn_acquisition_spell_is_current(eligible."spell_version_id",
           row_record."provider_decoded_row_id",row_record."normalization_run_id",
           (SELECT projected_field_map_id FROM outcome_hpn_pav_input_run
             WHERE input_set_id=NEW.input_set_id AND normalization_run_id=row_record.normalization_run_id),
           eligible_match."effective_at"::DATE,clock_timestamp())$patch$);
  updated_definition:=replace(updated_definition,selected_fragment,selected_fragment||$patch$
           AND outcome_hpn_acquisition_spell_is_current(spell."spell_version_id",
             row_record."provider_decoded_row_id",row_record."normalization_run_id",
             (SELECT projected_field_map_id FROM outcome_hpn_pav_input_run
               WHERE input_set_id=NEW.input_set_id AND normalization_run_id=row_record.normalization_run_id),
             match_member."effective_at"::DATE,clock_timestamp())$patch$);
  EXECUTE updated_definition;
END $$;
