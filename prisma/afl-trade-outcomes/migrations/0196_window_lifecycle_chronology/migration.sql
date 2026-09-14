-- Exact days preserve existing semantics; windows additionally require current reviewed promotion proof.
CREATE FUNCTION outcome_event_evidenced_date_bounds(target_event_version TEXT)
RETURNS DATERANGE LANGUAGE plpgsql STABLE AS $$
DECLARE event RECORD; bounds DATERANGE;
BEGIN
 SELECT v.*,e.season_year INTO event FROM outcome_event_version v JOIN outcome_event e USING(event_id)
 WHERE v.event_version_id=target_event_version;
 IF NOT FOUND THEN RETURN NULL; END IF;
 bounds:=outcome_session_precision_bounds(jsonb_build_object('eventDate',event.event_date,
  'draftYear',event.season_year)||CASE WHEN event.date_precision IS NULL THEN '{}'::jsonb
   ELSE jsonb_build_object('datePrecision',event.date_precision) END,TRUE);
 IF bounds IS NULL THEN RETURN NULL; END IF;
 IF event.date_precision IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM outcome_external_canonical_promotion_record member
  JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
  WHERE member.canonical_record_id=target_event_version AND member.record_kind='draft_event'
   AND member.source_import_row_id=event.source_import_row_id AND promotion.status='finalized'
   AND promotion.proposal_json#>>'{content,schemaVersion}'='afl-trade-external-canonical-promotion-proposal/v7'
   AND member.record_json->'eventDate'='null'::jsonb
   AND member.record_json->'datePrecision'=event.date_precision
   AND member.record_json->>'draftYear'=event.season_year::TEXT
   AND outcome_external_draft_sessions_exact(promotion.candidate_id,promotion.proposal_json->'content')
 ) THEN RETURN NULL; END IF;
 RETURN bounds;
END $$;

DO $migration$
DECLARE signature TEXT; definition TEXT; old_fragment TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'authenticate_outcome_special_entitlement_lifecycle(jsonb,text)',
  'authenticate_outcome_special_entitlement_revision_lifecycle(jsonb,text,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  old_fragment:='v.kind,v.acquisition_mechanism,v.event_date,v.status AS event_status';
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected lifecycle selection query in %',signature; END IF;
  definition:=replace(definition,old_fragment,'v.kind,v.acquisition_mechanism,v.event_date,outcome_event_evidenced_date_bounds(v.event_version_id) AS date_bounds,v.status AS event_status');
  old_fragment:=$old$OR selection.event_date IS NULL
      OR EXTRACT(YEAR FROM selection.event_date)<>selection.season_year$old$;
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected lifecycle exact day guard in %',signature; END IF;
  definition:=replace(definition,old_fragment,'OR selection.date_bounds IS NULL');
  old_fragment:='earliest:=selection.event_date; latest:=selection.event_date;';
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected lifecycle day assignment in %',signature; END IF;
  definition:=replace(definition,old_fragment,'earliest:=lower(selection.date_bounds); latest:=upper(selection.date_bounds)-1;');
  -- Reviewed custody/activation establishes sequence. Reject dates that cannot precede the selection.
  definition:=replace(definition,'>selection.event_date','>latest');
  EXECUTE definition;
 END LOOP;
 definition:=pg_get_functiondef('authenticate_outcome_special_renumbering(jsonb,text,jsonb)'::regprocedure);
 old_fragment:='s.*,e.season_year,v.event_date,v.acquisition_mechanism';
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected renumbering selection query'; END IF;
 definition:=replace(definition,old_fragment,'s.*,e.season_year,v.event_date,v.acquisition_mechanism,outcome_event_evidenced_date_bounds(v.event_version_id) AS date_bounds');
 definition:=replace(definition,$old$IF NOT FOUND THEN RAISE EXCEPTION 'Renumbering requires its canonical selection'$old$,
  $new$IF NOT FOUND OR selection.date_bounds IS NULL THEN RAISE EXCEPTION 'Renumbering requires its canonical selection'$new$);
 old_fragment:='first_day>selection.event_date';
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected renumbering chronology'; END IF;
 EXECUTE replace(definition,old_fragment,'first_day>upper(selection.date_bounds)-1');
END $migration$;
