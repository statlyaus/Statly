-- Read only the sealed members of the request's independently admitted dormant cohort.
-- The coordinator gains no direct table access, source admission, or publication authority.
GRANT SELECT ON outcome_release_event_asset,outcome_release_draft_selection,
  outcome_release_pick_custody,outcome_release_pick_realization
  TO afl_trade_private_valuation_scheduler_owner;

DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $membership$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION load_outcome_private_valuation_trade_evidence(
  target_request_id TEXT,target_claim_id TEXT,target_lease_sha256 TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE binding JSONB; manifest JSONB; members JSONB; member JSONB; snapshot JSONB;
  identity_field TEXT; selected_release_id TEXT;
BEGIN
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,target_claim_id,target_lease_sha256);
  -- Reuse the existing current factual/HPN, release, source, and Gate authority locks/checks.
  binding:=load_outcome_private_valuation_cohort_input(target_request_id);
  IF binding IS NULL THEN RAISE EXCEPTION 'Private trade evidence requires a retained cohort binding'; END IF;
  selected_release_id:=binding->>'cohortReleaseId';
  SELECT manifest_json INTO STRICT manifest FROM outcome_release_manifest WHERE release_id=selected_release_id;

  WITH sealed AS (
    SELECT event_version_id AS record_id,ARRAY['transaction','draft_event'] AS allowed_kinds,
      membership_json,record_sha256,record_canonical_json FROM outcome_release_event_version WHERE release_id=selected_release_id
    UNION ALL SELECT asset_version_id,ARRAY['transfer','draft_player_asset'],
      membership_json,record_sha256,record_canonical_json FROM outcome_release_event_asset WHERE release_id=selected_release_id
    UNION ALL SELECT selection_id,ARRAY['draft_selection'],
      membership_json,record_sha256,record_canonical_json FROM outcome_release_draft_selection WHERE release_id=selected_release_id
    UNION ALL SELECT custody_observation_id,ARRAY['pick_custody'],
      membership_json,record_sha256,record_canonical_json FROM outcome_release_pick_custody WHERE release_id=selected_release_id
    UNION ALL SELECT realization_id,ARRAY['pick_realization'],
      membership_json,record_sha256,record_canonical_json FROM outcome_release_pick_realization WHERE release_id=selected_release_id
  )
  SELECT jsonb_agg(jsonb_build_object('recordId',record_id,'allowedKinds',allowed_kinds,
    'membership',membership_json,'recordSha256',record_sha256,'recordCanonicalJson',record_canonical_json)
    ORDER BY (membership_json->>'ordinal')::BIGINT) INTO members FROM sealed;

  IF members IS NULL OR (SELECT jsonb_agg(item->'membership' ORDER BY ordinal)
    FROM jsonb_array_elements(members) WITH ORDINALITY entries(item,ordinal))
    IS DISTINCT FROM manifest#>'{content,canonicalMembers}'
  THEN RAISE EXCEPTION 'Private trade evidence has incomplete sealed membership'; END IF;

  FOR member IN SELECT item FROM jsonb_array_elements(members) entries(item) LOOP
    snapshot:=(member->>'recordCanonicalJson')::JSONB;
    identity_field:=CASE member#>>'{membership,recordKind}'
      WHEN 'transaction' THEN 'eventVersionId' WHEN 'draft_event' THEN 'eventVersionId'
      WHEN 'transfer' THEN 'assetVersionId' WHEN 'draft_player_asset' THEN 'assetVersionId'
      WHEN 'draft_selection' THEN 'selectionId' WHEN 'pick_custody' THEN 'custodyObservationId'
      WHEN 'pick_realization' THEN 'realizationId' END;
    IF identity_field IS NULL OR NOT (member->'allowedKinds' ? (member#>>'{membership,recordKind}'))
      OR member->>'recordId' IS DISTINCT FROM member#>>'{membership,canonicalRecordId}'
      OR member->>'recordSha256' IS DISTINCT FROM member#>>'{membership,canonicalRecordSha256}'
      OR member->>'recordSha256' IS DISTINCT FROM encode(sha256(convert_to(member->>'recordCanonicalJson','UTF8')),'hex')
      OR snapshot->>'schemaVersion' IS DISTINCT FROM 'afl-trade-canonical-release-member/v1'
      OR snapshot->>'recordKind' IS DISTINCT FROM member#>>'{membership,recordKind}'
      OR snapshot->'record'->>identity_field IS DISTINCT FROM member->>'recordId'
      OR snapshot#>>'{record,status}' IS DISTINCT FROM 'approved'
    THEN RAISE EXCEPTION 'Private trade evidence has mismatched sealed record bytes or identity'; END IF;
  END LOOP;

  -- A lease that expired while waiting on authority locks cannot receive source records.
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,target_claim_id,target_lease_sha256);
  RETURN jsonb_build_object('binding',binding,'releaseManifest',manifest,'members',
    (SELECT jsonb_agg(item-'recordId'-'allowedKinds' ORDER BY ordinal)
       FROM jsonb_array_elements(members) WITH ORDINALITY entries(item,ordinal)));
END $$;

DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.load_outcome_private_valuation_trade_evidence(TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %I.load_outcome_private_valuation_trade_evidence(TEXT,TEXT,TEXT) FROM PUBLIC',current_schema());
END $paths$;
GRANT EXECUTE ON FUNCTION load_outcome_private_valuation_trade_evidence(TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $membership$;
