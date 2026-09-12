-- A canonical correction cannot strand a live right on a superseded event version.
-- Deferral permits the existing atomic promotion/revision owner to replace all dependent facts.
CREATE FUNCTION require_outcome_special_correction_dependencies() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.supersedes_version_id IS NULL THEN RETURN NEW; END IF;
 IF EXISTS (
   SELECT 1 FROM outcome_special_entitlement_custody custody
   JOIN outcome_event_asset asset USING(asset_version_id)
   WHERE asset.event_version_id=NEW.supersedes_version_id
   AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision revision
     WHERE revision.entitlement_id=custody.entitlement_id AND revision.revision>1)
   AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement retired
     WHERE retired.retired_entitlement_id=custody.entitlement_id)
 ) OR EXISTS (
   SELECT 1 FROM outcome_special_entitlement_revision revision
   WHERE revision.revision>1
   AND revision.revision_json#>'{content,state,custody}' @> jsonb_build_array(jsonb_build_object('eventVersionId',NEW.supersedes_version_id))
   AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision successor
     WHERE successor.supersedes_revision_id=revision.revision_id)
   AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement retired
     WHERE retired.retired_entitlement_id=revision.entitlement_id)
 ) OR EXISTS (
   SELECT 1 FROM outcome_special_entitlement_current_exercise current
   JOIN outcome_draft_selection selection USING(selection_id)
   WHERE selection.event_version_id=NEW.supersedes_version_id
 ) THEN RAISE EXCEPTION 'Canonical correction requires atomic replacement of dependent special-entitlement facts'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER outcome_special_correction_dependencies AFTER INSERT ON outcome_event_version
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_special_correction_dependencies();

-- Dependency validation and canonical correction must observe one another's committed writes.
-- Reuse the promotion owner's event lock. Try-locking avoids inversion with custody/selection locks.
CREATE FUNCTION lock_outcome_special_dependency_event(id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF id IS NOT NULL AND NOT pg_try_advisory_xact_lock(hashtextextended('outcome-event:'||id,0)) THEN
 RAISE EXCEPTION 'Canonical event changed concurrently; retry the transaction' USING ERRCODE='40001';
 END IF;
END $$;
CREATE FUNCTION lock_outcome_special_correction_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM lock_outcome_special_dependency_event(NEW.event_id);
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_correction_event_lock BEFORE INSERT ON outcome_event_version
 FOR EACH ROW EXECUTE FUNCTION lock_outcome_special_correction_event();

DO $migration$
DECLARE definition TEXT; name TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['authenticate_outcome_special_entitlement_lifecycle',
   'authenticate_outcome_special_entitlement_revision_lifecycle'] LOOP
 SELECT pg_get_functiondef((name||CASE WHEN name='authenticate_outcome_special_entitlement_lifecycle'
   THEN '(jsonb,text)' ELSE '(jsonb,text,jsonb)' END)::regprocedure) INTO definition;
 definition:=regexp_replace(definition,'BEGIN'||chr(10),'BEGIN'||chr(10)||
   ' PERFORM lock_outcome_special_dependency_event(v.event_id) FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id) WHERE s.selection_id=fact->>''selectionId'';'||chr(10));
 EXECUTE definition;
 END LOOP;
 SELECT pg_get_functiondef('authenticate_outcome_special_entitlement_revision(jsonb,text)'::regprocedure) INTO definition;
 definition:=regexp_replace(definition,'BEGIN'||chr(10),'BEGIN'||chr(10)||
   ' PERFORM lock_outcome_special_dependency_event(v.event_id) FROM outcome_event_version v WHERE v.event_version_id IN (SELECT dependency.edge_json->>''eventVersionId'' FROM jsonb_array_elements(revision_json#>''{content,state,custody}'') AS dependency(edge_json)) ORDER BY v.event_id;'||chr(10));
 EXECUTE definition;
END $migration$;
